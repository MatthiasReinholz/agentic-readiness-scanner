import { XMLParser } from 'fast-xml-parser';

export interface ParsedSitemap {
  kind: 'index' | 'urlset' | 'invalid';
  /** Child sitemap URLs when kind is index. */
  sitemaps: string[];
  /** Page URLs when kind is urlset. */
  urls: string[];
  error?: string;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  isArray: (name) => name === 'sitemap' || name === 'url',
});

function locs(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  const result: string[] = [];
  for (const entry of entries) {
    if (entry && typeof entry === 'object' && 'loc' in entry) {
      const loc = (entry as { loc: unknown }).loc;
      if (typeof loc === 'string' && loc.trim()) result.push(loc.trim());
      else if (typeof loc === 'number') result.push(String(loc));
    }
  }
  return result;
}

export function parseSitemap(xml: string): ParsedSitemap {
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch (error) {
    return {
      kind: 'invalid',
      sitemaps: [],
      urls: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!document || typeof document !== 'object') {
    return { kind: 'invalid', sitemaps: [], urls: [], error: 'not an XML document' };
  }
  const root = document as Record<string, unknown>;
  const index = root.sitemapindex;
  if (index && typeof index === 'object') {
    return {
      kind: 'index',
      sitemaps: locs((index as Record<string, unknown>).sitemap),
      urls: [],
    };
  }
  const urlset = root.urlset;
  if (urlset && typeof urlset === 'object') {
    return { kind: 'urlset', sitemaps: [], urls: locs((urlset as Record<string, unknown>).url) };
  }
  return { kind: 'invalid', sitemaps: [], urls: [], error: 'no sitemapindex or urlset root' };
}

/**
 * Sitemap file names that hold products: product-sitemap.xml, wp-sitemap-posts-product-1.xml,
 * sitemap_products_1.xml. Tested against the file name only (no query string, no directories)
 * with anchored patterns so matching stays linear in the input length.
 */
const PRODUCT_SITEMAP_NAME_PATTERNS: readonly RegExp[] = [
  /^wp-sitemap-posts-product-\d+\.xml$/i,
  /^(?:products?|produkte?|produits?|productos?)[-_]?sitemap/i,
  /^sitemap[-_]?(?:products?|produkte?|produits?|productos?)/i,
];
const PRODUCT_URL_PATTERN =
  /\/(product|products|produkt|produkte|produit|producto|item|p)\/[^/?#]+/i;

function fileNameOf(url: string): string {
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? '';
  return withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1).toLowerCase();
}

export function looksLikeProductSitemap(url: string): boolean {
  const name = fileNameOf(url);
  if (!name.endsWith('.xml')) return false;
  return PRODUCT_SITEMAP_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

export function looksLikeProductUrl(url: string): boolean {
  return PRODUCT_URL_PATTERN.test(url);
}
