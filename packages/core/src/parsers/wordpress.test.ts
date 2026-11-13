import { describe, expect, it } from 'vitest';

import { detectFramework } from './frontend.js';
import { HtmlDocument } from './html.js';
import {
  addToCartCartUrl,
  pageBuilders,
  readCartPage,
  readPageContent,
  readWooSettings,
  readWordPressTheme,
} from './wordpress.js';

const doc = (html: string) => new HtmlDocument(html);

/** WooCommerce prints its settings URL-encoded, as wcSettings = JSON.parse(decodeURIComponent('…')). */
function settingsScript(settings: unknown, form = 'var wcSettings = wcSettings || ') {
  return `<script>${form}JSON.parse( decodeURIComponent( '${encodeURIComponent(JSON.stringify(settings))}' ) );</script>`;
}

describe('readWordPressTheme', () => {
  it('reads a block theme from the wp-site-blocks wrapper and the theme body class', () => {
    const theme = readWordPressTheme(
      doc(
        '<body class="home wp-embed-responsive wp-theme-twentytwentyfive"><div class="wp-site-blocks"><header class="wp-block-template-part"></header></div></body>',
      ),
    );
    expect(theme).toEqual({
      kind: 'block',
      kindSignal: 'the wp-site-blocks wrapper',
      theme: 'twentytwentyfive',
      childTheme: null,
      themeSignal: 'body class',
    });
  });

  it('reads a classic child theme and its parent from the body classes', () => {
    const theme = readWordPressTheme(
      doc(
        '<body class="home wp-theme-hello-elementor wp-child-theme-Porter-York-Child elementor-kit-5"><main></main></body>',
      ),
    );
    expect(theme).toMatchObject({
      kind: 'classic',
      theme: 'hello-elementor',
      childTheme: 'Porter-York-Child',
    });
  });

  it('falls back to the theme folder in asset URLs when the body names no theme', () => {
    const theme = readWordPressTheme(
      doc(
        '<head><link rel="stylesheet" href="https://blog.example/wp-content/themes/wpbv7/style.css?ver=1"></head><body class="home page"></body>',
      ),
    );
    expect(theme).toMatchObject({
      kind: 'classic',
      theme: 'wpbv7',
      childTheme: null,
      themeSignal: 'theme asset path',
    });
  });

  it("trusts WooCommerce's own statement over the markup", () => {
    const page = doc('<body class="wp-theme-storefront"><div class="wp-site-blocks"></div></body>');
    expect(
      readWordPressTheme(page, { blockTheme: false, cart: null, checkout: null }),
    ).toMatchObject({
      kind: 'classic',
      kindSignal: "WooCommerce's settings script (currentThemeIsFSETheme)",
    });
  });

  it('names no kind when the page shows no theme at all', () => {
    expect(readWordPressTheme(doc('<body><div id="__next"></div></body>'))).toMatchObject({
      kind: null,
      theme: null,
    });
  });
});

describe('pageBuilders', () => {
  it('recognises builders by body class or asset folder', () => {
    expect(
      pageBuilders(
        doc(
          '<head><script src="/wp-content/plugins/elementor/assets/js/frontend.min.js"></script></head><body class="fl-builder brx-body"></body>',
        ),
      ),
    ).toEqual(['Elementor', 'Beaver Builder', 'Bricks']);
    expect(pageBuilders(doc('<body class="home et_divi_theme"></body>'))).toEqual(['Divi']);
    expect(pageBuilders(doc('<body class="home page"></body>'))).toEqual([]);
  });
});

describe('readWooSettings', () => {
  const settings = {
    currentThemeIsFSETheme: true,
    storePages: {
      cart: { id: 7, title: 'Cart', permalink: 'https://shop.example/cart/' },
      checkout: { id: 8, title: 'Checkout', permalink: 'https://shop.example/kasse/' },
      shop: { id: 0, permalink: false },
    },
  };

  it('decodes both forms WooCommerce prints', () => {
    for (const form of ['var wcSettings = wcSettings || ', 'var wcSettings = ']) {
      expect(readWooSettings(doc(settingsScript(settings, form)))).toEqual({
        blockTheme: true,
        cart: { id: 7, permalink: 'https://shop.example/cart/' },
        checkout: { id: 8, permalink: 'https://shop.example/kasse/' },
      });
    }
  });

  it('returns null for a page without settings or with settings that do not parse', () => {
    expect(readWooSettings(doc('<script>var x = 1;</script>'))).toBeNull();
    expect(
      readWooSettings(
        doc("<script>var wcSettings = JSON.parse( decodeURIComponent( '%7Bbroken' ) );</script>"),
      ),
    ).toBeNull();
  });
});

describe('addToCartCartUrl', () => {
  it('reads and unescapes the cart URL of the add-to-cart script', () => {
    expect(
      addToCartCartUrl(
        doc(
          '<script id="wc-add-to-cart-js-extra">var wc_add_to_cart_params = {"ajax_url":"\\/wp-admin\\/admin-ajax.php","cart_url":"https:\\/\\/shop.example\\/warenkorb\\/","is_cart":""};</script>',
        ),
      ),
    ).toBe('https://shop.example/warenkorb/');
    expect(addToCartCartUrl(doc('<script>var other = {"cart_url":"x"};</script>'))).toBeNull();
  });
});

describe('readCartPage', () => {
  it('tells the Cart block from the classic shortcode', () => {
    expect(
      readCartPage(
        doc(
          '<div class="wp-block-woocommerce-cart alignwide is-loading"><div class="wp-block-woocommerce-empty-cart-block"></div></div>',
        ),
      ),
    ).toEqual({ kind: 'block', signal: 'wp-block-woocommerce-cart' });
    expect(
      readCartPage(doc('<form class="woocommerce-cart-form" action="/cart/"></form>')),
    ).toEqual({ kind: 'classic', signal: 'woocommerce-cart-form', shortcode: true });
    expect(
      readCartPage(
        doc(
          '<div class="wc-empty-cart-message"><div class="cart-empty woocommerce-info">Your cart is currently empty.</div></div>',
        ),
      ),
    ).toEqual({ kind: 'classic', signal: 'wc-empty-cart-message', shortcode: true });
  });

  it('does not take the mini cart for the Cart block', () => {
    expect(
      readCartPage(doc('<div class="wp-block-woocommerce-mini-cart wc-block-mini-cart"></div>')),
    ).toEqual({ kind: null, signal: null });
  });
});

describe('readPageContent', () => {
  it('recognises the Checkout block and treats any other content as not the block', () => {
    expect(
      readPageContent(
        '<div class="wp-block-woocommerce-checkout alignwide wc-block-checkout is-loading"></div>',
        'checkout',
      ),
    ).toEqual({ kind: 'block', signal: 'wp-block-woocommerce-checkout' });
    expect(readPageContent('<div class="woocommerce"></div>', 'checkout')).toMatchObject({
      kind: 'classic',
      shortcode: true,
    });
    expect(
      readPageContent('<div class="elementor"><div class="woocommerce"></div></div>', 'checkout'),
    ).toEqual({ kind: 'classic', signal: 'no Checkout block in the page content' });
    expect(readPageContent('  ', 'checkout')).toEqual({ kind: null, signal: null });
  });

  it('recognises the Cart block in the cart page content', () => {
    expect(
      readPageContent('<div class="wp-block-woocommerce-cart alignwide is-loading"></div>', 'cart'),
    ).toEqual({ kind: 'block', signal: 'wp-block-woocommerce-cart' });
    expect(
      readPageContent('<div class="wp-block-woocommerce-checkout"></div>', 'cart'),
    ).toMatchObject({ kind: 'classic' });
  });
});

describe('detectFramework', () => {
  const frameworkOf = (html: string, headers: Record<string, string> = {}) =>
    detectFramework(doc(html), html, headers)?.framework ?? null;

  it('recognises the common JavaScript front ends', () => {
    expect(frameworkOf('<script id="__NEXT_DATA__" type="application/json">{}</script>')).toBe(
      'Next.js',
    );
    expect(frameworkOf('<script>self.__next_f.push([1,""])</script>')).toBe('Next.js');
    expect(frameworkOf('<div id="__nuxt"></div>')).toBe('Nuxt');
    expect(frameworkOf('<div id="___gatsby"></div>')).toBe('Gatsby');
    expect(frameworkOf('<script>window.__remixContext = {};</script>')).toBe('Remix');
    expect(frameworkOf('<script>window.__reactRouterContext = {};</script>')).toBe('React Router');
    expect(frameworkOf('<astro-island uid="1"></astro-island>')).toBe('Astro');
    expect(frameworkOf('<body data-sveltekit-preload-data="hover"></body>')).toBe('SvelteKit');
    expect(frameworkOf('<app-root ng-version="18.2.0"></app-root>')).toBe('Angular');
    expect(frameworkOf('<p>hi</p>', { 'x-powered-by': 'Next.js' })).toBe('Next.js');
  });

  it('finds nothing on a plain server-rendered page', () => {
    expect(frameworkOf('<body class="home"><main><h1>Shop</h1></main></body>')).toBeNull();
  });
});
