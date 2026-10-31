import { describe, expect, it } from 'vitest';

import { HtmlDocument } from '../parsers/html.js';
import type { FetchedResponse } from '../http/types.js';
import { detectPlatform, findPolicyLinks } from './resolver.js';

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
