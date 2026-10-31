import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ScanResultSchema } from '@agentic-readiness/catalog';
import { describe, expect, it } from 'vitest';

import { renderBadge, renderHtml, renderMarkdown } from './reporters/index.js';
import { scan } from './scan.js';
import { fixtureFetcher } from './testing/index.js';

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'stores',
);
const fixedNow = () => new Date('2026-10-30T12:00:00Z');

describe('scan of the good WooCommerce fixture', () => {
  const run = () =>
    scan('ceramics.example', {
      fetcher: fixtureFetcher(join(fixtures, 'good-woocommerce')),
      now: fixedNow,
    });

  it('produces a schema-valid result', async () => {
    const result = await run();
    expect(ScanResultSchema.safeParse(result).success).toBe(true);
  });

  it('detects WooCommerce, samples products and policies deterministically', async () => {
    const result = await run();
    expect(result.target.platform).toBe('woocommerce');
    expect(result.target.profile).toBe('woocommerce-store');
    expect(result.target.sampled.products).toHaveLength(2);
    expect(result.target.sampled.policies).toMatchObject({
      returns: 'https://ceramics.example/returns/',
      shipping: 'https://ceramics.example/shipping/',
      privacy: 'https://ceramics.example/privacy-policy/',
      terms: 'https://ceramics.example/terms/',
    });
    const again = await run();
    expect(again.target.sampled).toEqual(result.target.sampled);
    expect(again.results.map((r) => [r.id, r.verdict])).toEqual(
      result.results.map((r) => [r.id, r.verdict]),
    );
  });

  it('passes the implemented checks the fixture is built for', async () => {
    const result = await run();
    const verdict = (id: string) => result.results.find((item) => item.id === id)?.verdict;
    for (const id of [
      'A1.1',
      'A1.2',
      'A1.3',
      'A1.5',
      'A1.6',
      'A2.1',
      'A2.2',
      'A2.6',
      'A3.2',
      'B1.2',
      'B2.1',
      'B2.2',
      'B3.1',
      'B3.2',
      'B4.1',
      'B4.2',
      'B4.3',
      'B4.7',
    ]) {
      expect(verdict(id), id).toBe('pass');
    }
  });

  it('skips unimplemented checks honestly and stays within budget', async () => {
    const result = await run();
    const notImplemented = result.results.filter((item) => item.skip_reason === 'not_implemented');
    expect(notImplemented.length).toBeGreaterThan(0);
    expect(result.requests).toBeLessThanOrEqual(40);
    expect(result.scanned_at).toBe('2026-10-30T12:00:00.000Z');
  });

  it('reaches level 5 with every applicable check passing', async () => {
    const result = await run();
    expect(result.level.value).toBe(5);
    expect(result.level.next_gate).toEqual([]);
    expect(result.scores).toMatchObject({ ingestion: 100, commerce: 100 });
    const notPassing = result.results.filter(
      (item) => item.verdict !== 'pass' && item.skip_reason !== 'not_applicable',
    );
    expect(notPassing.map((item) => `${item.id}:${item.skip_reason ?? item.verdict}`)).toEqual(
      notPassing
        .filter((item) => item.skip_reason === 'not_implemented')
        .map((item) => `${item.id}:not_implemented`),
    );
  });

  it('renders every format', async () => {
    const result = await run();
    expect(renderMarkdown(result)).toContain(
      '# Agentic readiness report for https://ceramics.example',
    );
    expect(renderHtml(result)).toContain('<!doctype html>');
    expect(renderBadge(result)).toContain('<svg');
  });
});

describe('scan of the recorded Shopify store', () => {
  it('detects Shopify, runs the Shopify-only checks and skips the WooCommerce ones', async () => {
    const result = await scan('https://boots.example/', {
      fetcher: fixtureFetcher(join(fixtures, 'shopify-store')),
      now: fixedNow,
    });
    expect(result.target.platform).toBe('shopify');
    expect(result.target.profile).toBe('other-store');
    const byId = new Map(result.results.map((item) => [item.id, item]));
    expect(byId.get('B1.8')?.verdict).toBe('pass');
    expect(byId.get('B5.8')?.verdict).toBe('pass');
    expect(byId.get('B5.1')?.verdict).toBe('pass');
    expect(byId.get('B1.2')?.skip_reason).toBe('not_applicable');
    expect(byId.get('B5.7')?.skip_reason).toBe('not_applicable');
    expect(result.level.value).toBeGreaterThanOrEqual(2);
  });
});

describe('scan of a content site', () => {
  it('selects the content-site profile and scores ingestion only', async () => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(join(fixtures, 'content-site')),
      now: fixedNow,
    });
    expect(result.target.platform).toBe('wordpress');
    expect(result.target.profile).toBe('content-site');
    expect(result.scores.commerce).toBeNull();
    expect(result.level).toEqual({ value: 1, name: 'Crawlable', next_gate: [] });
    expect(
      result.results
        .filter((item) => item.group.startsWith('B'))
        .every((item) => item.verdict === 'skip' && !item.applies),
    ).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('no product URLs'))).toBe(true);
  });

  it('honours a profile override', async () => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(join(fixtures, 'content-site')),
      profile: 'other-store',
      now: fixedNow,
    });
    expect(result.target.profile).toBe('other-store');
    expect(result.scores.commerce).not.toBeNull();
  });
});

describe('scan of an unreachable target', () => {
  it('throws a TargetUnreachableError', async () => {
    await expect(
      scan('https://nowhere.example/', { fetcher: fixtureFetcher(join(fixtures, 'content-site')) }),
    ).rejects.toThrow(/not reachable/);
  });
});
