import type { KnownPlatform, Platform } from '@agentic-readiness/catalog';

import type { FetchedResponse } from '../http/types.js';
import type { HtmlDocument } from '../parsers/html.js';

/** What a fingerprint can look at: the home page as parsed and as served. */
interface Page {
  generator: string;
  classes: string[];
  /** The body, lower-cased. */
  body: string;
  headers: Record<string, string>;
  hosts: Set<string>;
  doc: HtmlDocument;
}

interface Fingerprint {
  /** What matched, as the B1.1 evidence names it. */
  signal: string;
  test: (page: Page) => boolean;
}

const hostMatches = (page: Page, pattern: RegExp): boolean =>
  [...page.hosts].some((host) => pattern.test(host));

/**
 * Platform fingerprints in the order they are tried, never trust decisions. A store
 * platform comes before a site builder that can host it: an Ecwid store embedded in a
 * WordPress or Wix site is an Ecwid store, WooCommerce is WordPress with a shop. None of
 * these signals is documented by its vendor as a fingerprint; each was seen on live
 * stores and is matched loosely enough to survive theme changes.
 */
const FINGERPRINTS: readonly (readonly [KnownPlatform, readonly Fingerprint[]])[] = [
  [
    'woocommerce',
    [
      { signal: 'woocommerce body class', test: (p) => p.classes.includes('woocommerce') },
      { signal: 'WooCommerce generator', test: (p) => p.generator.includes('woocommerce') },
      { signal: 'WooCommerce blocks markup', test: (p) => p.body.includes('wc-block') },
      { signal: 'WooCommerce REST route', test: (p) => p.body.includes('/wp-json/wc/') },
    ],
  ],
  [
    'shopify',
    [
      { signal: 'Shopify generator', test: (p) => p.generator.includes('shopify') },
      { signal: 'cdn.shopify.com assets', test: (p) => p.hosts.has('cdn.shopify.com') },
      { signal: 'Shopify.theme script', test: (p) => p.body.includes('shopify.theme') },
    ],
  ],
  [
    'bigcommerce',
    [
      { signal: 'x-bc-store-id header', test: (p) => p.headers['x-bc-store-id'] !== undefined },
      {
        signal: 'BigCommerce CDN assets',
        test: (p) => hostMatches(p, /^cdn\d*\.bigcommerce\.com$/),
      },
      { signal: 'Stencil bootstrap script', test: (p) => p.body.includes('stencilbootstrap') },
    ],
  ],
  [
    'magento',
    [
      { signal: 'x-magento-init script', test: (p) => p.body.includes('text/x-magento-init') },
      {
        signal: 'Magento static asset path',
        test: (p) => /\/static\/(?:version\d+\/)?frontend\/[\w-]+\/[\w-]+\//.test(p.body),
      },
      {
        signal: 'x-magento header',
        test: (p) => Object.keys(p.headers).some((name) => name.startsWith('x-magento-')),
      },
    ],
  ],
  [
    'shopware',
    [
      {
        signal: 'Shopware storefront bundle',
        test: (p) => p.body.includes('/bundles/storefront/'),
      },
      {
        signal: 'sw-language-id header',
        test: (p) =>
          p.headers['sw-language-id'] !== undefined || p.headers['sw-currency-id'] !== undefined,
      },
      { signal: 'Shopware generator', test: (p) => p.generator.includes('shopware') },
    ],
  ],
  [
    'prestashop',
    [
      { signal: 'prestashop script object', test: (p) => /var prestashop\s*=/.test(p.body) },
      { signal: 'PrestaShop generator', test: (p) => p.generator.includes('prestashop') },
      {
        signal: 'Powered-By header',
        test: (p) => /prestashop/i.test(p.headers['powered-by'] ?? ''),
      },
    ],
  ],
  [
    'salesforce',
    [
      {
        signal: 'demandware asset path',
        test: (p) =>
          p.body.includes('/on/demandware.static/') || p.body.includes('/on/demandware.store/'),
      },
      {
        signal: 'demandware CDN assets',
        test: (p) => hostMatches(p, /demandware\.(net|edgesuite\.net)$/),
      },
    ],
  ],
  [
    'square',
    [
      { signal: 'Square Online generator', test: (p) => p.generator.includes('square online') },
      { signal: 'editmysite.com assets', test: (p) => hostMatches(p, /(^|\.)editmysite\.com$/) },
    ],
  ],
  [
    'ecwid',
    [
      {
        signal: 'Ecwid Instant Site generator',
        test: (p) => p.generator.includes('ec-instant-site'),
      },
      {
        signal: 'Ecwid storefront script',
        test: (p) => p.body.includes('app.ecwid.com/script.js'),
      },
      { signal: 'Ecwid assets', test: (p) => p.hosts.has('app.ecwid.com') },
    ],
  ],
  [
    'wix',
    [
      {
        signal: 'x-wix-request-id header',
        test: (p) => p.headers['x-wix-request-id'] !== undefined,
      },
      { signal: 'Wix generator', test: (p) => p.generator.includes('wix.com') },
      {
        signal: 'Wix static assets',
        test: (p) => p.hosts.has('static.parastorage.com') || p.hosts.has('static.wixstatic.com'),
      },
    ],
  ],
  [
    'squarespace',
    [
      {
        signal: 'Squarespace server header',
        test: (p) => /squarespace/i.test(p.headers.server ?? ''),
      },
      { signal: 'Squarespace page comment', test: (p) => p.body.includes('this is squarespace.') },
      { signal: 'Squarespace context script', test: (p) => p.body.includes('squarespace_context') },
    ],
  ],
  [
    'webflow',
    [
      {
        signal: 'data-wf-site attribute',
        test: (p) => p.doc.find('html', 'data-wf-site', /\S/).length > 0,
      },
      { signal: 'Webflow generator', test: (p) => p.generator.includes('webflow') },
    ],
  ],
  [
    'wordpress',
    [
      { signal: 'WordPress generator', test: (p) => p.generator.includes('wordpress') },
      {
        signal: 'REST API discovery link',
        test: (p) => p.doc.links().some((link) => link.rel === 'https://api.w.org/'),
      },
      { signal: 'wp-content assets', test: (p) => p.body.includes('/wp-content/') },
    ],
  ],
];

export interface PlatformMatch {
  platform: Platform;
  /** The fingerprint that decided, or null when none matched. */
  signal: string | null;
}

/** The platform the home page shows, with the fingerprint that decided it. */
export function matchPlatform(doc: HtmlDocument, response: FetchedResponse): PlatformMatch {
  const page: Page = {
    generator: (doc.meta('generator') ?? '').toLowerCase(),
    classes: doc.bodyClasses().map((name) => name.toLowerCase()),
    body: response.body.toLowerCase(),
    headers: response.headers,
    hosts: doc.assetHosts(response.finalUrl),
    doc,
  };
  for (const [platform, fingerprints] of FINGERPRINTS) {
    const hit = fingerprints.find((fingerprint) => fingerprint.test(page));
    if (hit) return { platform, signal: hit.signal };
  }
  return { platform: 'unknown', signal: null };
}
