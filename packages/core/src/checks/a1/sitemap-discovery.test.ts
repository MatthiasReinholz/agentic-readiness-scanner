import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import { productUrlsInSitemap, sitemapReachable } from './index.js';

describe('A1.2 when no sitemap was read', () => {
  it('skips with reason error instead of failing when discovery did not finish', async () => {
    const target = {
      ...targetFor(),
      sitemapDiscovery: {
        complete: false,
        reason: 'https://shop.example/sitemap.xml answered HTTP 429, so discovery stopped there',
        tried: ['https://shop.example/sitemap.xml'],
      },
    };
    const outcome = await runCheck(sitemapReachable, target, mapFetcher({}));
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('error');
    expect(outcome.message).toBe(
      'could not tell whether a sitemap exists: https://shop.example/sitemap.xml answered HTTP 429, so discovery stopped there',
    );
    expect(outcome.evidence).toMatchObject({ tried: ['https://shop.example/sitemap.xml'] });
  });

  it('fails naming the paths it tried when every request answered', async () => {
    const target = {
      ...targetFor({ platform: 'shopify' }),
      sitemapDiscovery: {
        complete: true,
        tried: ['https://shop.example/sitemap.xml', 'https://shop.example/sitemap_index.xml'],
      },
    };
    const outcome = await runCheck(sitemapReachable, target, mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('no sitemap found via /sitemap.xml, /sitemap_index.xml');
  });

  it('keeps the old message for a target built without a discovery record', async () => {
    const outcome = await runCheck(sitemapReachable, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/^no sitemap found via robots\.txt, \/sitemap\.xml/);
  });
});

describe('A1.2 sitemap protocol limits', () => {
  const sitemap = {
    url: 'https://shop.example/sitemap.xml',
    kind: 'index' as const,
    childSitemaps: ['https://shop.example/sitemap-products-1.xml'],
    fetchedSitemaps: ['https://shop.example/sitemap-products-1.xml'],
    urls: ['https://shop.example/product/a/'],
    productUrls: ['https://shop.example/product/a/'],
  };

  it('passes a sitemap index within the limits and names its shape', async () => {
    const outcome = await runCheck(sitemapReachable, targetFor({ sitemap }), mapFetcher({}));
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(/sitemap index .* with 1 child sitemap/);
  });

  it('warns when a sitemap file declares more than 50 MB', async () => {
    const oversized = [{ url: 'https://shop.example/sitemap-products-1.xml', bytes: 80_000_000 }];
    const outcome = await runCheck(
      sitemapReachable,
      targetFor({ sitemap: { ...sitemap, oversized } }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/50,000 entries and 50 MB .*sitemap-products-1\.xml is 76 MB/);
    expect(outcome.evidence.oversized).toEqual(oversized);
  });
});

describe('A1.3 product URLs recognised by their identifier', () => {
  it('passes and says how the URLs were recognised', async () => {
    const productUrls = [
      'https://shop.example/blue-sock/PLID211',
      'https://shop.example/red-sock/PLID212',
    ];
    const sitemap = {
      url: 'https://shop.example/sitemap.xml',
      kind: 'urlset' as const,
      childSitemaps: [],
      fetchedSitemaps: [],
      urls: productUrls,
      productUrls,
      productUrlsBy: 'id-shape' as const,
    };
    const outcome = await runCheck(productUrlsInSitemap, targetFor({ sitemap }), mapFetcher({}));
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(/recognised by the product identifier .*\/blue-sock\/PLID211/);
    expect(outcome.evidence.recognised_by).toBe('id-shape');
  });
});
