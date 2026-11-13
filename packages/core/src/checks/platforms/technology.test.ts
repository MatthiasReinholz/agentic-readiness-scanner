import { describe, expect, it } from 'vitest';

import type { Fetcher } from '../../http/types.js';
import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import {
  bigcommerceStorefrontType,
  magentoStorefrontType,
  salesforceStorefrontType,
  shopifyStorefrontType,
  wordpressThemeType,
} from './technology.js';
import { woocommerceCartAndCheckout } from './woocommerce-pages.js';

const ORIGIN = 'https://shop.example';

/** A fetcher that refuses `url` the way the robots.txt gate does, without requesting it. */
function robotsRefuses(inner: Fetcher, url: string): Fetcher {
  return {
    get requestCount() {
      return inner.requestCount;
    },
    budget: inner.budget,
    fetch: async (target, options) => {
      const response = await inner.fetch(target, options);
      return target === url
        ? {
            ...response,
            status: 0,
            body: '',
            error: 'not fetched: robots.txt disallows this path for AgenticReadinessScanner',
          }
        : response;
    },
  };
}
const JSON_HEADERS = { 'content-type': 'application/json' };
const page = (rendered: string) => ({
  status: 200,
  headers: JSON_HEADERS,
  body: JSON.stringify({ id: 8, content: { rendered } }),
});
const pageList = (rendered: string) => ({
  status: 200,
  headers: JSON_HEADERS,
  body: JSON.stringify([{ id: 8, content: { rendered } }]),
});
const restPages = (query: string) =>
  `${ORIGIN}/wp-json/wp/v2/pages?${query}&_fields=id%2Clink%2Ccontent`;
const restPage = (id: number) =>
  `${ORIGIN}/wp-json/wp/v2/pages/${String(id)}?_fields=id%2Clink%2Ccontent`;

function settingsScript(settings: unknown): string {
  return `<script>var wcSettings = JSON.parse( decodeURIComponent( '${encodeURIComponent(JSON.stringify(settings))}' ) );</script>`;
}

const CART_BLOCK =
  '<div class="wp-block-woocommerce-cart alignwide is-loading"><div class="wp-block-woocommerce-empty-cart-block"></div></div>';
const CHECKOUT_BLOCK =
  '<div class="wp-block-woocommerce-checkout alignwide wc-block-checkout is-loading"></div>';
const ADD_TO_CART = `<script>var wc_add_to_cart_params = {"cart_url":"https:\\/\\/shop.example\\/warenkorb\\/"};</script>`;

describe('A3.15 WordPress theme type', () => {
  it('records a block theme with its name', async () => {
    const outcome = await runCheck(
      wordpressThemeType,
      targetFor({
        platform: 'wordpress',
        homeHtml:
          '<body class="home wp-theme-twentytwentyfive"><div class="wp-site-blocks"></div></body>',
      }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence.facts).toEqual([
      { label: 'Theme', value: 'Block theme (twentytwentyfive)' },
    ]);
  });

  it('records a classic child theme and its page builder', async () => {
    const outcome = await runCheck(
      wordpressThemeType,
      targetFor({
        platform: 'woocommerce',
        homeHtml:
          '<body class="home wp-theme-hello-elementor wp-child-theme-shop-child elementor-kit-12"></body>',
      }),
      mapFetcher({}),
    );
    expect(outcome.evidence.facts).toEqual([
      { label: 'Theme', value: 'Classic theme (shop-child, child of hello-elementor)' },
      { label: 'Page builder', value: 'Elementor' },
    ]);
    expect(outcome.message).toContain('Elementor');
  });

  it('records a headless front end when no theme renders the home page', async () => {
    const outcome = await runCheck(
      wordpressThemeType,
      targetFor({
        platform: 'wordpress',
        homeHtml:
          '<body><div id="__next"><img src="https://cms.shop.example/wp-content/uploads/a.jpg"></div><script id="__NEXT_DATA__" type="application/json">{}</script></body>',
      }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence.facts).toEqual([{ label: 'Front end', value: 'Headless (Next.js)' }]);
  });

  it('records no fact when the page shows neither a theme nor a framework', async () => {
    const outcome = await runCheck(
      wordpressThemeType,
      targetFor({ platform: 'wordpress', homeHtml: '<body><p>Hello</p></body>' }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence.facts).toEqual([]);
    expect(outcome.message).toMatch(/no WordPress theme could be recognised/);
  });
});

describe('B5.12 WooCommerce cart and checkout type', () => {
  it('reads the cart page as served and the checkout by the id its settings name', async () => {
    const settings = settingsScript({
      storePages: {
        cart: { id: 7, permalink: `${ORIGIN}/warenkorb/` },
        checkout: { id: 8, permalink: `${ORIGIN}/kasse/` },
      },
    });
    const outcome = await runCheck(
      woocommerceCartAndCheckout,
      targetFor({ homeHtml: `<body>${ADD_TO_CART}</body>` }),
      mapFetcher({
        [`${ORIGIN}/warenkorb/`]: `<body>${CART_BLOCK}${settings}</body>`,
        [restPage(8)]: page(CHECKOUT_BLOCK),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'the cart uses the Cart block, and the checkout uses the Checkout block',
    );
    expect(outcome.evidence).toMatchObject({
      cart_url: `${ORIGIN}/warenkorb/`,
      cart_url_source: 'add-to-cart-params',
      cart_read_from: 'page',
      checkout_rest_url: restPage(8),
      facts: [
        { label: 'Cart', value: 'Cart block' },
        { label: 'Checkout', value: 'Checkout block' },
      ],
    });
  });

  it('records the classic shortcodes', async () => {
    const outcome = await runCheck(
      woocommerceCartAndCheckout,
      targetFor({ homeHtml: '<body></body>' }),
      mapFetcher({
        [`${ORIGIN}/cart/`]:
          '<body><div class="woocommerce"><div class="woocommerce-notices-wrapper wc-empty-cart-message"><div class="cart-empty woocommerce-info">Your cart is currently empty.</div></div></div></body>',
        [restPages('slug=checkout')]: pageList('<div class="woocommerce"></div>'),
      }),
    );
    expect(outcome.evidence).toMatchObject({
      cart_url_source: 'default',
      cart_signal: 'wc-empty-cart-message',
      facts: [
        { label: 'Cart', value: 'Classic cart (shortcode)' },
        { label: 'Checkout', value: 'Classic checkout (shortcode)' },
      ],
    });
  });

  it('reads the cart through the REST API when robots.txt keeps the scanner off the page', async () => {
    const outcome = await runCheck(
      woocommerceCartAndCheckout,
      targetFor({ homeHtml: `<body>${ADD_TO_CART}</body>` }),
      robotsRefuses(
        mapFetcher({
          [restPages('slug=warenkorb')]: pageList(CART_BLOCK),
          [restPages('slug=checkout')]: pageList(CHECKOUT_BLOCK),
        }),
        `${ORIGIN}/warenkorb/`,
      ),
    );
    expect(outcome.evidence).toMatchObject({ cart_read_from: 'rest-api', cart_status: 0 });
    expect(outcome.evidence.facts).toHaveLength(2);
  });

  it('says robots.txt kept it from reading a page', async () => {
    const outcome = await runCheck(
      woocommerceCartAndCheckout,
      targetFor({ homeHtml: '<body></body>' }),
      robotsRefuses(
        robotsRefuses(robotsRefuses(mapFetcher({}), `${ORIGIN}/cart/`), restPages('slug=cart')),
        restPages('slug=checkout'),
      ),
    );
    expect(outcome.verdict).toBe('skip');
    expect(outcome.message).toContain('robots.txt disallows the cart page for the scanner');
    expect(outcome.message).toContain('robots.txt disallows the REST API for the scanner');
    expect(outcome.message).not.toMatch(/rescan/);
  });

  it('finds the cart in the first product page when the home page names none', async () => {
    const product = `${ORIGIN}/product/mug/`;
    const outcome = await runCheck(
      woocommerceCartAndCheckout,
      targetFor({ homeHtml: '<body></body>', products: [product] }),
      mapFetcher({
        [product]: `<body>${ADD_TO_CART}</body>`,
        [`${ORIGIN}/warenkorb/`]: `<body>${CART_BLOCK}</body>`,
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ cart_url_source: 'add-to-cart-params' });
    expect(outcome.evidence.facts).toEqual([{ label: 'Cart', value: 'Cart block' }]);
    expect(outcome.message).toMatch(
      /the checkout type could not be read \(the REST API answered HTTP 404 for the checkout page\)/,
    );
  });

  it('ignores a cart URL on another site', async () => {
    const outcome = await runCheck(
      woocommerceCartAndCheckout,
      targetFor({
        homeHtml:
          '<body><script>var wc_add_to_cart_params = {"cart_url":"https:\\/\\/other.example\\/cart\\/"};</script></body>',
      }),
      mapFetcher({ [`${ORIGIN}/cart/`]: `<body>${CART_BLOCK}</body>` }),
    );
    expect(outcome.evidence).toMatchObject({
      cart_url: `${ORIGIN}/cart/`,
      cart_url_source: 'default',
    });
  });

  it('is skipped when neither page can be read', async () => {
    const outcome = await runCheck(
      woocommerceCartAndCheckout,
      targetFor({ homeHtml: '<body></body>' }),
      mapFetcher({
        [restPages('slug=cart')]: {
          status: 401,
          headers: JSON_HEADERS,
          body: '{"code":"rest_forbidden"}',
        },
        [restPages('slug=checkout')]: {
          status: 401,
          headers: JSON_HEADERS,
          body: '{"code":"rest_forbidden"}',
        },
      }),
    );
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('error');
    expect(outcome.message).toMatch(/neither the cart nor the checkout type could be read/);
    expect(outcome.message).not.toMatch(/temporary/);
  });

  it('says a rescan may help when an answer was temporary', async () => {
    const outcome = await runCheck(
      woocommerceCartAndCheckout,
      targetFor({ homeHtml: '<body></body>' }),
      mapFetcher({
        [`${ORIGIN}/cart/`]: { status: 503, body: '' },
        [restPages('slug=cart')]: { status: 503, body: '' },
        [restPages('slug=checkout')]: { status: 503, body: '' },
      }),
    );
    expect(outcome.verdict).toBe('skip');
    expect(outcome.message).toMatch(/a rescan may read them/);
  });
});

describe('A3.16 Shopify storefront type', () => {
  const themeScript = (theme: unknown) =>
    `<script>var Shopify = Shopify || {};\nShopify.theme = ${JSON.stringify(theme)};\nShopify.theme.handle = "null";</script>`;

  it('records an Online Store theme with its Theme Store id', async () => {
    const outcome = await runCheck(
      shopifyStorefrontType,
      targetFor({
        platform: 'shopify',
        homeHtml: `<head>${themeScript({ name: 'Dawn', id: 1, schema_name: 'Dawn', schema_version: '15.4.0', theme_store_id: 887, role: 'main' })}</head>`,
      }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence.facts).toEqual([
      { label: 'Storefront', value: 'Online Store theme (Dawn 15.4.0, Theme Store id 887)' },
    ]);
  });

  it('records a theme without a Theme Store id', async () => {
    const outcome = await runCheck(
      shopifyStorefrontType,
      targetFor({
        platform: 'shopify',
        homeHtml: themeScript({
          name: 'Main',
          schema_name: 'allbirds-theme',
          schema_version: '1.2',
          theme_store_id: null,
        }),
      }),
      mapFetcher({}),
    );
    expect(outcome.evidence.facts).toEqual([
      {
        label: 'Storefront',
        value: 'Online Store theme (allbirds-theme 1.2)',
      },
    ]);
  });

  it('records Hydrogen from its powered-by header', async () => {
    const target = targetFor({
      platform: 'shopify',
      homeHtml: '<script>window.__remixContext = {};</script>',
    });
    const outcome = await runCheck(
      shopifyStorefrontType,
      {
        ...target,
        home: { ...target.home, headers: { 'powered-by': 'Shopify, Oxygen, Hydrogen' } },
      },
      mapFetcher({}),
    );
    expect(outcome.evidence.facts).toEqual([
      { label: 'Storefront', value: 'Headless (Hydrogen, hosted on Oxygen)' },
    ]);
  });

  it('records another headless front end on a domain Shopify does not serve', async () => {
    const target = targetFor({ platform: 'shopify', homeHtml: '<div id="__nuxt"></div>' });
    const outcome = await runCheck(
      shopifyStorefrontType,
      { ...target, shopifyHosted: false },
      mapFetcher({}),
    );
    expect(outcome.evidence.facts).toEqual([{ label: 'Storefront', value: 'Headless (Nuxt)' }]);
  });

  it('records nothing it cannot see', async () => {
    const outcome = await runCheck(
      shopifyStorefrontType,
      targetFor({ platform: 'shopify', homeHtml: '<body></body>' }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence.facts).toEqual([]);
  });
});

describe('A3.17 BigCommerce storefront type', () => {
  const run = (homeHtml: string) =>
    runCheck(
      bigcommerceStorefrontType,
      targetFor({ platform: 'bigcommerce', homeHtml }),
      mapFetcher({}),
    );

  it('records a Stencil theme', async () => {
    const outcome = await run(
      '<script>window.stencilBootstrap("home", "{}").load();</script><img src="https://cdn11.bigcommerce.com/s-abc/images/stencil/500x659/products/1/1.jpg">',
    );
    expect(outcome.evidence.facts).toEqual([{ label: 'Storefront', value: 'Stencil theme' }]);
  });

  it('records a Next.js storefront such as Catalyst, not taking the image path for Stencil', async () => {
    const outcome = await run(
      '<script>self.__next_f.push([1,""])</script><img src="https://cdn11.bigcommerce.com/s-abc/images/stencil/256w/products/1/1.jpg">',
    );
    expect(outcome.evidence.facts).toEqual([
      { label: 'Storefront', value: 'Headless (Next.js, such as Catalyst)' },
    ]);
  });

  it('records nothing it cannot see', async () => {
    const outcome = await run('<body></body>');
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence.facts).toEqual([]);
  });
});

describe('A3.18 Adobe Commerce storefront type', () => {
  const run = (homeHtml: string) =>
    runCheck(magentoStorefrontType, targetFor({ platform: 'magento', homeHtml }), mapFetcher({}));

  it('records a Luma-based theme with its path', async () => {
    const outcome = await run(
      '<script src="https://shop.example/static/version1700000000/frontend/Acme/fashion/en_US/requirejs/require.js"></script><script type="text/x-magento-init">{"*":{}}</script>',
    );
    expect(outcome.evidence.facts).toEqual([
      { label: 'Theme', value: 'Luma-based theme (Acme/fashion)' },
    ]);
  });

  it('records Hyvä from its theme path', async () => {
    const outcome = await run(
      '<link rel="stylesheet" href="/static/version1/frontend/Hyva/default/en_US/css/styles.css">',
    );
    expect(outcome.evidence.facts).toEqual([{ label: 'Theme', value: 'Hyvä (Hyva/default)' }]);
  });

  it('records a Hyvä child theme from its window.hyva script', async () => {
    const outcome = await run(
      '<link rel="stylesheet" href="/static/version1/frontend/Acme/shop/en_US/css/styles.css"><script>window.hyva = window.hyva || {}</script>',
    );
    expect(outcome.evidence.facts).toEqual([{ label: 'Theme', value: 'Hyvä (Acme/shop)' }]);
  });

  it('records Breeze from its script types', async () => {
    const outcome = await run(
      '<link rel="stylesheet" href="/static/version1/frontend/Swissup/breeze-blank/en_US/css/styles.css"><script type="breeze/async-js" src="/static/version1/frontend/Swissup/breeze-blank/en_US/Swissup_Breeze/bundles/1/core.min.js"></script>',
    );
    expect(outcome.evidence.facts).toEqual([
      { label: 'Theme', value: 'Breeze (Swissup/breeze-blank)' },
    ]);
  });

  it('records a headless storefront when no theme renders the home page', async () => {
    const outcome = await run('<div id="__nuxt"></div>');
    expect(outcome.evidence.facts).toEqual([{ label: 'Storefront', value: 'Headless (Nuxt)' }]);
  });
});

describe('A3.19 Salesforce storefront type', () => {
  const run = (homeHtml: string) =>
    runCheck(
      salesforceStorefrontType,
      targetFor({ platform: 'salesforce', homeHtml }),
      mapFetcher({}),
    );

  it('records the Composable Storefront', async () => {
    const outcome = await run('<script src="/mobify/bundle/123/main.js"></script>');
    expect(outcome.evidence.facts).toEqual([
      { label: 'Storefront', value: 'Composable Storefront (PWA Kit)' },
    ]);
  });

  it('records a server-rendered storefront', async () => {
    const outcome = await run(
      '<script src="/on/demandware.static/Sites-shop-Site/-/en_US/v1/js/main.js"></script>',
    );
    expect(outcome.evidence.facts).toEqual([
      { label: 'Storefront', value: 'Server-rendered storefront (SFRA or SiteGenesis)' },
    ]);
  });
});
