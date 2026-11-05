import { XMLParser } from 'fast-xml-parser';

export interface SitemapEntry {
  loc: string;
  /** The <lastmod> text as written, unvalidated; see isW3cDatetime. */
  lastmod?: string;
}

export interface ParsedSitemap {
  kind: 'index' | 'urlset' | 'invalid';
  /** True when the XML was cut off (a file larger than the scanner reads) and the complete entries before the cut were salvaged. */
  partial?: boolean;
  /** Child sitemap URLs when kind is index. */
  sitemaps: string[];
  /** Page URLs when kind is urlset: the loc of every entry, for callers that need only URLs. */
  urls: string[];
  /** URL entries with their lastmod when kind is urlset. */
  entries: SitemapEntry[];
  error?: string;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  isArray: (name) => name === 'sitemap' || name === 'url',
});

/** Text content of an element as the XML parser hands it over: a string, or a number it coerced. */
function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

function urlEntries(entries: unknown): SitemapEntry[] {
  if (!Array.isArray(entries)) return [];
  const result: SitemapEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !('loc' in entry)) continue;
    const record = entry as Record<string, unknown>;
    const loc = textOf(record.loc);
    if (loc === null) continue;
    const lastmod = textOf(record.lastmod);
    result.push(lastmod === null ? { loc } : { loc, lastmod });
  }
  return result;
}

function locs(entries: unknown): string[] {
  return urlEntries(entries).map((entry) => entry.loc);
}

/**
 * W3C Datetime as the sitemaps protocol requires: a complete date (YYYY-MM-DD) or a
 * date with time and a timezone designator (Z or +hh:mm). Year-only and year-month
 * forms are not accepted; a sitemap entry needs a day to be useful. Field ranges are
 * checked so 2026-13-01 and 24:00 do not pass.
 */
const W3C_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2})))?$/;

export function isW3cDatetime(value: string): boolean {
  if (value.length > 40) return false;
  const match = W3C_DATETIME.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
  const inRange = (text: string | undefined, min: number, max: number): boolean =>
    text === undefined || (Number(text) >= min && Number(text) <= max);
  return (
    Number(year) >= 1 &&
    inRange(month, 1, 12) &&
    inRange(day, 1, 31) &&
    inRange(hour, 0, 23) &&
    inRange(minute, 0, 59) &&
    inRange(second, 0, 60) &&
    inRange(offsetHour, 0, 23) &&
    inRange(offsetMinute, 0, 59)
  );
}

/**
 * Salvages the complete <url> entries of a urlset whose XML was cut off: large platforms
 * publish sitemaps of 50,000 entries that run past the 2 MB the scanner reads, and the
 * entries before the cut are still what a crawler sees first.
 */
function salvageTruncatedUrlset(xml: string): ParsedSitemap | null {
  if (!/<urlset[\s>]/i.test(xml.slice(0, 2000))) return null;
  const entries: SitemapEntry[] = [];
  // Split on the opening tag and cut each piece at its closing tag with indexOf, so the
  // scan stays linear whatever the file contains; the piece without a closing tag is the
  // cut-off entry and is dropped.
  const lower = xml.toLowerCase();
  let from = lower.indexOf('<url>');
  while (from !== -1) {
    const start = from + '<url>'.length;
    const close = lower.indexOf('</url>', start);
    if (close === -1) break;
    const body = xml.slice(start, close);
    from = lower.indexOf('<url>', close);
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(body)?.[1];
    if (!loc) continue;
    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(body)?.[1];
    entries.push(lastmod === undefined ? { loc } : { loc, lastmod });
  }
  if (entries.length === 0) return null;
  return {
    kind: 'urlset',
    partial: true,
    sitemaps: [],
    urls: entries.map((entry) => entry.loc),
    entries,
  };
}

/** A urlset whose closing tag is missing was cut off, however leniently the parser read it. */
function looksTruncated(xml: string): boolean {
  return /<urlset[\s>]/i.test(xml.slice(0, 2000)) && !/<\/urlset>\s*$/i.test(xml.slice(-400));
}

export function parseSitemap(xml: string): ParsedSitemap {
  if (looksTruncated(xml)) {
    const salvaged = salvageTruncatedUrlset(xml);
    if (salvaged) return salvaged;
  }
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch (error) {
    return (
      salvageTruncatedUrlset(xml) ?? {
        kind: 'invalid',
        sitemaps: [],
        urls: [],
        entries: [],
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
  if (!document || typeof document !== 'object') {
    return { kind: 'invalid', sitemaps: [], urls: [], entries: [], error: 'not an XML document' };
  }
  const root = document as Record<string, unknown>;
  const index = root.sitemapindex;
  if (index && typeof index === 'object') {
    return {
      kind: 'index',
      sitemaps: locs((index as Record<string, unknown>).sitemap),
      urls: [],
      entries: [],
    };
  }
  const urlset = root.urlset;
  if (urlset && typeof urlset === 'object') {
    const entries = urlEntries((urlset as Record<string, unknown>).url);
    return { kind: 'urlset', sitemaps: [], urls: entries.map((entry) => entry.loc), entries };
  }
  return {
    kind: 'invalid',
    sitemaps: [],
    urls: [],
    entries: [],
    error: 'no sitemapindex or urlset root',
  };
}

/**
 * Sitemap file names that hold products: product-sitemap.xml, wp-sitemap-posts-product-1.xml,
 * sitemap_products_1.xml. Tested against the file name only (no query string, no directories)
 * with anchored patterns so matching stays linear in the input length.
 */
const PRODUCT_SITEMAP_NAME_PATTERNS: readonly RegExp[] = [
  /^wp-sitemap-posts-product-\d+\.xml$/i,
  /^(?:products?|prod|produkte?|produits?|productos?|prodotti|artikel|items?|pdp|sku)(?:[-_](?:[a-z]{2}(?:[-_][a-z]{2})?|\d+)(?:[-_.]|$)|\.xml$)/i,
  /^(?:products?|prod|produkte?|produits?|productos?|prodotti|artikel|items?|pdp|sku)[-_]?sitemap/i,
  /^sitemap[-_]?(?:products?|prod|produkte?|produits?|productos?|prodotti|artikel|items?|pdp|sku)/i,
];
const PRODUCT_URL_PATTERN =
  /\/(product|products|produkt|produkte|produit|produits|producto|productos|prodotto|prodotti|artikel|item|items|pd|pdp|dp|sku|goods|p)\/[^/?#]+/i;

function fileNameOf(url: string): string {
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? '';
  return withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1).toLowerCase();
}

export function looksLikeProductSitemap(url: string): boolean {
  const name = fileNameOf(url);
  if (!name.endsWith('.xml')) return false;
  return PRODUCT_SITEMAP_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * The last path segment of a product URL that ends in an identifier rather than a
 * /product/ segment: /mens-hidden-sock/PLID211, /blue-kettle/12345, /lamp/p-48213. A short
 * letter prefix, an optional separator and at least three digits, after a slug segment.
 */
const ID_TAIL_SEGMENT = /^([a-z]{0,6})[-_]?(\d{3,})(?:\.html?)?$/i;
const SLUG_SEGMENT = /^(?=.*[a-z])[a-z0-9]+(?:[-_][a-z0-9]+)+$/i;
/** URLs needed before a shared shape counts, and the share that must have it. */
const ID_TAIL_MIN_URLS = 20;
const ID_TAIL_MIN_SHARE = 0.8;

function idTailKey(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const match = ID_TAIL_SEGMENT.exec(segments[segments.length - 1] ?? '');
  if (!match) return null;
  if (!SLUG_SEGMENT.test(segments[segments.length - 2] ?? '')) return null;
  return (match[1] ?? '').toLowerCase();
}

/**
 * Sitemap URLs that share one product-identifier shape: a slug followed by an identifier
 * with the same letter prefix (takealot.com lists millions of /<slug>/PLID<n> pages). The
 * shape counts only when at least ID_TAIL_MIN_URLS URLs are read and ID_TAIL_MIN_SHARE of
 * them have it, so a blog with a few numbered posts never matches. This is a hint, not
 * proof: the resolver uses it only for a site already known to sell.
 */
export function idTailProductUrls(urls: readonly string[]): string[] {
  if (urls.length < ID_TAIL_MIN_URLS) return [];
  const byKey = new Map<string, string[]>();
  for (const url of urls) {
    const key = idTailKey(url);
    if (key === null) continue;
    const list = byKey.get(key) ?? [];
    list.push(url);
    byKey.set(key, list);
  }
  let best: string[] = [];
  for (const list of byKey.values()) if (list.length > best.length) best = list;
  return best.length >= urls.length * ID_TAIL_MIN_SHARE ? best : [];
}

export function looksLikeProductUrl(url: string): boolean {
  return PRODUCT_URL_PATTERN.test(url);
}
