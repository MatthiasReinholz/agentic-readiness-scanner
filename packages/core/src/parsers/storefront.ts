/**
 * What a store's home page shows about the storefront its platform serves: the Online
 * Store theme of a Shopify store, the front-end theme of an Adobe Commerce store, and the
 * like. Pure functions over a parsed page; the technology checks combine them with the
 * front-end framework (frontend.ts) to tell a platform theme from a headless storefront.
 */
import type { HtmlDocument } from './html.js';

/** The `Shopify.theme` object every Online Store theme prints through content_for_header. */
export interface ShopifyTheme {
  name: string | null;
  /** The theme's own name and version from its settings schema, e.g. Dawn 15.0.0. */
  schemaName: string | null;
  schemaVersion: string | null;
  /** The Theme Store id; null for a theme that did not come from the Theme Store. */
  themeStoreId: number | null;
}

const SHOPIFY_THEME = /Shopify\.theme\s*=\s*(\{[^;]*?\})\s*;/;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

export function readShopifyTheme(doc: HtmlDocument): ShopifyTheme | null {
  for (const script of doc.inlineScripts()) {
    if (!script.includes('Shopify.theme')) continue;
    const literal = SHOPIFY_THEME.exec(script)?.[1];
    if (literal === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(literal);
      if (typeof parsed !== 'object' || parsed === null) continue;
      const theme = parsed as Record<string, unknown>;
      return {
        name: text(theme.name),
        schemaName: text(theme.schema_name),
        schemaVersion: text(theme.schema_version),
        themeStoreId:
          typeof theme.theme_store_id === 'number' && theme.theme_store_id > 0
            ? theme.theme_store_id
            : null,
      };
    } catch {
      // not the JSON object Shopify prints
    }
  }
  return null;
}

/** BigCommerce's Stencil themes boot through `window.stencilBootstrap(...)`. */
export function hasStencilBootstrap(body: string): boolean {
  return body.includes('stencilBootstrap');
}

/**
 * Salesforce B2C Commerce's own storefronts (SFRA and SiteGenesis) load their assets from
 * /on/demandware.static/; the Composable Storefront built with PWA Kit loads its bundle
 * from /mobify/bundle/ on Managed Runtime.
 */
export function salesforceStorefront(body: string): 'pwa-kit' | 'server' | null {
  if (body.includes('/mobify/bundle/')) return 'pwa-kit';
  if (body.includes('/on/demandware.static/')) return 'server';
  return null;
}

/** The Adobe Commerce (Magento) theme in a static asset URL: /static/[version…/]frontend/<Vendor>/<theme>/. */
const MAGENTO_THEME = /\/static\/(?:version\d+\/)?frontend\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\//;

export interface MagentoFrontend {
  /** Vendor/theme from the static asset path, e.g. Magento/luma or Hyva/default. */
  theme: string | null;
  /** True when the page loads RequireJS and x-magento-init scripts, as Luma-based themes do. */
  requireJs: boolean;
  /** True when the theme path or the page's own script names Hyvä. */
  hyva: boolean;
}

export function readMagentoFrontend(doc: HtmlDocument, body: string): MagentoFrontend {
  const match = MAGENTO_THEME.exec(body);
  const theme = match ? `${match[1] ?? ''}/${match[2] ?? ''}` : null;
  const requireJs =
    doc.scriptsOfType('text/x-magento-init').length > 0 ||
    doc.externalScripts().some((src) => /\/requirejs\/require(?:\.min)?\.js/.test(src));
  const hyva = /^hyva\//i.test(theme ?? '') || /\bwindow\.hyva\b/.test(body);
  return { theme, requireJs, hyva };
}
