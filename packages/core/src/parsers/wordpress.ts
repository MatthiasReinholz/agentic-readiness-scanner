/**
 * What a WordPress or WooCommerce page shows about how the site is built: the kind of
 * theme, the theme's name, the page builder, WooCommerce's own settings object, and
 * whether the cart and checkout pages use WooCommerce's blocks or the classic shortcodes.
 * Pure functions over a parsed page; the checks decide what to fetch.
 */
import { HtmlDocument } from './html.js';

export type WordPressThemeKind = 'block' | 'classic';

export interface WordPressTheme {
  /** Block theme or classic theme, or null when the page shows no theme at all. */
  kind: WordPressThemeKind | null;
  /** What decided the kind. */
  kindSignal: string | null;
  /** The theme that renders the site (the parent theme when a child theme is active). */
  theme: string | null;
  /** The active child theme, when there is one. */
  childTheme: string | null;
  /** Where the theme names came from. */
  themeSignal: string | null;
}

/** The theme folder in an asset URL: /wp-content/themes/<slug>/. */
const THEME_PATH = /\/wp-content\/themes\/([\w.-]+)\//;

function themesInAssets(doc: HtmlDocument): string[] {
  const slugs: string[] = [];
  for (const href of [...doc.stylesheets(), ...doc.externalScripts()]) {
    const slug = THEME_PATH.exec(href)?.[1];
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

/**
 * The theme a WordPress page was rendered with. WordPress adds `wp-theme-<template>` to
 * the body, and `wp-child-theme-<stylesheet>` when a child theme is active. Block themes
 * render every page inside `<div class="wp-site-blocks">` (wp-includes/template-canvas.php);
 * classic themes print their own markup. WooCommerce's settings object, when the page has
 * one, states the kind outright (`currentThemeIsFSETheme`) and wins.
 */
export function readWordPressTheme(
  doc: HtmlDocument,
  settings: WooSettings | null = null,
): WordPressTheme {
  const classes = doc.bodyClasses();
  const fromClass = (prefix: string): string | null => {
    const slug = classes.find((name) => name.startsWith(prefix))?.slice(prefix.length);
    return slug === undefined || slug === '' ? null : slug;
  };
  let theme = fromClass('wp-theme-');
  let childTheme = fromClass('wp-child-theme-');
  let themeSignal: string | null = theme ? 'body class' : null;
  if (!theme) {
    const slugs = themesInAssets(doc);
    if (slugs.length > 0) {
      // A child theme's stylesheet usually loads after its parent's; with one folder the
      // site runs that theme alone. Two folders cannot be told apart reliably, so the
      // first is reported as the theme and the second as a possible child.
      theme = slugs[0] ?? null;
      childTheme = slugs[1] ?? null;
      themeSignal = 'theme asset path';
    }
  }

  let kind: WordPressThemeKind | null = null;
  let kindSignal: string | null = null;
  if (settings?.blockTheme !== undefined && settings.blockTheme !== null) {
    kind = settings.blockTheme ? 'block' : 'classic';
    kindSignal = "WooCommerce's settings script (currentThemeIsFSETheme)";
  } else if (doc.hasClass('wp-site-blocks')) {
    kind = 'block';
    kindSignal = 'the wp-site-blocks wrapper';
  } else if (theme) {
    kind = 'classic';
    kindSignal = 'a theme page without the wp-site-blocks wrapper';
  }
  return { kind, kindSignal, theme, childTheme, themeSignal };
}

interface BuilderMarker {
  name: string;
  /** Body classes the builder adds, any one of which recognises it. */
  bodyClasses?: readonly string[];
  /** A body class prefix, for classes that carry an id or version. */
  bodyClassPrefix?: string;
  /** A folder its assets load from. */
  assetPath?: string;
}

/**
 * Page builders: plugins or themes that replace the block editor's markup with their own.
 * Each adds a body class or loads assets from its own folder on every page it renders.
 */
const BUILDERS: readonly BuilderMarker[] = [
  {
    name: 'Elementor',
    bodyClassPrefix: 'elementor-kit-',
    assetPath: '/wp-content/plugins/elementor/',
  },
  {
    name: 'Divi',
    bodyClasses: ['et_divi_theme', 'et_divi_builder'],
    assetPath: '/wp-content/themes/Divi/',
  },
  { name: 'Beaver Builder', bodyClasses: ['fl-builder'] },
  {
    name: 'WPBakery',
    bodyClasses: ['wpb-js-composer'],
    assetPath: '/wp-content/plugins/js_composer/',
  },
  { name: 'Bricks', bodyClasses: ['brx-body', 'bricks-is-frontend'] },
];

/** The page builders the page shows, in a fixed order. */
export function pageBuilders(doc: HtmlDocument): string[] {
  const classes = doc.bodyClasses();
  const assets = [...doc.stylesheets(), ...doc.externalScripts()];
  return BUILDERS.filter(
    (builder) =>
      builder.bodyClasses?.some((name) => classes.includes(name)) === true ||
      (builder.bodyClassPrefix !== undefined &&
        classes.some((name) => name.startsWith(builder.bodyClassPrefix ?? ''))) ||
      (builder.assetPath !== undefined &&
        assets.some((href) => href.includes(builder.assetPath ?? ''))),
  ).map((builder) => builder.name);
}

export interface StorePage {
  id: number | null;
  permalink: string | null;
}

/** The parts of WooCommerce's `wcSettings` object the technology checks read. */
export interface WooSettings {
  /** WooCommerce's own answer to "is the active theme a block theme", when stated. */
  blockTheme: boolean | null;
  cart: StorePage | null;
  checkout: StorePage | null;
}

const SETTINGS_SCRIPT =
  /wcSettings\s*=\s*(?:wcSettings\s*\|\|\s*)?JSON\.parse\(\s*decodeURIComponent\(\s*'([^']*)'\s*\)\s*\)/;

function storePage(value: unknown): StorePage | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'number' && record.id > 0 ? record.id : null;
  const permalink =
    typeof record.permalink === 'string' && record.permalink !== '' ? record.permalink : null;
  return id === null && permalink === null ? null : { id, permalink };
}

/**
 * WooCommerce's settings object, which its blocks print as URL-encoded JSON:
 * `wcSettings = JSON.parse( decodeURIComponent( '…' ) )`. Pages that load a WooCommerce
 * block or its admin scripts carry it. Null when the page has none or it does not parse.
 */
export function readWooSettings(doc: HtmlDocument): WooSettings | null {
  for (const script of doc.inlineScripts()) {
    if (!script.includes('wcSettings')) continue;
    const encoded = SETTINGS_SCRIPT.exec(script)?.[1];
    if (encoded === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(encoded));
      if (typeof parsed !== 'object' || parsed === null) return null;
      const settings = parsed as Record<string, unknown>;
      const pages =
        typeof settings.storePages === 'object' && settings.storePages !== null
          ? (settings.storePages as Record<string, unknown>)
          : {};
      const flag = settings.currentThemeIsFSETheme ?? settings.isBlockTheme;
      return {
        blockTheme: typeof flag === 'boolean' ? flag : null,
        cart: storePage(pages.cart),
        checkout: storePage(pages.checkout),
      };
    } catch {
      return null;
    }
  }
  return null;
}

const CART_URL = /"cart_url"\s*:\s*("(?:[^"\\]|\\.)*")/;

/**
 * The cart page URL WooCommerce prints for its add-to-cart script
 * (`wc_add_to_cart_params.cart_url`), on pages with add-to-cart buttons. Null otherwise.
 */
export function addToCartCartUrl(doc: HtmlDocument): string | null {
  for (const script of doc.inlineScripts()) {
    if (!script.includes('wc_add_to_cart_params')) continue;
    const literal = CART_URL.exec(script)?.[1];
    if (literal === undefined) continue;
    try {
      const url: unknown = JSON.parse(literal);
      if (typeof url === 'string' && url !== '') return url;
    } catch {
      // not a JSON string
    }
  }
  return null;
}

export type WooPageKind = 'block' | 'classic';

export interface WooPageReading {
  kind: WooPageKind | null;
  signal: string | null;
  /** True when the classic page is known to be WooCommerce's own shortcode, not a builder or plugin. */
  shortcode?: boolean;
}

/**
 * The cart page as served with an empty cart. The Cart block renders inside
 * `wp-block-woocommerce-cart`; the `[woocommerce_cart]` shortcode renders the cart form,
 * or with an empty cart its `wc-empty-cart-message` notice. Neither means a page builder
 * or plugin replaced the cart.
 */
export function readCartPage(doc: HtmlDocument): WooPageReading {
  if (doc.hasClass('wp-block-woocommerce-cart'))
    return { kind: 'block', signal: 'wp-block-woocommerce-cart' };
  if (doc.hasClass('woocommerce-cart-form'))
    return { kind: 'classic', signal: 'woocommerce-cart-form', shortcode: true };
  if (doc.hasClass('wc-empty-cart-message'))
    return { kind: 'classic', signal: 'wc-empty-cart-message', shortcode: true };
  return { kind: null, signal: null };
}

const SHORTCODE_WRAPPER_ONLY = /^\s*<div class="woocommerce">\s*<\/div>\s*$/;

const PAGE_BLOCK = {
  cart: 'wp-block-woocommerce-cart',
  checkout: 'wp-block-woocommerce-checkout',
} as const;

/**
 * The cart or checkout page's content as the REST API renders it (`content.rendered`).
 * The Cart and Checkout blocks keep their `wp-block-woocommerce-cart` and
 * `wp-block-woocommerce-checkout` wrappers there. Any other content is not the block: the
 * classic shortcode (which renders next to nothing outside a shopper's session), a page
 * builder or a checkout plugin. An empty content says nothing.
 */
export function readPageContent(rendered: string, page: 'cart' | 'checkout'): WooPageReading {
  const block = PAGE_BLOCK[page];
  if (new HtmlDocument(rendered).hasClass(block)) return { kind: 'block', signal: block };
  if (rendered.trim() === '') return { kind: null, signal: null };
  // Outside a shopper's session the shortcode prints only its wrapper
  // (WC_Shortcodes::shortcode_wrapper), so that alone is the shortcode for certain.
  if (SHORTCODE_WRAPPER_ONLY.test(rendered)) {
    return {
      kind: 'classic',
      signal: `the [woocommerce_${page}] shortcode's empty wrapper`,
      shortcode: true,
    };
  }
  return {
    kind: 'classic',
    signal: `no ${page === 'cart' ? 'Cart' : 'Checkout'} block in the page content`,
  };
}
