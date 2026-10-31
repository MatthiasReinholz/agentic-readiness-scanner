import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { SitemapSummary } from '../../target/types.js';
import {
  fixtureFetcher,
  mapFetcher,
  runCheck,
  targetFor,
  type MapResponse,
} from '../../testing/index.js';
import {
  sitemapMatchesStoreApi,
  sitemapProductCountComplete,
  storeApiNotRateLimited,
  storeApiProductComplete,
} from './index.js';

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
