import { describe, expect, it } from 'vitest';

import { HtmlDocument } from '../parsers/html.js';
import type { FetchedResponse } from '../http/types.js';
import { mapFetcher } from '../testing/index.js';
import { detectPlatform, findPolicyLinks, resolveTarget } from './resolver.js';

function response(body: string): FetchedResponse {
  return {
    url: 'https://shop.example/',
    finalUrl: 'https://shop.example/',
    status: 200,
    headers: {},
    body,
    bytes: body.length,
    truncated: false,
    redirects: 0,
    durationMs: 1,
    fromCache: false,
  };
}

describe('resolveTarget', () => {
  it('ignores sitemap entries that are relative, malformed or on another origin', async () => {
    const pages: Record<string, { body: string; type?: string }> = {
      'https://shop.example/': {
        body: '<html><body class="woocommerce"><a href="/product/a/">A</a></body></html>',
      },
      'https://shop.example/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
      'https://shop.example/sitemap.xml': {
        body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://shop.example/product/a/</loc></url><url><loc>/product/relative/</loc></url><url><loc>not a url</loc></url><url><loc>https://evil.example/product/x/</loc></url></urlset>',
        type: 'application/xml',
      },
    };
    const fetcher = {
      budget: 40,
      requestCount: 0,
      fetch: (url: string) => {
        const page = pages[url];
        return Promise.resolve({
          url,
          finalUrl: url,
          status: page ? 200 : 404,
          headers: { 'content-type': page?.type ?? 'text/html' },
          body: page?.body ?? '',
          bytes: 0,
          truncated: false,
          redirects: 0,
          durationMs: 1,
          fromCache: false,
        });
      },
    };
    const target = await resolveTarget('https://shop.example', fetcher);
    expect(target.sitemap?.urls).toEqual(['https://shop.example/product/a/']);
    expect(target.sampled.products).toEqual(['https://shop.example/product/a/']);
  });
});

describe('detectPlatform', () => {
  it('recognizes Shopify by an asset served from its CDN host', () => {
    const html =
      '<html><head><script src="//cdn.shopify.com/s/files/1/theme.js"></script></head><body></body></html>';
    expect(detectPlatform(new HtmlDocument(html), response(html))).toBe('shopify');
  });

  it('does not treat a mention of the CDN host in text or a look-alike host as Shopify', () => {
    const html =
      '<html><body><p>Hosted on cdn.shopify.com? No.</p><img src="https://cdn.shopify.com.evil.example/x.png"></body></html>';
    expect(detectPlatform(new HtmlDocument(html), response(html))).toBe('unknown');
  });

  it('recognizes WooCommerce by the body class', () => {
    const html = '<html><body class="home woocommerce"></body></html>';
    expect(detectPlatform(new HtmlDocument(html), response(html))).toBe('woocommerce');
  });
});

describe('findPolicyLinks', () => {
  it('prefers same-origin links and keeps cross-origin ones as a fallback', () => {
    const doc = new HtmlDocument(`
      <footer>
        <a href="https://parent.example/privacy/">Privacy</a>
        <a href="/returns/">Returns</a>
        <a href="/legal/terms/">Terms</a>
        <a href="/">Home</a>
      </footer>`);
    expect(findPolicyLinks(doc, 'https://shop.example')).toEqual({
      privacy: 'https://parent.example/privacy/',
      returns: 'https://shop.example/returns/',
      terms: 'https://shop.example/legal/terms/',
    });
  });

  it('matches localized link text', () => {
    const doc = new HtmlDocument(
      '<a href="/widerrufsbelehrung/">Widerrufsbelehrung</a><a href="/versand/">Versand</a><a href="/impressum/">Impressum</a>',
    );
    expect(findPolicyLinks(doc, 'https://shop.example')).toEqual({
      returns: 'https://shop.example/widerrufsbelehrung/',
      shipping: 'https://shop.example/versand/',
      imprint: 'https://shop.example/impressum/',
    });
  });
});

describe('resolveTarget sitemap lastmod', () => {
  it('records the lastmod of every URL entry read, across index children, in order', async () => {
    const fetcher = mapFetcher({
      'https://shop.example/': '<html><body class="woocommerce"></body></html>',
      'https://shop.example/sitemap.xml':
        '<sitemapindex><sitemap><loc>https://shop.example/page-sitemap.xml</loc></sitemap><sitemap><loc>https://shop.example/product-sitemap.xml</loc></sitemap></sitemapindex>',
      'https://shop.example/product-sitemap.xml':
        '<urlset><url><loc>https://shop.example/product/a/</loc><lastmod>2026-10-01</lastmod></url><url><loc>https://shop.example/product/b/</loc></url><url><loc>https://evil.example/product/c/</loc><lastmod>2026-10-03</lastmod></url></urlset>',
      'https://shop.example/page-sitemap.xml':
        '<urlset><url><loc>https://shop.example/about/</loc><lastmod>2026-09-01T10:00:00Z</lastmod></url></urlset>',
    });
    const target = await resolveTarget('shop.example', fetcher);
    // Product sitemaps are read first and the walk stops once product URLs are found.
    expect(target.sitemap?.urls).toEqual([
      'https://shop.example/product/a/',
      'https://shop.example/product/b/',
    ]);
    expect(target.sitemap?.lastmods).toEqual(['2026-10-01']);
  });
});
