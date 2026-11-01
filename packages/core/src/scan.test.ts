import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ScanResultSchema } from '@agentic-readiness/catalog';
import { describe, expect, it } from 'vitest';

import type { FetchFailure, FetchOptions, FetchedResponse, Fetcher } from './http/types.js';
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

  it('implements every catalog check and stays within budget', async () => {
    const result = await run();
    const notImplemented = result.results.filter((item) => item.skip_reason === 'not_implemented');
    expect(notImplemented.map((item) => item.id)).toEqual([]);
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

describe('scan warnings about requests that did not succeed', () => {
  /** The fixture fetcher with the failure list a live BudgetedFetcher would have kept. */
  function withFailures(failures: FetchFailure[]): Fetcher {
    const inner = fixtureFetcher(join(fixtures, 'good-woocommerce'));
    return {
      fetch: (url: string, options?: FetchOptions): Promise<FetchedResponse> =>
        inner.fetch(url, options),
      get requestCount() {
        return inner.requestCount;
      },
      budget: inner.budget,
      failures,
    };
  }

  it('names every failed request and summarises rate limiting', async () => {
    const result = await scan('ceramics.example', {
      fetcher: withFailures([
        {
          url: 'https://ceramics.example/product/vase/',
          status: 0,
          reason: 'TypeError: fetch failed (read ECONNRESET)',
        },
        {
          url: 'https://ceramics.example/llms.txt',
          status: 429,
          reason: 'HTTP 429, Retry-After: 30',
        },
      ]),
      now: fixedNow,
    });
    expect(result.warnings).toContain(
      'request failed: https://ceramics.example/product/vase/ (TypeError: fetch failed (read ECONNRESET))',
    );
    expect(result.warnings).toContain(
      'request failed: https://ceramics.example/llms.txt (HTTP 429, Retry-After: 30)',
    );
    expect(result.warnings.filter((warning) => warning.includes('429 Too Many Requests'))).toEqual([
      'the store answered 429 Too Many Requests on 1 URL(s); verdicts for those pages reflect the rate limit, not the page: https://ceramics.example/llms.txt',
    ]);
    expect(ScanResultSchema.safeParse(result).success).toBe(true);
  });

  it('adds nothing when every request succeeded', async () => {
    const result = await scan('ceramics.example', { fetcher: withFailures([]), now: fixedNow });
    expect(result.warnings.some((warning) => warning.startsWith('request failed'))).toBe(false);
  });
});

describe('scan of a store whose home page refuses the scanner', () => {
  it('produces a Level 0 report that names the vendor and evaluates nothing it could not read', async () => {
    const { renderMarkdown } = await import('./reporters/markdown.js');
    const body =
      '<html><head><title>Access Denied</title></head><body>Reference #18.1f6cdead.1700000000.1a2b3c</body></html>';
    const fetcher = {
      budget: 40,
      requestCount: 0,
      fetch: (url: string) => {
        fetcher.requestCount += 1;
        return Promise.resolve({
          url,
          finalUrl: url,
          status: 403,
          headers: { server: 'AkamaiGHost', 'content-type': 'text/html' },
          body,
          bytes: body.length,
          truncated: false,
          redirects: 0,
          durationMs: 1,
          fromCache: false,
        });
      },
    };
    const result = await scan('https://www.blocked.example/', { fetcher });
    expect(result.level.value).toBe(0);
    expect(result.target.platform).toBe('unknown');
    const byId = new Map(result.results.map((item) => [item.id, item]));
    expect(byId.get('A2.4')?.verdict).toBe('fail');
    expect(byId.get('A2.4')?.message).toMatch(
      /the home page and robots.txt refused an honestly identified client \(HTTP 403 from Akamai bot management\)/,
    );
    // A 403 on robots.txt means no restrictions to Google, so A1.1 warns rather than fails.
    expect(byId.get('A1.1')?.verdict).toBe('warn');
    expect(byId.get('B2.1')?.skip_reason).toBe('dependency_failed');
    expect(byId.get('B4.1')?.message).toMatch(/see A2.4/);
    expect(result.warnings.some((w) => /HTTP 403, Akamai/.test(w))).toBe(true);
    const markdown = renderMarkdown(result);
    expect(markdown).toContain('## Fix first');
    expect(markdown).toMatch(
      /1\. \*\*A2\.4 No block or challenge on an honest fetch\*\* — blocking · unlocks Level 1/,
    );
  });
});
