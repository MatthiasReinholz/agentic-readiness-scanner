import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Fetcher, FetchOptions } from '../../http/types.js';
import type { SitemapSummary } from '../../target/types.js';
import {
  fixtureFetcher,
  mapFetcher,
  type MapResponse,
  runCheck,
  targetFor,
} from '../../testing/index.js';
import {
  feedFreshness,
  productFeedDiscoverable,
  sitemapMatchesStoreApi,
  sitemapProductCountComplete,
  storeApiNotRateLimited,
  storeApiProductComplete,
} from './index.js';
import type { CheckOutcome } from '../types.js';

const ORIGIN = 'https://shop.example';
const STORE_API = `${ORIGIN}/wp-json/wc/store/v1/products`;
const GOOD_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'stores',
  'good-woocommerce',
);

const JSON_HEADERS = { 'content-type': 'application/json' };
const EMPTY_LIST: MapResponse = { status: 200, headers: JSON_HEADERS, body: '[]' };

describe('B1.3 Store API not rate-limited for reads', () => {
  const urls = [2, 3, 4].map((perPage) => `${STORE_API}?per_page=${perPage}`);
  const reads = (overrides: Partial<Record<string, MapResponse>> = {}) =>
    mapFetcher(Object.fromEntries(urls.map((url) => [url, overrides[url] ?? EMPTY_LIST])));

  it('passes when three distinct reads answer 200 and sends three real requests', async () => {
    const fetcher = reads();
    const outcome = await runCheck(storeApiNotRateLimited, targetFor(), fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(fetcher.requestCount).toBe(3);
    expect(fetcher.log.map((entry) => entry.url)).toEqual(urls);
    expect(outcome.evidence).toMatchObject({
      requests: urls.map((url) => ({ url, status: 200, headers: {} })),
    });
  });

  it('fails on a 429', async () => {
    const url = urls[2] ?? '';
    const outcome = await runCheck(
      storeApiNotRateLimited,
      targetFor(),
      reads({ [url]: { status: 429, headers: { 'retry-after': '10' }, body: '' } }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('HTTP 429');
    expect(outcome.evidence).toMatchObject({
      requests: [
        { status: 200 },
        { status: 200 },
        { url, status: 429, headers: { 'retry-after': '10' } },
      ],
    });
  });

  it('fails on a 5xx and when nothing answered', async () => {
    const url = urls[1] ?? '';
    const server = await runCheck(
      storeApiNotRateLimited,
      targetFor(),
      reads({ [url]: { status: 503, body: 'down' } }),
    );
    expect(server.verdict).toBe('fail');
    expect(server.message).toBe(`Store API read returned HTTP 503 (${url})`);
    const network = await runCheck(
      storeApiNotRateLimited,
      targetFor(),
      reads({ [url]: { status: 0 } }),
    );
    expect(network.verdict).toBe('fail');
    expect(network.message).toMatch(/no response/);
  });

  it("warns when a read succeeded only on the fetcher's retry after a 429 or 503", async () => {
    const inner = reads();
    const retried: Fetcher = {
      get requestCount() {
        return inner.requestCount;
      },
      budget: inner.budget,
      fetch: async (url: string, options?: FetchOptions) => {
        const response = await inner.fetch(url, options);
        return url === urls[1] ? { ...response, retried: true } : response;
      },
    };
    const outcome = await runCheck(storeApiNotRateLimited, targetFor(), retried);
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      `Store API throttled a sequential read once (${urls[1] ?? ''} answered 429 or 503 first and recovered on retry after Retry-After)`,
    );
    expect(outcome.evidence).toMatchObject({
      requests: [{ status: 200 }, { status: 200, retried: true }, { status: 200 }],
    });
  });

  it('warns when a Retry-After or RateLimit-Retry-After header appears on a 200', async () => {
    for (const header of ['retry-after', 'ratelimit-retry-after']) {
      const outcome = await runCheck(
        storeApiNotRateLimited,
        targetFor(),
        reads({
          [urls[0] ?? '']: { status: 200, headers: { ...JSON_HEADERS, [header]: '5' }, body: '[]' },
        }),
      );
      expect(outcome.verdict, header).toBe('warn');
      expect(outcome.message).toContain(header);
      expect(outcome.evidence).toMatchObject({
        requests: [{ headers: { [header]: '5' } }, { headers: {} }, { headers: {} }],
      });
    }
  });

  it('warns when the remaining quota reaches 0 and records the RateLimit headers', async () => {
    const outcome = await runCheck(
      storeApiNotRateLimited,
      targetFor(),
      reads({
        [urls[2] ?? '']: {
          status: 200,
          headers: {
            ...JSON_HEADERS,
            'RateLimit-Limit': '25',
            'RateLimit-Remaining': '0',
            'RateLimit-Reset': '7',
          },
          body: '[]',
        },
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({
      requests: [
        {},
        {},
        {
          headers: { 'ratelimit-limit': '25', 'ratelimit-remaining': '0', 'ratelimit-reset': '7' },
        },
      ],
    });
  });

  it('passes on the good WooCommerce fixture', async () => {
    const outcome = await runCheck(
      storeApiNotRateLimited,
      targetFor({ origin: 'https://ceramics.example' }),
      fixtureFetcher(GOOD_FIXTURE),
    );
    expect(outcome.verdict).toBe('pass');
  });
});

describe('B1.4 Store API product completeness', () => {
  const url = `${STORE_API}?per_page=20`;
  const complete = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    name: `Product ${id}`,
    permalink: `${ORIGIN}/product/p${id}/`,
    sku: `P${id}`,
    prices: { price: '1000', currency_code: 'EUR' },
    is_in_stock: true,
    images: [{ src: `${ORIGIN}/p${id}.jpg` }],
    categories: [{ id: 1, name: 'Things' }],
    ...overrides,
  });
  const run = (products: unknown[]) =>
    runCheck(
      storeApiProductComplete,
      targetFor(),
      mapFetcher({ [url]: { status: 200, headers: JSON_HEADERS, body: JSON.stringify(products) } }),
    );

  it('passes when every product carries the required fields', async () => {
    const outcome = await run([complete(1), complete(2)]);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      url,
      products_checked: 2,
      incomplete: 0,
      products: [],
    });
  });

  it('warns when some products lack only images or categories', async () => {
    const outcome = await run([
      complete(1),
      complete(2, { images: [] }),
      complete(3, { categories: undefined }),
    ]);
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe('2 of 3 Store API product(s) lack images or categories');
    expect(outcome.evidence).toMatchObject({
      products_checked: 3,
      incomplete: 2,
      products: [
        { id: 2, name: 'Product 2', missing: ['images'] },
        { id: 3, name: 'Product 3', missing: ['categories'] },
      ],
    });
  });

  it('fails when a product lacks a price, a currency or a stock status', async () => {
    const cases: [Record<string, unknown>, string[]][] = [
      [{ prices: { currency_code: 'EUR' } }, ['prices.price']],
      [{ prices: { price: '1000' } }, ['prices.currency_code']],
      [{ prices: undefined }, ['prices.price', 'prices.currency_code']],
      [{ is_in_stock: 'instock' }, ['is_in_stock']],
    ];
    for (const [overrides, missing] of cases) {
      const outcome = await run([complete(1), complete(2, overrides)]);
      expect(outcome.verdict, missing.join()).toBe('fail');
      expect(outcome.message).toBe(
        '1 of 2 Store API product(s) lack a price, currency or stock status',
      );
      expect(outcome.evidence).toMatchObject({ products: [{ id: 2, missing }] });
    }
  });

  it('fails and says so when the list is empty', async () => {
    const outcome = await run([]);
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/empty/);
    expect(outcome.evidence).toMatchObject({ products_checked: 0 });
  });

  it('fails when the list is unavailable or not a JSON array, without throwing', async () => {
    const missing = await runCheck(storeApiProductComplete, targetFor(), mapFetcher({}));
    expect(missing.verdict).toBe('fail');
    expect(missing.message).toBe('Store API product list returned HTTP 404');
    expect(missing.evidence).toMatchObject({ url, status: 404 });
    for (const body of ['{"code":"rest_no_route"}', '<html>challenge</html>', '[{"id":']) {
      const outcome = await runCheck(
        storeApiProductComplete,
        targetFor(),
        mapFetcher({ [url]: { status: 200, headers: JSON_HEADERS, body } }),
      );
      expect(outcome.verdict, body).toBe('fail');
      expect(outcome.message).toBe('Store API product list is not a JSON product array');
    }
  });

  it('passes on the good WooCommerce fixture', async () => {
    const outcome = await runCheck(
      storeApiProductComplete,
      targetFor({ origin: 'https://ceramics.example' }),
      fixtureFetcher(GOOD_FIXTURE),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ products_checked: 2, incomplete: 0 });
  });
});

describe('B1.7 Catalog in sitemap matches Store API', () => {
  const url = `${STORE_API}?per_page=1`;
  const productUrls = (n: number) =>
    Array.from({ length: n }, (_, i) => `${ORIGIN}/product/p${i}/`);
  const urlset = (n: number): SitemapSummary => ({
    url: `${ORIGIN}/sitemap.xml`,
    kind: 'urlset',
    childSitemaps: [],
    fetchedSitemaps: [],
    urls: productUrls(n),
    productUrls: productUrls(n),
  });
  const storeApi = (total: string | null) =>
    mapFetcher({
      [url]: {
        status: 200,
        headers: total === null ? JSON_HEADERS : { ...JSON_HEADERS, 'X-WP-Total': total },
        body: '[{"id":1,"name":"P","permalink":"https://shop.example/product/p0/"}]',
      },
    });
  const run = (sitemap: SitemapSummary | null, total: string | null) =>
    runCheck(sitemapMatchesStoreApi, targetFor({ sitemap }), storeApi(total));

  it('does not apply without a sitemap', async () => {
    const outcome = await run(null, '10');
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });

  it('passes within 10 percent, warns within 25 percent, fails beyond', async () => {
    const expectations: [number, string, string][] = [
      [100, '100', 'pass'],
      [90, '100', 'pass'],
      [100, '110', 'pass'],
      [80, '100', 'warn'],
      [100, '125', 'warn'],
      [70, '100', 'fail'],
      [100, '200', 'fail'],
    ];
    for (const [inSitemap, total, verdict] of expectations) {
      const outcome = await run(urlset(inSitemap), total);
      expect(outcome.verdict, `${inSitemap} vs ${total}`).toBe(verdict);
      expect(outcome.evidence).toMatchObject({
        sitemap_product_urls: inSitemap,
        store_api_total: Number(total),
        ratio: Number((inSitemap / Number(total)).toFixed(3)),
      });
    }
    const exact = await run(urlset(100), '100');
    expect(exact.message).toBe(
      'sitemap lists 100 product URL(s), Store API reports 100 (0 percent apart)',
    );
    expect(exact.evidence).toMatchObject({ deviation: 0 });
  });

  it('fails when one side is empty or the total header is missing', async () => {
    const noUrls = await run(urlset(0), '10');
    expect(noUrls.verdict).toBe('fail');
    expect(noUrls.message).toBe('sitemap lists 0 product URL(s) while the Store API reports 10');
    const noHeader = await run(urlset(10), null);
    expect(noHeader.verdict).toBe('fail');
    expect(noHeader.message).toMatch(/X-WP-Total/);
    expect(noHeader.evidence).toMatchObject({ store_api_total: null, store_api_status: 200 });
    const unavailable = await runCheck(
      sitemapMatchesStoreApi,
      targetFor({ sitemap: urlset(10) }),
      mapFetcher({}),
    );
    expect(unavailable.verdict).toBe('fail');
    expect(unavailable.message).toBe('Store API product list returned HTTP 404');
  });

  it('skips as budget exhausted when a product sitemap was not read', async () => {
    const sitemap: SitemapSummary = {
      url: `${ORIGIN}/wp-sitemap.xml`,
      kind: 'index',
      childSitemaps: [
        `${ORIGIN}/wp-sitemap-posts-product-1.xml`,
        `${ORIGIN}/wp-sitemap-posts-product-2.xml`,
        `${ORIGIN}/wp-sitemap-posts-page-1.xml`,
      ],
      fetchedSitemaps: [`${ORIGIN}/wp-sitemap-posts-product-1.xml`],
      urls: productUrls(2000),
      productUrls: productUrls(2000),
    };
    const outcome = await run(sitemap, '2500');
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'budget_exhausted' });
    expect(outcome.message).toMatch(/unfair/);
    expect(outcome.evidence).toMatchObject({
      sitemap_product_urls: 2000,
      store_api_total: 2500,
      product_sitemaps: [
        `${ORIGIN}/wp-sitemap-posts-product-1.xml`,
        `${ORIGIN}/wp-sitemap-posts-product-2.xml`,
      ],
      fetched_sitemaps: [`${ORIGIN}/wp-sitemap-posts-product-1.xml`],
    });
  });

  it('treats a sitemap as complete when every product child, or every child, was fetched', () => {
    const product = `${ORIGIN}/wp-sitemap-posts-product-1.xml`;
    const page = `${ORIGIN}/wp-sitemap-posts-page-1.xml`;
    const index = (fetched: string[], children = [product, page]) => ({
      kind: 'index' as const,
      childSitemaps: children,
      fetchedSitemaps: fetched,
    });
    expect(sitemapProductCountComplete(index([product]), ORIGIN)).toBe(true);
    expect(sitemapProductCountComplete(index([page]), ORIGIN)).toBe(false);
    expect(
      sitemapProductCountComplete(index(['/post-sitemap.xml'], ['/post-sitemap.xml']), ORIGIN),
    ).toBe(true);
    expect(sitemapProductCountComplete(index([], ['/post-sitemap.xml']), ORIGIN)).toBe(false);
    expect(
      sitemapProductCountComplete(
        { kind: 'urlset', childSitemaps: [], fetchedSitemaps: [] },
        ORIGIN,
      ),
    ).toBe(true);
  });

  it('passes on the good WooCommerce fixture with its product sitemap', async () => {
    const origin = 'https://ceramics.example';
    const products = [`${origin}/product/stoneware-mug/`, `${origin}/product/serving-bowl/`];
    const outcome = await runCheck(
      sitemapMatchesStoreApi,
      targetFor({
        origin,
        sitemap: {
          url: `${origin}/wp-sitemap.xml`,
          kind: 'index',
          childSitemaps: [
            `${origin}/wp-sitemap-posts-product-1.xml`,
            `${origin}/wp-sitemap-posts-page-1.xml`,
          ],
          fetchedSitemaps: [`${origin}/wp-sitemap-posts-product-1.xml`],
          urls: products,
          productUrls: products,
        },
      }),
      fixtureFetcher(GOOD_FIXTURE),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ sitemap_product_urls: 2, store_api_total: 2 });
  });
});

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

  it('recognises an OpenAI-format feed by item_id or sku, url or link and image_url or image_link', async () => {
    const csvUrl = `${origin}/feed/openai.csv`;
    const csv = await runCheck(
      productFeedDiscoverable,
      targetFor({ robots: `# Product feed: ${csvUrl}\nUser-agent: *\nAllow: /\n` }),
      mapFetcher({
        [csvUrl]: {
          status: 200,
          headers: { 'content-type': 'text/csv' },
          body: 'item_id,title,description,url,image_url,price,availability,seller_name\nMUG-1,Mug,Stoneware,https://shop.example/product/mug/,https://shop.example/mug.jpg,24.00 EUR,in_stock,Example\n',
        },
      }),
    );
    expect(csv.verdict).toBe('pass');
    expect(csv.message).toBe(
      `product feed at ${csvUrl} (csv, OpenAI feed columns, 1 item(s) read)`,
    );
    expect(csv.evidence).toMatchObject({
      format: 'csv',
      dialect: 'openai',
      columns: { id: 'item_id', title: 'title', url: 'url', price: 'price', image: 'image_url' },
    });
    const jsonUrl = `${origin}/feed/openai.json`;
    const json = await runCheck(
      productFeedDiscoverable,
      targetFor({ robots: `# Product feed: ${jsonUrl}\nUser-agent: *\nAllow: /\n` }),
      mapFetcher({
        [jsonUrl]: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            items: [
              {
                sku: 'MUG-1',
                title: 'Mug',
                link: 'https://shop.example/product/mug/',
                image_link: 'https://shop.example/mug.jpg',
                price: '24.00 EUR',
              },
            ],
          }),
        },
      }),
    );
    expect(json.verdict).toBe('pass');
    expect(json.evidence).toMatchObject({
      dialect: 'openai',
      columns: { id: 'sku', url: 'link', image: 'image_link' },
    });
    // A Google-style tabular feed is still recognised and labelled as such.
    const googleCsv = `${origin}/feed/google.csv`;
    const google = await runCheck(
      productFeedDiscoverable,
      targetFor({ robots: `# Merchant feed: ${googleCsv}\nUser-agent: *\nAllow: /\n` }),
      mapFetcher({
        [googleCsv]: {
          status: 200,
          headers: { 'content-type': 'text/csv' },
          body: 'id,title,link,price\n1,Mug,https://shop.example/product/mug/,24.00 EUR\n',
        },
      }),
    );
    expect(google.evidence).toMatchObject({ dialect: 'google-tabular' });
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
