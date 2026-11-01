import type { CheckResult } from '@agentic-readiness/catalog';
import { catalog, checksForProfile, getProfile, type Profile } from '@agentic-readiness/catalog';
import { describe, expect, it } from 'vitest';

import { computeLevel, computeScores, scoreDimension, scoreGroup } from './scoring.js';

function result(id: string, verdict: CheckResult['verdict']): CheckResult {
  const definition = catalog.checks.find((check) => check.id === id);
  if (!definition) throw new Error(`unknown check ${id}`);
  return {
    id,
    group: definition.group,
    title: definition.title,
    weight: definition.weight,
    verdict,
    applies: verdict !== 'skip',
    evidence: {},
  };
}

function profileOrThrow(id: string): Profile {
  const profile = getProfile(id);
  if (!profile) throw new Error(`unknown profile ${id}`);
  return profile;
}

describe('scoreDimension', () => {
  it('weights passes fully, warns half, and drops skips from the denominator', () => {
    const results = [
      result('A1.1', 'pass'),
      result('A1.2', 'warn'),
      result('A1.3', 'skip'),
      result('A1.4', 'fail'),
    ];
    // weights: A1.1=3 pass, A1.2=2 warn (1), A1.4=1 fail -> 4 / 6
    expect(scoreDimension(results, 'ingestion')).toBe(67);
    expect(scoreDimension(results, 'commerce')).toBeNull();
  });

  it('ignores info checks', () => {
    expect(scoreDimension([result('B1.1', 'pass')], 'commerce')).toBeNull();
  });
});

describe('computeLevel', () => {
  it('gates levels instead of averaging', () => {
    const crawlable = [
      result('A1.1', 'pass'),
      result('A2.2', 'pass'),
      result('A2.4', 'pass'),
      result('A3.2', 'pass'),
    ];
    expect(computeLevel(crawlable)).toMatchObject({ value: 1, name: 'Crawlable' });
    expect(computeLevel(crawlable).next_gate).toEqual([
      'A1.3',
      'B1.2',
      'B1.8',
      'B1.5',
      'A2.6',
      'B2.1',
      'B2.2',
    ]);
  });

  it('accepts any alternative inside a gate', () => {
    const readable = [
      result('A1.1', 'pass'),
      result('A2.2', 'pass'),
      result('A2.4', 'pass'),
      result('A3.2', 'pass'),
      result('B1.5', 'pass'),
      result('A2.6', 'pass'),
      result('B2.1', 'pass'),
      result('B2.2', 'pass'),
    ];
    expect(computeLevel(readable).value).toBe(2);
  });

  it('stays at level 0 when a blocking check fails even if later gates pass', () => {
    const results = [
      result('A1.1', 'pass'),
      result('A2.2', 'fail'),
      result('A2.4', 'pass'),
      result('A3.2', 'pass'),
      result('B2.1', 'pass'),
    ];
    expect(computeLevel(results)).toMatchObject({ value: 0, next_gate: ['A2.2'] });
  });

  it('lets gates outside the profile through and caps the level', () => {
    const contentSite = profileOrThrow('content-site');
    const results = [
      result('A1.1', 'pass'),
      result('A2.2', 'pass'),
      result('A2.4', 'pass'),
      { ...result('A3.2', 'skip'), skip_reason: 'not_applicable' as const },
      { ...result('B2.1', 'skip'), skip_reason: 'not_applicable' as const },
    ];
    expect(computeLevel(results, catalog, contentSite)).toEqual({
      value: 1,
      name: 'Crawlable',
      next_gate: [],
    });
  });

  it('blocks a gate the profile includes when the check could not run on this target', () => {
    const store = profileOrThrow('other-store');
    const noProducts = [
      result('A1.1', 'pass'),
      result('A2.2', 'pass'),
      result('A2.4', 'pass'),
      { ...result('A3.2', 'skip'), skip_reason: 'not_applicable' as const },
    ];
    expect(computeLevel(noProducts, catalog, store)).toMatchObject({
      value: 0,
      next_gate: ['A3.2'],
    });
    const unimplemented = [
      ...noProducts.slice(0, 3),
      { ...result('A3.2', 'skip'), skip_reason: 'not_implemented' as const },
    ];
    expect(computeLevel(unimplemented, catalog, store).value).toBe(0);
  });

  it('reports no next gate at level 5', () => {
    const all =
      catalog.levels[5]?.gates.flatMap((gate) => gate[0] ?? []).map((id) => result(id, 'pass')) ??
      [];
    expect(computeLevel(all)).toMatchObject({ value: 5, next_gate: [] });
  });
});

describe('scoreGroup', () => {
  it('scores one group with the same weighting and returns null when nothing applied', () => {
    const results = [result('A1.1', 'pass'), result('A1.4', 'fail'), result('A2.1', 'skip')];
    expect(scoreGroup(results, 'A1')).toBe(75);
    expect(scoreGroup(results, 'A2')).toBeNull();
    expect(scoreGroup(results, 'B5')).toBeNull();
  });

  it('is carried in computeScores for every catalog group', () => {
    const scores = computeScores([result('A1.1', 'pass')]);
    expect(Object.keys(scores.groups)).toEqual(catalog.groups.map((group) => group.id));
    expect(scores.groups.A1).toBe(100);
    expect(scores.groups.B2).toBeNull();
  });
});

describe('computeScores', () => {
  it('returns null commerce for ingestion-only results', () => {
    expect(computeScores([result('A1.1', 'pass')])).toMatchObject({
      ingestion: 100,
      commerce: null,
    });
  });
});

describe('next_gate and profiles', () => {
  it('lists only gate alternatives the profile includes', () => {
    const profile = getProfile('other-store');
    if (!profile) throw new Error('profile missing');
    const ids = new Set(checksForProfile(profile).map((check) => check.id));
    const results: CheckResult[] = catalog.checks.map((check) => ({
      id: check.id,
      group: check.group,
      title: check.title,
      weight: check.weight,
      verdict: !ids.has(check.id)
        ? 'skip'
        : ['A1.3', 'B1.5', 'B1.8'].includes(check.id)
          ? 'fail'
          : 'pass',
      applies: ids.has(check.id),
      ...(ids.has(check.id) ? {} : { skip_reason: 'not_applicable' as const }),
      evidence: {},
    }));
    const level = computeLevel(results, catalog, profile);
    expect(level.value).toBe(1);
    expect(level.next_gate).toEqual(['A1.3', 'B1.8', 'B1.5']);
    expect(level.next_gate).not.toContain('B1.2');
  });
});
