import { describe, expect, it } from 'vitest';

import type { FetchedResponse } from '../http/types.js';
import { HtmlDocument } from '../parsers/html.js';
import { matchPlatform } from './platforms.js';
import { selectProfile } from './resolver.js';

function page(html: string, headers: Record<string, string> = {}): FetchedResponse {
  return {
    url: 'https://shop.example/',
    finalUrl: 'https://shop.example/',
    status: 200,
    headers: { 'content-type': 'text/html', ...headers },
    body: html,
    bytes: html.length,
    truncated: false,
    redirects: 0,
    durationMs: 1,
    fromCache: false,
  };
}

const detect = (html: string, headers: Record<string, string> = {}) =>
  matchPlatform(new HtmlDocument(html), page(html, headers));

describe('matchPlatform', () => {
  it.each([
    [
      'bigcommerce',
      '<html><body></body></html>',
      { 'x-bc-store-id': '1001' },
      'x-bc-store-id header',
    ],
    [
      'bigcommerce',
      '<html><head><script src="https://cdn11.bigcommerce.com/s-abc/theme.js"></script></head></html>',
      {},
      'BigCommerce CDN assets',
    ],
    [
      'magento',
      '<html><body><script type="text/x-magento-init">{}</script></body></html>',
      {},
      'x-magento-init script',
    ],
    [
      'magento',
      '<html><head><link rel="stylesheet" href="/static/version1712345/frontend/Hyva/default/en_US/css/styles.css"></head></html>',
      {},
      'Magento static asset path',
    ],
    [
      'shopware',
      '<html><head><script src="/bundles/storefront/storefront/js/storefront.js"></script></head></html>',
      {},
      'Shopware storefront bundle',
    ],
    ['shopware', '<html></html>', { 'sw-language-id': 'abc' }, 'sw-language-id header'],
    [
      'prestashop',
      '<html><script>var prestashop = {"cart":{}};</script></html>',
      {},
      'prestashop script object',
    ],
    [
      'salesforce',
      '<html><link href="/on/demandware.static/Sites-Shop-Site/-/default/css/global.css"></html>',
      {},
      'demandware asset path',
    ],
    [
      'square',
      '<html><head><meta name="generator" content="Square Online"></head></html>',
      {},
      'Square Online generator',
    ],
    [
      'ecwid',
      '<html><head><meta name="generator" content="WordPress 6.9"></head><body><script src="https://app.ecwid.com/script.js?1003"></script></body></html>',
      {},
      'Ecwid storefront script',
    ],
    [
      'ecwid',
      '<html><head><meta name="generator" content="ec-instant-site"></head></html>',
      {},
      'Ecwid Instant Site generator',
    ],
    ['wix', '<html></html>', { 'x-wix-request-id': '1.2' }, 'x-wix-request-id header'],
    [
      'wix',
      '<html><head><meta name="generator" content="Wix.com Website Builder"></head></html>',
      {},
      'Wix generator',
    ],
    ['squarespace', '<html><!-- This is Squarespace. --></html>', {}, 'Squarespace page comment'],
    ['squarespace', '<html></html>', { server: 'Squarespace' }, 'Squarespace server header'],
    [
      'webflow',
      '<html data-wf-site="64ab" data-wf-page="64cd"><body></body></html>',
      {},
      'data-wf-site attribute',
    ],
    [
      'wordpress',
      '<html><head><link rel="https://api.w.org/" href="/wp-json/"></head></html>',
      {},
      'REST API discovery link',
    ],
  ])('recognises %s (%s)', (platform, html, headers, signal) => {
    expect(detect(html, headers)).toEqual({ platform, signal });
  });

  it('prefers the store platform over the site builder that hosts it', () => {
    const html =
      '<html><head><meta name="generator" content="WordPress 6.9"></head><body class="woocommerce"></body></html>';
    expect(detect(html).platform).toBe('woocommerce');
  });

  it('reports no signal when nothing matches', () => {
    expect(detect('<html><body><p>Hello</p></body></html>')).toEqual({
      platform: 'unknown',
      signal: null,
    });
  });
});

describe('selectProfile', () => {
  it('treats store platforms as stores and site builders by their store signals', () => {
    expect(selectProfile('magento', false).id).toBe('other-store');
    expect(selectProfile('bigcommerce', false).id).toBe('other-store');
    expect(selectProfile('wix', false).id).toBe('content-site');
    expect(selectProfile('squarespace', true).id).toBe('other-store');
  });
});
