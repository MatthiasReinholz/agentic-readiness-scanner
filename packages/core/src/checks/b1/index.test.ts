import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import type { CheckOutcome } from '../types.js';
import { feedFreshness, productFeedDiscoverable } from './index.js';

const origin = 'https://shop.example';
const llmsUrl = `${origin}/llms.txt`;
const feedUrl = `${origin}/feed/products.xml`;

function googleXml(lastBuildDate?: string): string {
  return `<?xml version="1.0"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Shop</title>
${lastBuildDate ? `<lastBuildDate>${lastBuildDate}</lastBuildDate>` : ''}
<item><g:id>MUG-1</g:id><g:title>Mug</g:title><g:link>${origin}/product/mug/</g:link><g:price>24.00 EUR</g:price></item>
<item><g:id>BOWL-1</g:id><g:title>Bowl</g:title><g:link>${origin}/product/bowl/</g:link><g:price>48.00 EUR</g:price></item>
</channel></rss>`;
}

const BLOG_RSS =
  '<rss version="2.0"><channel><title>Blog</title><item><title>Post</title></item></channel></rss>';

const xml = (body: string, headers: Record<string, string> = {}) => ({
  status: 200,
  headers: { 'content-type': 'application/xml; charset=utf-8', ...headers },
  body,
});

function llmsWith(...links: string[]): string {
  return `# Shop\n\n> A shop.\n\n## Catalog\n\n${links.map((url) => `- [Product feed](${url})`).join('\n')}\n`;
}

describe('B1.5 public product feed discoverable', () => {
  it('passes on a Google XML feed linked from llms.txt and records feed_url and format', async () => {
    const outcome = await runCheck(
      productFeedDiscoverable,
      targetFor(),
      mapFetcher({ [llmsUrl]: llmsWith(feedUrl), [feedUrl]: xml(googleXml()) }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      feed_url: feedUrl,
      format: 'xml',
      source: 'llms.txt',
      namespace_google: true,
      items_read: 2,
      candidates: [feedUrl],
    });
    expect((outcome.evidence.sample as unknown[]).length).toBe(2);
  });

  it('finds a JSON feed through a hinted rel=alternate link tag, resolving a relative href', async () => {
    const home = `<!doctype html><html><head><link rel="alternate" type="application/json" title="Google Shopping feed" href="/products.json"></head><body></body></html>`;
    const items = [
      { id: '1', title: 'Mug', url: `${origin}/product/mug/`, price: '24.00 EUR' },
      { id: '2', title: 'Bowl', link: `${origin}/product/bowl/`, price: '48.00 EUR' },
    ];
    const outcome = await runCheck(
      productFeedDiscoverable,
      targetFor({ homeHtml: home }),
      mapFetcher({
        [`${origin}/products.json`]: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(items),
        },
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      feed_url: `${origin}/products.json`,
      format: 'json',
      source: 'link',
    });
  });

  it('tries the only RSS link when no link tag hints at products', async () => {
    const home = `<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"><link rel="alternate" type="application/json" href="/wp-json/oembed"></head><body></body></html>`;
    const outcome = await runCheck(
      productFeedDiscoverable,
      targetFor({ homeHtml: home }),
      mapFetcher({ [`${origin}/rss.xml`]: xml(googleXml()) }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ feed_url: `${origin}/rss.xml`, source: 'link' });
  });

  it('collects candidates from robots.txt comments and sitemap URLs after llms.txt', async () => {
    const csvUrl = `${origin}/feed/google.csv`;
    const sitemapFeed = `${origin}/feed-products.xml`;
    const outcome = await runCheck(
      productFeedDiscoverable,
      targetFor({
        robots: `# Merchant feed: ${csvUrl}\nUser-agent: *\nAllow: /\n`,
        sitemap: {
          url: `${origin}/sitemap.xml`,
          kind: 'index',
          childSitemaps: [sitemapFeed, `${origin}/page-sitemap.xml`],
          fetchedSitemaps: [],
          urls: [],
          productUrls: [],
        },
      }),
      mapFetcher({
        [csvUrl]: {
          status: 200,
          headers: { 'content-type': 'text/csv' },
          body: 'id,title,link,price\n1,Mug,https://shop.example/product/mug/,24.00 EUR\n',
        },
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      feed_url: csvUrl,
      format: 'csv',
      source: 'robots.txt',
      candidates: [csvUrl, sitemapFeed],
    });
  });

  it('fails when nothing announces a feed', async () => {
    const outcome = await runCheck(productFeedDiscoverable, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('no feed link found');
    expect(outcome.evidence).toEqual({ candidates: [], tried: [] });
  });

  it('fails naming the candidates tried and fetches at most two of them', async () => {
    const missing = `${origin}/feed/missing.xml`;
    const blog = `${origin}/feed/`;
    const fetcher = mapFetcher({
      [llmsUrl]: llmsWith(missing, blog, feedUrl),
      [blog]: xml(BLOG_RSS, { 'content-type': 'application/rss+xml' }),
      [feedUrl]: xml(googleXml()),
    });
    const outcome = await runCheck(productFeedDiscoverable, targetFor(), fetcher);
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain(`${missing} (HTTP 404)`);
    expect(outcome.message).toContain(blog);
    expect(outcome.evidence).toMatchObject({
      candidates: [missing, blog, feedUrl],
      tried: [
        { url: missing, status: 404, reason: 'HTTP 404' },
        { url: blog, status: 200, format: 'xml' },
      ],
    });
    expect(fetcher.log.map((entry) => entry.url)).toEqual([llmsUrl, missing, blog]);
  });
});

describe('B1.6 feed freshness', () => {
  const DATE = 'Fri, 30 Oct 2026 12:00:00 GMT';
  const found = (verdict: CheckOutcome['verdict'] = 'pass'): Map<string, CheckOutcome> =>
    new Map([['B1.5', { verdict, evidence: verdict === 'pass' ? { feed_url: feedUrl } : {} }]]);
  const run = (response: ReturnType<typeof xml>, outcomes = found()) =>
    runCheck(feedFreshness, targetFor(), mapFetcher({ [feedUrl]: response }), outcomes);

  it('skips as dependency_failed when B1.5 found no feed', async () => {
    const none = await runCheck(feedFreshness, targetFor(), mapFetcher({}));
    expect(none).toMatchObject({ verdict: 'skip', skipReason: 'dependency_failed' });
    const failed = await run(xml(googleXml()), found('fail'));
    expect(failed).toMatchObject({ verdict: 'skip', skipReason: 'dependency_failed' });
  });

  it('passes within 24 hours of the Last-Modified header, aged against the Date header', async () => {
    const outcome = await run(
      xml(googleXml(), { date: DATE, 'last-modified': 'Fri, 30 Oct 2026 09:00:00 GMT' }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      feed_url: feedUrl,
      last_modified: 'Fri, 30 Oct 2026 09:00:00 GMT',
      in_feed: null,
      age_hours: 3,
      basis: 'last-modified',
      scan_time: '2026-10-30T12:00:00.000Z',
    });
  });

  it('warns within 7 days using the timestamp inside the feed', async () => {
    const outcome = await run(xml(googleXml('Tue, 27 Oct 2026 12:00:00 GMT'), { date: DATE }));
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({
      last_modified: null,
      in_feed: 'Tue, 27 Oct 2026 12:00:00 GMT',
      age_hours: 72,
      basis: 'in-feed',
    });
  });

  it('fails beyond 7 days', async () => {
    const outcome = await run(
      xml(googleXml(), { date: DATE, 'last-modified': 'Thu, 01 Oct 2026 12:00:00 GMT' }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toMatchObject({ age_hours: 696, basis: 'last-modified' });
  });

  it('fails when the feed carries no timestamp at all, and says so', async () => {
    const outcome = await run(xml(googleXml(), { date: DATE }));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      'feed has no Last-Modified header and no timestamp inside the feed',
    );
    expect(outcome.evidence).toMatchObject({ last_modified: null, in_feed: null, age_hours: null });
  });

  it('uses the freshest parseable timestamp and reports an unparseable one', async () => {
    const freshest = await run(
      xml(googleXml('Fri, 30 Oct 2026 11:30:00 GMT'), {
        date: DATE,
        'last-modified': 'Mon, 05 Oct 2026 12:00:00 GMT',
      }),
    );
    expect(freshest.verdict).toBe('pass');
    expect(freshest.evidence).toMatchObject({ age_hours: 0.5, basis: 'in-feed' });
    const garbage = await run(xml(googleXml(), { date: DATE, 'last-modified': 'yesterday' }));
    expect(garbage.verdict).toBe('fail');
    expect(garbage.message).toBe('feed timestamp could not be parsed: yesterday');
  });

  it('ages against the scanner clock when the response has no Date header', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toUTCString();
    const outcome = await run(xml(googleXml(), { 'last-modified': twoHoursAgo }));
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence.age_hours).toBe(2);
  });
});
