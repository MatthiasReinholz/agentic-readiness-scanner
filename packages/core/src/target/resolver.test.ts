import { describe, expect, it } from 'vitest';

import { HtmlDocument } from '../parsers/html.js';
import type { FetchedResponse } from '../http/types.js';
import { mapFetcher } from '../testing/index.js';
import {
  chooseListing,
  detectPlatform,
  discoverProductsBySampling,
  findPolicyLinks,
  hasStoreSignals,
  isListingPath,
  isShopifyServed,
  policyLinkScore,
  resolveTarget,
} from './resolver.js';

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

  it('skips links into the account, login, cart and checkout areas', () => {
    const doc = new HtmlDocument(`
      <a href="/my-account/contact-support/">Contact support</a>
      <a href="/account/returns/">Start a return</a>
      <a href="/checkout/?shipping=1">Shipping options</a>
      <a href="/contact-us/">Contact us</a>
      <a href="/returns-policy/">Returns policy</a>`);
    expect(findPolicyLinks(doc, 'https://shop.example')).toEqual({
      contact: 'https://shop.example/contact-us/',
      returns: 'https://shop.example/returns-policy/',
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

describe('Shopify policy page fallback', () => {
  it('fills in the conventional /policies/* pages that the footer did not link', async () => {
    const { addShopifyPolicyPages } = await import('./resolver.js');
    const { mapFetcher } = await import('../testing/index.js');
    const policies: Partial<Record<'returns' | 'shipping' | 'privacy' | 'terms', string>> = {
      privacy: 'https://boots.example/pages/privacy',
    };
    const fetcher = mapFetcher({
      'https://boots.example/policies/refund-policy':
        '<html><title>Refund policy</title><body>30 days</body></html>',
      'https://boots.example/policies/terms-of-service':
        '<html><title>Opening soon - password</title><body></body></html>',
    });
    await addShopifyPolicyPages(policies, 'https://boots.example', fetcher);
    expect(policies).toEqual({
      privacy: 'https://boots.example/pages/privacy',
      returns: 'https://boots.example/policies/refund-policy',
    });
    expect(fetcher.log.map((entry) => entry.url)).not.toContain(
      'https://boots.example/policies/privacy-policy',
    );
  });
});

describe('findPolicyLinks ranking', () => {
  it('prefers a footer policy label over a product whose name carries the keyword', () => {
    const doc = new HtmlDocument(`<html><body>
      <nav><a href="/woocommerce-shipping/">WooCommerce Shipping</a><a href="/products/returns-manager/">Returns Manager</a></nav>
      <footer><a href="/shipping-policy/">Shipping &amp; Returns</a><a href="/refund-policy/">Refund policy</a></footer>
    </body></html>`);
    expect(findPolicyLinks(doc, 'https://shop.example')).toMatchObject({
      shipping: 'https://shop.example/shipping-policy/',
      returns: 'https://shop.example/refund-policy/',
    });
  });

  it('never picks product or listing URLs, and still falls back to a body link when nothing better exists', () => {
    const doc = new HtmlDocument(`<html><body>
      <a href="/products/free-delivery-kit/">Free delivery kit</a>
      <a href="/collections/returns/">Returns collection</a>
      <p>See our <a href="/help/delivery">delivery information</a>.</p>
    </body></html>`);
    expect(findPolicyLinks(doc, 'https://shop.example')).toEqual({
      shipping: 'https://shop.example/help/delivery',
    });
  });

  it('scores the label, the footer and the path', () => {
    const anchor = (text: string, inFooter = false) => ({ href: '/x', text, inFooter });
    expect(
      policyLinkScore(anchor('Shipping & returns', true), '/shipping-policy/', 'shipping'),
    ).toBe(7);
    expect(
      policyLinkScore(anchor('WooCommerce Shipping', true), '/woocommerce-shipping/', 'shipping'),
    ).toBe(6);
    expect(policyLinkScore(anchor('Shipping'), '/pages/about', 'shipping')).toBe(4);
    expect(policyLinkScore(anchor('About us'), '/shipping/', 'shipping')).toBe(1);
    expect(policyLinkScore(anchor('About us'), '/about/', 'shipping')).toBe(0);
  });
});

describe('resolveTarget on a refused home page', () => {
  const pages = (status: number, headers: Record<string, string>, body: string) => ({
    budget: 40,
    requestCount: 0,
    fetch: (url: string) =>
      Promise.resolve({
        url,
        finalUrl: url,
        status: url.endsWith('/robots.txt') ? 200 : status,
        headers: url.endsWith('/robots.txt') ? {} : headers,
        body: url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /\n' : body,
        bytes: body.length,
        truncated: false,
        redirects: 0,
        durationMs: 1,
        fromCache: false,
      }),
  });

  it('records the refusal and its vendor instead of throwing, and assumes a store', async () => {
    const target = await resolveTarget(
      'https://www.shop.example/',
      pages(
        403,
        { server: 'AkamaiGHost' },
        '<html><body>Access Denied Reference #18.1f6c.1</body></html>',
      ),
    );
    expect(target.blocked).toEqual({ status: 403, vendor: 'Akamai', challenge: false });
    expect(target.platform).toBe('unknown');
    expect(target.profile.id).toBe('other-store');
    expect(target.sampled.products).toEqual([]);
    expect(target.warnings[0]).toMatch(
      /home page refused the scanner's honest request \(HTTP 403, Akamai\)/,
    );
  });

  it('recognises a challenge page served with 429', async () => {
    const target = await resolveTarget(
      'https://www.shop.example/',
      pages(429, { 'x-vercel-mitigated': 'challenge' }, '<html><body>Verifying</body></html>'),
    );
    expect(target.blocked).toEqual({ status: 429, vendor: 'Vercel', challenge: true });
  });

  it('still throws when there is no site to scan', async () => {
    await expect(
      resolveTarget('https://www.shop.example/', pages(404, {}, 'nope')),
    ).rejects.toThrow(/HTTP 404/);
    await expect(
      resolveTarget('https://www.shop.example/', pages(503, {}, 'down')),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe('store signals and listing choice', () => {
  it('recognises a German store without platform markers or product URL patterns', () => {
    const body =
      '<html><body><a href="/de/yamaha_p_525.htm">Yamaha P-525</a><button>In den Warenkorb</button><a href="/de/warenkorb">Warenkorb</a></body></html>';
    expect(hasStoreSignals(new HtmlDocument(body), body)).toBe(true);
    const blog = '<html><body><article>Hello</article></body></html>';
    expect(hasStoreSignals(new HtmlDocument(blog), blog)).toBe(false);
    const jsonld =
      '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"X"}</script></head><body></body></html>';
    expect(hasStoreSignals(new HtmlDocument(jsonld), jsonld)).toBe(true);
  });

  it('prefers a concrete collection over a product page or a bare shop index', () => {
    expect(
      chooseListing([
        'https://shop.example/products/colour-me-merry',
        'https://shop.example/collections/eyes',
        'https://shop.example/collections/eyes',
        'https://shop.example/collections/lips',
        'https://shop.example/shop/',
      ]),
    ).toBe('https://shop.example/collections/eyes');
    expect(chooseListing(['https://shop.example/products/a', 'https://shop.example/about'])).toBe(
      undefined,
    );
    expect(chooseListing(['https://shop.example/shop/'])).toBe('https://shop.example/shop/');
    expect(isListingPath('/us/en/cat/products-products/')).toBe(true);
    expect(isListingPath('/products-feed.xml')).toBe(false);
  });
});

describe('isShopifyServed', () => {
  it('tells a Shopify-served origin from a headless storefront', () => {
    const base = response('<html></html>');
    expect(isShopifyServed({ ...base, headers: { 'x-shopid': '123' } })).toBe(true);
    expect(isShopifyServed({ ...base, headers: { 'powered-by': 'Shopify' } })).toBe(true);
    expect(
      isShopifyServed({
        ...base,
        headers: { link: '</.well-known/ucp>; rel="ucp"; version="2026-08-25"' },
      }),
    ).toBe(true);
    expect(isShopifyServed({ ...base, headers: { server: 'CloudFront' } })).toBe(false);
  });
});

describe('discoverProductsBySampling', () => {
  it('fetches a few linked pages and keeps the ones that are product pages', async () => {
    const product =
      '<html><body><h1>Yamaha P-525</h1><button class="add-to-cart">In den Warenkorb</button></body></html>';
    const fetcher = mapFetcher({
      'https://shop.example/de/yamaha_p_525.htm': product,
      'https://shop.example/de/focusrite_2i2.htm': product,
      'https://shop.example/de/helpdesk_shipping.html': '<html><body>Versandkosten</body></html>',
    });
    const warnings: string[] = [];
    const found = await discoverProductsBySampling(
      [
        'https://shop.example/',
        'https://shop.example/de/helpdesk_shipping.html',
        'https://shop.example/de/compinfo_imprint.html',
        'https://shop.example/de/yamaha_p_525.htm',
        'https://shop.example/de/focusrite_2i2.htm',
        'https://shop.example/blog/post/',
      ],
      'shop.example',
      fetcher,
      2,
      warnings,
    );
    expect(found.sort()).toEqual([
      'https://shop.example/de/focusrite_2i2.htm',
      'https://shop.example/de/yamaha_p_525.htm',
    ]);
    expect(warnings[0]).toMatch(/2 product page\(s\) were found by fetching/);
    expect(fetcher.requestCount).toBeLessThanOrEqual(4);
  });
});

describe('policy links: brand names and help centres elsewhere', () => {
  it('ignores a product that carries the site name next to a policy word', () => {
    const doc = new HtmlDocument(
      '<footer><a href="/woocommerce-shipping/">WooCommerce Shipping</a><a href="/shipping-policy/">Shipping policy</a></footer>',
    );
    expect(findPolicyLinks(doc, 'https://woocommerce.com')).toMatchObject({
      shipping: 'https://woocommerce.com/shipping-policy/',
    });
    const only = new HtmlDocument(
      '<footer><a href="/woocommerce-shipping/">WooCommerce Shipping</a></footer>',
    );
    expect(findPolicyLinks(only, 'https://woocommerce.com')).toEqual({});
  });

  it('prefers a labelled help centre on another host over a same-origin stray match', () => {
    const doc = new HtmlDocument(
      '<a href="/pages/sports-bras?banner_id=guide">Find your support</a><footer><a href="https://support.gymshark.com/">Help</a></footer>',
    );
    expect(findPolicyLinks(doc, 'https://www.gymshark.com')).toMatchObject({
      contact: 'https://support.gymshark.com/',
    });
  });
});
