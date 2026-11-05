import type { CheckResult } from '@agentic-readiness/catalog';
import { catalog, checksForProfile, getProfile, type Profile } from '@agentic-readiness/catalog';
import { describe, expect, it } from 'vitest';

import {
  computeLevel,
  computeScores,
  dimensionScore,
  isUnanswered,
  scoreDimension,
  scoreGroup,
} from './scoring.js';
import { defined } from './testing/index.js';

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

/** The catalog without ceilings, for tests about the weighted arithmetic on partial results. */
const uncapped = { ...catalog, ceilings: [] };

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
    expect(computeLevel(crawlable)).toMatchObject({ value: 1, name: 'Reachable' });
    expect(computeLevel(crawlable).next_gate).toEqual([
      'A1.3',
      'B1.2',
      'B1.8',
      'B1.5',
      'B5.8',
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
      // A content site's A3.2 judges its home page, so it is in the profile and passes.
      result('A3.2', 'pass'),
      { ...result('B2.1', 'skip'), skip_reason: 'not_applicable' as const },
    ];
    expect(computeLevel(results, catalog, contentSite)).toEqual({
      value: 1,
      name: 'Reachable',
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

  it('lets a warning meet a gate only on checks whose warning is about intent, not reach', () => {
    // A1.1 warns when robots.txt is missing (RFC 9309: allow all); A2.2 warns when one
    // minor crawler is blocked. Both leave the site reachable, so Level 1 holds.
    const reachable = [
      result('A1.1', 'warn'),
      result('A2.2', 'warn'),
      result('A2.4', 'pass'),
      result('A3.2', 'pass'),
    ];
    expect(computeLevel(reachable).value).toBe(1);
    // A warning on A3.2 (some product content missing from the HTML) still blocks it.
    const partial = [...reachable.slice(0, 3), result('A3.2', 'warn')];
    expect(computeLevel(partial).value).toBe(0);
  });

  it('says the next level is undetermined when only unanswered gates stand in the way', () => {
    const unanswered = (id: string, reason: 'budget_exhausted' | 'error'): CheckResult => ({
      ...result(id, 'skip'),
      applies: true,
      skip_reason: reason,
    });
    const level = computeLevel([
      result('A1.1', 'pass'),
      result('A2.2', 'pass'),
      unanswered('A2.4', 'error'),
      result('A3.2', 'pass'),
    ]);
    expect(level).toMatchObject({ value: 0, undetermined: ['A2.4'] });
    // A real failure next to it decides the level: nothing is undetermined then.
    const decided = computeLevel([
      result('A1.1', 'pass'),
      result('A2.2', 'fail'),
      unanswered('A2.4', 'error'),
      result('A3.2', 'pass'),
    ]);
    expect(decided.undetermined).toBeUndefined();
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
    expect(computeScores([result('A1.1', 'pass')], uncapped)).toMatchObject({
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
        : ['A1.3', 'B1.5', 'B1.8', 'B5.8'].includes(check.id)
          ? 'fail'
          : 'pass',
      applies: ids.has(check.id),
      ...(ids.has(check.id) ? {} : { skip_reason: 'not_applicable' as const }),
      evidence: {},
    }));
    const level = computeLevel(results, catalog, profile);
    expect(level.value).toBe(1);
    expect(level.next_gate).toEqual(['A1.3', 'B1.8', 'B1.5', 'B5.8']);
    expect(level.next_gate).not.toContain('B1.2');
  });
});

describe('score coverage', () => {
  const skipped = (id: string, reason: CheckResult['skip_reason'], dependency?: string) => ({
    ...result(id, 'skip'),
    skip_reason: reason,
    evidence: dependency ? { dependency } : {},
  });
  const commerceIds = catalog.checks
    .filter((check) => check.group.startsWith('B') && check.weight !== 'info')
    .map((check) => check.id);

  it('does not score a dimension the scan barely answered', () => {
    // quickjewelryrepairs.com: the time budget ran out after B1.2 passed, so commerce read 100.
    const results = commerceIds.map((id) =>
      id === 'B1.2' ? result(id, 'pass') : skipped(id, 'budget_exhausted'),
    );
    const scores = computeScores(results);
    expect(scores.commerce).toBeNull();
    expect(scores.coverage?.commerce).toBeLessThan(10);
    expect(scores.groups.B1).toBeNull();
    expect(dimensionScore(scores, 'commerce')).toMatchObject({ state: 'incomplete', value: null });
  });

  it('treats a dependent of an unanswered parent as unanswered, and of a failed parent as answered', () => {
    const byId = new Map(
      [
        skipped('B2.1', 'budget_exhausted'),
        skipped('B2.2', 'dependency_failed', 'B2.1'),
        result('A1.2', 'fail'),
        skipped('A1.3', 'dependency_failed', 'A1.2'),
      ].map((item) => [item.id, item]),
    );
    expect(isUnanswered(defined(byId.get('B2.2')), byId)).toBe(true);
    expect(isUnanswered(defined(byId.get('A1.3')), byId)).toBe(false);
  });

  it('keeps scoring when a few checks could not run', () => {
    const results = commerceIds.map((id, index) =>
      index === 0 ? skipped(id, 'error') : result(id, 'pass'),
    );
    const scores = computeScores(results, uncapped);
    expect(scores.commerce).toBe(100);
    expect(scores.coverage?.commerce).toBeGreaterThan(90);
    expect(dimensionScore(scores, 'commerce').state).toBe('scored');
  });

  it('reads a profile without commerce as not applicable, and old results without coverage as scored', () => {
    expect(dimensionScore({ ingestion: 80, commerce: null, groups: {} }, 'commerce').state).toBe(
      'not_applicable',
    );
    expect(dimensionScore({ ingestion: 80, commerce: 70, groups: {} }, 'commerce')).toEqual({
      value: 70,
      state: 'scored',
      coverage: null,
    });
  });
});

describe('score ceilings', () => {
  const woo = profileOrThrow('woocommerce-store');
  const inProfile = new Set(checksForProfile(woo).map((check) => check.id));
  /** Every check of the WooCommerce profile passes, except the ones named. */
  const store = (failing: string[]): CheckResult[] =>
    catalog.checks.map((check) =>
      !inProfile.has(check.id)
        ? { ...result(check.id, 'skip'), skip_reason: 'not_applicable' as const }
        : result(check.id, failing.includes(check.id) ? 'fail' : 'pass'),
    );

  it('caps commerce at 60 when no checkout an agent can use is advertised', () => {
    const results = store(['B5.1', 'B5.2', 'B5.3']);
    const scores = computeScores(results, catalog, woo);
    expect(scores.commerce).toBe(60);
    expect(scores.ceilings?.commerce).toMatchObject({
      id: 'no-checkout',
      value: 60,
      lifted_by: ['B5.2', 'B5.3'],
    });
    expect(scores.ceilings?.commerce?.raw).toBeGreaterThan(80);
    expect(scores.ceilings?.ingestion).toBeUndefined();
    // The level says the same: Level 4, with the checkout checks as the next gate.
    expect(computeLevel(results, catalog, woo)).toMatchObject({
      value: 4,
      next_gate: ['B5.2', 'B5.3'],
    });
  });

  it('does not count an empty UCP profile as a checkout', () => {
    const scores = computeScores(store(['B5.2', 'B5.3']), catalog, woo);
    expect(scores.ceilings?.commerce?.id).toBe('no-checkout');
    expect(computeLevel(store(['B5.2', 'B5.3']), catalog, woo).value).toBe(4);
  });

  it('lifts the cap once a checkout capability is declared', () => {
    const scores = computeScores(store(['B5.3']), catalog, woo);
    expect(scores.ceilings).toBeUndefined();
    expect(scores.commerce).toBeGreaterThan(95);
    expect(computeLevel(store(['B5.3']), catalog, woo).value).toBe(5);
  });

  it('caps both dimensions when agents cannot reach the site, and the lower cap wins', () => {
    const scores = computeScores(store(['A2.4', 'B5.1', 'B5.2', 'B5.3']), catalog, woo);
    expect(scores.ingestion).toBe(40);
    expect(scores.ceilings?.ingestion).toMatchObject({ id: 'not-crawlable', lifted_by: ['A2.4'] });
    expect(scores.commerce).toBe(30);
    expect(scores.ceilings?.commerce?.id).toBe('not-crawlable');
  });

  it('needs evidence for a cap: a gate the scan could not evaluate holds the level, not the score', () => {
    // No product page was found to sample, so server rendering could not be checked.
    const results = store([]).map((item) =>
      item.id === 'A3.2'
        ? { ...item, verdict: 'skip' as const, skip_reason: 'not_applicable' as const }
        : item,
    );
    const scores = computeScores(results, catalog, woo);
    expect(scores.ceilings).toBeUndefined();
    expect(scores.ingestion).toBeGreaterThan(95);
    expect(computeLevel(results, catalog, woo)).toMatchObject({ value: 0, next_gate: ['A3.2'] });
  });

  it('records a ceiling that holds even when the raw score is already below it', () => {
    const failing = catalog.checks.filter((check) => check.group.startsWith('B')).map((c) => c.id);
    const scores = computeScores(store(failing), catalog, woo);
    expect(scores.commerce).toBe(0);
    expect(scores.ceilings?.commerce).toMatchObject({ value: 60, raw: 0 });
  });
});
