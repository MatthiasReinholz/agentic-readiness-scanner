import { describe, expect, it } from 'vitest';

import { mapFetcher } from '../testing/index.js';
import { discoverSitemap, resolveTarget, sitemapCandidates } from './resolver.js';

const ROBOTS = 'User-agent: *\nAllow: /\n';
const MAINTENANCE =
  '<!doctype html><html><head><title>Patagonia</title></head><body><h1>System maintenance is in progress</h1><p>Please check back soon.</p></body></html>';
const HOME =
  '<html><head><title>Shop</title></head><body><a href="/products/mug">Mug</a><a href="/cart">Cart</a></body></html>';
const URLSET = (...locs: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;

describe('resolveTarget on home pages that cannot stand for the site', () => {
  it('treats a maintenance page served for every URL as not evaluated', async () => {
    const fetcher = mapFetcher({
      'https://www.patagonia.example/': MAINTENANCE,
      'https://www.patagonia.example/robots.txt': MAINTENANCE,
    });
    const target = await resolveTarget('https://www.patagonia.example/', fetcher);
    expect(target.blocked).toMatchObject({ status: 200, kind: 'holding_page', vendor: null });
    expect(target.blocked?.detail).toMatch(/maintenance or holding page .*\("Patagonia"\)/);
    expect(target.warnings[0]).toMatch(/^The home page is a maintenance or holding page/);
    expect(target.platform).toBe('unknown');
    expect(target.robots).toBeNull();
    // No sitemap guesses on a blocked home page; robots.txt declares none.
    expect(fetcher.log.map((entry) => entry.url)).toEqual([
      'https://www.patagonia.example/',
      'https://www.patagonia.example/robots.txt',
    ]);
    expect(target.sitemapDiscovery).toMatchObject({ complete: false });
  });

  it('does not take a site whose robots.txt is a different HTML page for a catch-all', async () => {
    const target = await resolveTarget(
      'https://shop.example/',
      mapFetcher({
        'https://shop.example/': HOME,
        'https://shop.example/robots.txt': '<html><head><title>Not found</title></head></html>',
      }),
    );
    expect(target.blocked).toBeUndefined();
  });

  it('treats a challenge page served with HTTP 200 as blocked', async () => {
    const target = await resolveTarget(
      'https://shop.example/',
      mapFetcher({
        'https://shop.example/': {
          status: 200,
          headers: { server: 'cloudflare' },
          body: '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>',
        },
        'https://shop.example/robots.txt': ROBOTS,
      }),
    );
    expect(target.blocked).toMatchObject({
      status: 200,
      vendor: 'Cloudflare',
      challenge: true,
      kind: 'challenge',
    });
  });

  it('treats a redirect to another site as blocked and stays on the typed origin', async () => {
    const fetcher = mapFetcher({
      'https://brand.example/': {
        status: 200,
        body: HOME,
        finalUrl: 'https://www.parent.example/brands/brand/',
        redirects: 1,
      },
      'https://brand.example/robots.txt':
        'User-agent: *\nAllow: /\nSitemap: https://brand.example/sitemap.xml\n',
      'https://brand.example/sitemap.xml': URLSET('https://brand.example/products/a'),
    });
    const target = await resolveTarget('brand.example', fetcher);
    expect(target.blocked).toMatchObject({ kind: 'cross_site_redirect' });
    expect(target.blocked?.detail).toMatch(/another site \(www\.parent\.example\)/);
    expect(target.origin).toBe('https://brand.example');
    // Only the declared sitemap is fetched, and it counts as a complete discovery.
    expect(target.sitemap?.url).toBe('https://brand.example/sitemap.xml');
    expect(target.sitemapDiscovery).toEqual({
      complete: true,
      tried: ['https://brand.example/sitemap.xml'],
    });
  });

  it('treats a redirect to a consent gate as blocked', async () => {
    const target = await resolveTarget(
      'https://shop.example/',
      mapFetcher({
        'https://shop.example/': {
          status: 200,
          body: '<html><body>Choose your cookies</body></html>',
          finalUrl: 'https://shop.example/privacy-gate?return=%2F',
          redirects: 1,
        },
        'https://shop.example/robots.txt': ROBOTS,
      }),
    );
    expect(target.blocked).toMatchObject({ kind: 'consent_gate' });
    expect(target.blocked?.detail).toMatch(/consent or region gate \(\/privacy-gate\)/);
  });

  it('allows www, apex and https redirects on the same site', async () => {
    const target = await resolveTarget(
      'http://shop.example/',
      mapFetcher({
        'http://shop.example/': {
          status: 200,
          body: HOME,
          finalUrl: 'https://www.shop.example/en-us/',
          redirects: 2,
        },
        'https://www.shop.example/robots.txt': ROBOTS,
      }),
    );
    expect(target.blocked).toBeUndefined();
    expect(target.origin).toBe('https://www.shop.example');
  });
});

describe('sitemap discovery', () => {
  it('orders guesses by platform and never guesses /wp-sitemap.xml off WordPress', () => {
    const origin = 'https://shop.example';
    const robots = null;
    expect(sitemapCandidates(origin, robots, 'woocommerce')).toEqual([
      `${origin}/wp-sitemap.xml`,
      `${origin}/sitemap_index.xml`,
      `${origin}/sitemap.xml`,
    ]);
    expect(sitemapCandidates(origin, robots, 'shopify')).toEqual([
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
    ]);
    expect(sitemapCandidates(origin, robots, 'unknown')).not.toContain(`${origin}/wp-sitemap.xml`);
    expect(sitemapCandidates(origin, robots, 'shopify', true)).toEqual([]);
  });

  it('puts the sitemaps robots.txt declares first', () => {
    const robots = {
      groups: [],
      sitemaps: ['https://shop.example/custom.xml'],
      contentSignals: null,
      usageLines: [],
      unknownLines: [],
    };
    expect(sitemapCandidates('https://shop.example', robots, 'wordpress')[0]).toBe(
      'https://shop.example/custom.xml',
    );
  });

  it('stops at the first 429 or 5xx and reports discovery as incomplete', async () => {
    for (const status of [429, 503]) {
      const fetcher = mapFetcher({ 'https://shop.example/sitemap.xml': { status, body: '' } });
      const result = await discoverSitemap(
        'https://shop.example',
        null,
        fetcher,
        { maxFetches: 4, platform: 'shopify' },
        [],
      );
      expect(result.sitemap).toBeNull();
      expect(result.discovery).toEqual({
        complete: false,
        reason: `https://shop.example/sitemap.xml answered HTTP ${status}, so discovery stopped there`,
        tried: ['https://shop.example/sitemap.xml'],
      });
      expect(fetcher.log.map((entry) => entry.url)).toEqual(['https://shop.example/sitemap.xml']);
    }
  });

  it('is complete when every guess answered 404, and incomplete when one got no answer', async () => {
    const none = await discoverSitemap(
      'https://shop.example',
      null,
      mapFetcher({}),
      { maxFetches: 4, platform: 'shopify' },
      [],
    );
    expect(none.discovery).toEqual({
      complete: true,
      tried: ['https://shop.example/sitemap.xml', 'https://shop.example/sitemap_index.xml'],
    });
    const offline = await discoverSitemap(
      'https://shop.example',
      null,
      mapFetcher({ 'https://shop.example/sitemap.xml': { status: 0 } }),
      { maxFetches: 4, platform: 'shopify' },
      [],
    );
    expect(offline.discovery.complete).toBe(false);
    expect(offline.discovery.reason).toMatch(/sitemap\.xml could not be fetched/);
  });

  it('is incomplete when the fetch allowance ran out before every candidate was tried', async () => {
    const result = await discoverSitemap(
      'https://shop.example',
      null,
      mapFetcher({}),
      { maxFetches: 1, platform: 'woocommerce' },
      [],
    );
    expect(result.discovery.complete).toBe(false);
    expect(result.discovery.reason).toMatch(/stopped after 1 sitemap request/);
  });

  it('stops reading child sitemaps at a 429', async () => {
    const warnings: string[] = [];
    const index = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://shop.example/sitemap_products_1.xml</loc></sitemap><sitemap><loc>https://shop.example/sitemap_products_2.xml</loc></sitemap></sitemapindex>`;
    const fetcher = mapFetcher({
      'https://shop.example/sitemap.xml': index,
      'https://shop.example/sitemap_products_1.xml': { status: 429, body: '' },
      'https://shop.example/sitemap_products_2.xml': URLSET('https://shop.example/products/a'),
    });
    const result = await discoverSitemap(
      'https://shop.example',
      null,
      fetcher,
      { maxFetches: 4, platform: 'shopify' },
      warnings,
    );
    expect(result.sitemap?.kind).toBe('index');
    expect(result.discovery.complete).toBe(true);
    expect(fetcher.log.map((entry) => entry.url)).not.toContain(
      'https://shop.example/sitemap_products_2.xml',
    );
    expect(warnings[0]).toMatch(/answered HTTP 429, so no further child sitemaps were fetched/);
  });

  it('records a budget cut as an incomplete discovery on the target', async () => {
    const target = await resolveTarget(
      'https://shop.example/',
      mapFetcher(
        { 'https://shop.example/': HOME, 'https://shop.example/robots.txt': ROBOTS },
        { budget: 2 },
      ),
    );
    expect(target.sitemap).toBeNull();
    expect(target.sitemapDiscovery?.complete).toBe(false);
    expect(target.sitemapDiscovery?.reason).toMatch(/cut short: Request budget of 2 exhausted/);
  });
});
