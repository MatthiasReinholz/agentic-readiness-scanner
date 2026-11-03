import {
  getProfile,
  type Platform,
  type PolicyKind,
  type Profile,
  type SampledPages,
} from '@agentic-readiness/catalog';

import { botManagementVendor, isChallengePage, REFUSAL_STATUSES } from '../http/bot-management.js';
import { registrableDomain } from '../http/domain.js';
import { isRobotsAware } from '../http/robots-gate.js';
import { emitProgress, type ProgressListener } from '../progress.js';
import { BudgetExhaustedError, type FetchedResponse, type Fetcher } from '../http/types.js';
import { normalizeInputUrl, assertPublicUrl } from '../http/url-policy.js';
import { HtmlDocument, type Anchor } from '../parsers/html.js';
import { extractJsonLd, hasType } from '../parsers/jsonld.js';
import { looksLikeProductPage } from '../parsers/product-page.js';
import { parseRobotsTxt, type RobotsTxt } from '../parsers/robots.js';
import {
  looksLikeProductSitemap,
  looksLikeProductUrl,
  parseSitemap,
  type SitemapEntry,
} from '../parsers/sitemap.js';
import { matchPlatform } from './platforms.js';
import { sample } from './sampling.js';
import {
  LASTMOD_SAMPLE_LIMIT,
  type HomeBlocked,
  type SitemapSummary,
  type Target,
} from './types.js';

export interface ResolveOptions {
  /** Profile id override; detected otherwise. */
  profile?: string;
  /** Product pages to sample. */
  sampleSize?: number;
  /** Sitemaps to fetch at most while looking for product URLs. */
  maxSitemapFetches?: number;
  /** Receives a phase event after each resolution step. */
  onProgress?: ProgressListener;
}

export class TargetUnreachableError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`${url} is not reachable: ${reason}`);
    this.name = 'TargetUnreachableError';
  }
}

const SITEMAP_CANDIDATES = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'];

/**
 * Policy keywords as whole words (hyphen and slash count as boundaries), with the compound
 * forms the languages use, so "Versandkosten" matches and "Versandlager" (a warehouse) or
 * "resources" (not the Italian "reso") do not.
 */
const POLICY_PATTERNS: Record<PolicyKind, RegExp> = {
  returns:
    /\b(returns?|refunds?|exchanges?|withdrawal|widerruf(?:srecht|sbelehrung|sformular)?|rückgabe(?:recht)?|rücksendung(?:en)?|retouren?|retours?|resi|reso|rimbors[io]|devoluci(?:ó|o)n(?:es)?|reembolsos?)\b/i,
  shipping:
    /\b(shipping|deliver(?:y|ies)|versand(?:kosten|informationen|info|bedingungen|arten|zeiten|optionen|hinweise)?|lieferung(?:en)?|lieferzeit(?:en)?|lieferbedingungen|livraisons?|exp(?:é|e)dition|spedizion[ei]|consegn[ae]|env(?:í|i)os?|entregas?)\b/i,
  privacy:
    /\b(privacy|datenschutz(?:erkl(?:ä|a)rung|hinweise?|richtlinie|bestimmungen)?|confidentialit(?:é|e)|privacidad|riservatezza)\b/i,
  terms:
    /\b(terms|agb|conditions|condizioni|t(?:é|e)rminos|geschäftsbedingungen|nutzungsbedingungen|cgv|t&cs?)\b/i,
  imprint: /\b(imprint|impressum|legal notice|mentions l(?:é|e)gales|aviso legal|note legali)\b/i,
  contact:
    /\b(contacts?|contactez|kontakt|contatt[io]|contacto|support|help|hilfe|aide|ayuda|customer service|kundenservice|kundendienst|service client|servizio clienti|atenci(?:ó|o)n al cliente)\b/i,
};

/** Path segments that name a listing (collection, category or shop index). */
const LISTING_SEGMENT =
  /^(shop|store|collections?|collection|product-category|category|categories|cat|c|kategorie|kategorien|categorie|categoria|categorias|catalog|catalogue)$/i;

/** True when the path has a listing segment: /collections/socks, /shop/, /c/shoes. */
export function isListingPath(pathname: string): boolean {
  return pathname.split('/').some((segment) => LISTING_SEGMENT.test(segment));
}

/** Kept for callers that tested the old pattern; same semantics as isListingPath on a path. */
const LISTING_PATTERN = {
  test: (pathname: string): boolean => isListingPath(pathname),
};

/**
 * Picks the listing page to sample: a URL with a listing segment that is not a product
 * page, preferring one that names a concrete collection or category (two segments:
 * /collections/socks) over a bare index (/shop/), and the most-linked one among those.
 */
export function chooseListing(urls: readonly string[]): string | undefined {
  const counts = new Map<string, { url: string; depth: number; count: number }>();
  for (const href of urls) {
    let pathname: string;
    try {
      pathname = new URL(href).pathname;
    } catch {
      continue;
    }
    if (!isListingPath(pathname) || looksLikeProductUrl(href)) continue;
    const segments = pathname.split('/').filter(Boolean);
    const index = segments.findIndex((segment) => LISTING_SEGMENT.test(segment));
    const depth = segments.length - index;
    const entry = counts.get(href) ?? { url: href, depth, count: 0 };
    entry.count += 1;
    counts.set(href, entry);
  }
  const ranked = [...counts.values()].sort((a, b) => {
    const concrete = Number(b.depth >= 2) - Number(a.depth >= 2);
    if (concrete !== 0) return concrete;
    return b.count - a.count;
  });
  return ranked[0]?.url;
}

/**
 * Signs that a page sells something, in the languages the policy patterns cover: an
 * add-to-cart phrase or a cart path in the HTML, or Product, Offer or ItemList JSON-LD.
 */
const STORE_TEXT_SIGNAL =
  /add[-_ ]?to[-_ ]?(?:cart|bag|basket)|in den (?:warenkorb|einkaufswagen)|ajouter au panier|aggiungi al carrello|a(?:ñ|n)adir al carrito|in winkelwagen|do koszyka|lägg i (?:varukorg|kundvagn)|læg i kurv|legg i handlekurv|lisää ostoskoriin|в корзину|カートに入れる|加入购物车|加入購物車|장바구니/i;
const STORE_PATH_SIGNAL =
  /["'(]\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:carts?|checkouts?|warenkorb|einkaufswagen|kasse|panier|commande|carrello|cassa|carrito|caja|basket|bag|winkelwagen|koszyk|varukorg|kundvagn|kurv|handlekurv|ostoskori)(?:[/?"')]|$)/i;

export function hasStoreSignals(doc: HtmlDocument, body: string): boolean {
  if (STORE_TEXT_SIGNAL.test(body) || STORE_PATH_SIGNAL.test(body)) return true;
  return extractJsonLd(doc).nodes.some((node) =>
    hasType(node, 'Product', 'ProductGroup', 'Offer', 'AggregateOffer', 'ItemList', 'OnlineStore'),
  );
}

/**
 * Paths that belong to a signed-in or transactional area. A link there may carry the word
 * "contact" or "returns" (an account's support form, a returns portal), but it is not the
 * public policy page an agent can read, and it usually answers with a login wall.
 */
export const ACCOUNT_AREA_PATTERN =
  /\/(my-account|account|accounts|customer|login|log-in|signin|sign-in|wp-login\.php|wp-admin|cart|checkout)(\/|$)/i;

export function detectPlatform(doc: HtmlDocument, response: FetchedResponse): Platform {
  return matchPlatform(doc, response).platform;
}

/**
 * Shopify's own edge answers with its shop headers and the rel="ucp" Link header; a
 * headless storefront on another host loads Shopify assets but shows none of them.
 */
export function isShopifyServed(response: FetchedResponse): boolean {
  const headers = response.headers;
  if (headers['x-shopid'] !== undefined || headers['x-shopify-stage'] !== undefined) return true;
  if (/shopify/i.test(headers['powered-by'] ?? '')) return true;
  if (/rel="?ucp"?/i.test(headers.link ?? '')) return true;
  return false;
}

function resolveHttpUrl(href: string, origin: string): URL | null {
  try {
    const url = new URL(href, origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function resolveSameOrigin(href: string, origin: string, base: string = origin): string | null {
  const url = resolveHttpUrl(href, base);
  return url?.origin === origin ? url.href : null;
}

/**
 * Words that belong in a policy link's label besides a kind's own keywords, in the
 * languages the kind patterns cover. A label made of these and the kind's keywords
 * ("Shipping & returns", "Versand und Lieferung") outranks one that carries a name or
 * product ("WooCommerce Shipping", "Delivery Pro subscription").
 */
const POLICY_LABEL_WORDS =
  /^(?:policy|policies|information|info|page|faq|faqs|and|&|or|of|the|our|your|us|me|here|more|read|see|view|help|center|centre|customer|service|support|exchanges?|free|options?|rates?|costs?|times?|days?|legal|notice|notices|statement|general|sales?|shop|online|store|about|de|la|le|les|des|und|et|y|e|i|o|di|del|della|zeiten|kosten|bedingungen|hinweis|hinweise|rechtliche|rechtliches|über|uns|nous|chi|siamo|sobre|nosotros|aviso|mentions|légales)$/i;

function isPolicyWord(token: string): boolean {
  if (POLICY_LABEL_WORDS.test(token)) return true;
  return Object.values(POLICY_PATTERNS).some((pattern) => pattern.test(token));
}

/**
 * Labels that navigate rather than name a page: "Return to shop", "Back to cart",
 * "Zurück zum Shop", "Retour à la boutique". Their verb happens to be a policy keyword in
 * some languages, but the link never leads to the policy.
 */
const NAVIGATION_LABEL =
  /^\s*(?:return|go back|back|zurück|retour(?:ner)?|volver|regresar|tornare|torna|voltar)\s+(?:to|zu|zum|zur|à|au|aux|a|al|alla|ao|para)\b/i;

/** A last path segment that names a policy document outright: /return-policy, /refund-policy. */
const POLICY_DOCUMENT_SEGMENT =
  /(?:^|[-_])(?:polic(?:y|ies)|richtlinien?|politique|pol(?:í|i)tica)(?:$|[-_])/i;

function lastSegment(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  return (segments[segments.length - 1] ?? '').replace(/\.[a-z0-9]{1,5}$/i, '');
}

/**
 * How strongly an anchor looks like the policy link of a kind: 0 when neither its label
 * nor the last path segment names the kind; otherwise a label match counts most and more
 * when every word in the label belongs to a policy label, a footer position counts next,
 * a matching path segment last, twice when the segment names a policy document
 * (/return-policy). "Shipping & returns" in the footer at /shipping-policy scores 8; a
 * product named "WooCommerce Shipping" in the same footer scores 5. A navigation label
 * ("Return to shop") never counts as a label match.
 */
export function policyLinkScore(
  anchor: Anchor,
  pathname: string,
  kind: PolicyKind,
  /** The site's own name (the registrable label of its hostname). */
  brand?: string,
): number {
  const pattern = POLICY_PATTERNS[kind];
  const text = anchor.text;
  const labelMatches = pattern.test(text) && !NAVIGATION_LABEL.test(text);
  const segment = lastSegment(pathname);
  // A path segment that carries the site's own brand next to a policy word is a product of
  // that brand (/woocommerce-shipping/), never the policy: it does not count as a path
  // match, and a label that repeats the brand ("WooCommerce Shipping") does not rescue it.
  // A label that merely mentions the brand ("Standard delivery ... for IKEA Family
  // members" at /services/delivery/) stays a candidate.
  const brandInPath =
    brand !== undefined &&
    segment
      .toLowerCase()
      .split(/[-_.]+/)
      .includes(brand);
  const pathMatches = pattern.test(segment) && !brandInPath;
  if (!labelMatches && !pathMatches) return 0;
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}&]+/u)
    .filter(Boolean);
  if (brandInPath && brand !== undefined && tokens.includes(brand) && tokens.length > 1) {
    return 0;
  }
  let score = 0;
  if (labelMatches) {
    const known = tokens.filter(isPolicyWord).length;
    score += 2 + 2 * (tokens.length > 0 ? known / tokens.length : 0);
  }
  if (anchor.inFooter) score += 2;
  if (pathMatches) score += POLICY_DOCUMENT_SEGMENT.test(segment) ? 2 : 1;
  return score;
}

/**
 * Policy pages by link label or path, the best-scoring candidate per kind. Same-origin
 * links win; a cross-origin link (a privacy policy hosted by the parent company, say) is
 * kept as a fallback because an agent would follow it too. Product pages, listings and
 * account areas are never policy pages, whatever their label says.
 */
export type RankedPolicyLinks = Partial<Record<PolicyKind, { url: string; score: number }>>;

export function findPolicyLinks(
  doc: HtmlDocument,
  origin: string,
  base: string = origin,
): Partial<Record<PolicyKind, string>> {
  const ranked = rankPolicyLinks(doc, origin, base);
  const result: Partial<Record<PolicyKind, string>> = {};
  for (const kind of Object.keys(POLICY_PATTERNS) as PolicyKind[]) {
    const best = ranked[kind];
    if (best) result[kind] = best.url;
  }
  return result;
}

/**
 * Score 4 and above means the link's label names the policy, or a footer link's path names
 * the policy document (/refund-policy); below it only a path or a stray word matched.
 */
export const LABELLED_POLICY_SCORE = 4;

export function rankPolicyLinks(
  doc: HtmlDocument,
  origin: string,
  base: string = origin,
): RankedPolicyLinks {
  type Best = RankedPolicyLinks;
  const sameOrigin: Best = {};
  const crossOrigin: Best = {};
  const brand = registrableDomain(new URL(origin).hostname).split('.')[0];
  for (const anchor of doc.anchors()) {
    const url = resolveHttpUrl(anchor.href, base);
    if (!url || url.href === `${origin}/`) continue;
    if (ACCOUNT_AREA_PATTERN.test(url.pathname)) continue;
    if (looksLikeProductUrl(url.href) || LISTING_PATTERN.test(url.pathname)) continue;
    const bucket = url.origin === origin ? sameOrigin : crossOrigin;
    for (const kind of Object.keys(POLICY_PATTERNS) as PolicyKind[]) {
      const score = policyLinkScore(anchor, url.pathname, kind, brand);
      if (score === 0) continue;
      const current = bucket[kind];
      if (!current || score > current.score) bucket[kind] = { url: url.href, score };
    }
  }
  const result: Best = {};
  for (const kind of Object.keys(POLICY_PATTERNS) as PolicyKind[]) {
    const own = sameOrigin[kind];
    const other = crossOrigin[kind];
    // A labelled link elsewhere (a help centre on support.shop.example) beats a same-origin
    // link that only matched by path or by a stray word.
    const best =
      own && (own.score >= LABELLED_POLICY_SCORE || !other || other.score < LABELLED_POLICY_SCORE)
        ? own
        : (other ?? own);
    if (best) result[kind] = best;
  }
  return result;
}

/**
 * Shopify serves its policy pages at fixed paths whether or not the theme links them from
 * the server-rendered footer (many themes build the footer in the browser). When a kind
 * was not found by link, the conventional page is fetched and used if it exists.
 */
const SHOPIFY_POLICY_PATHS: Partial<Record<PolicyKind, string>> = {
  returns: '/policies/refund-policy',
  shipping: '/policies/shipping-policy',
  privacy: '/policies/privacy-policy',
  terms: '/policies/terms-of-service',
};

export async function addShopifyPolicyPages(
  policies: Partial<Record<PolicyKind, string>>,
  origin: string,
  fetcher: Fetcher,
  /** Kinds whose current pick was matched by path only; the platform's own page is more likely right. */
  weak: ReadonlySet<PolicyKind> = new Set(),
): Promise<void> {
  for (const [kind, path] of Object.entries(SHOPIFY_POLICY_PATHS) as [PolicyKind, string][]) {
    if (policies[kind] && !weak.has(kind)) continue;
    const response = await fetcher.fetch(origin + path);
    if (response.status === 200 && !/<title>[^<]*password/i.test(response.body.slice(0, 2000))) {
      policies[kind] = origin + path;
    }
  }
}

/**
 * The market a URL names in its leading path segments: /us/en/, /de/, /en-us/, /fr_ca/.
 * A multi-market site (ikea.com) publishes one product sitemap per market and lists them
 * in no useful order; the scan samples the market the owner typed, not the first one.
 */
export interface MarketScope {
  /** Leading path, with slashes: "/us/en/". */
  prefix: string;
  /** Lower-case tokens to look for in sitemap file names: ["us", "en"]. */
  tokens: string[];
}

const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2})?$/i;

export function marketScope(url: URL): MarketScope | null {
  const segments = url.pathname.split('/').filter(Boolean);
  const locale: string[] = [];
  for (const segment of segments.slice(0, 2)) {
    if (!LOCALE_SEGMENT.test(segment)) break;
    locale.push(segment);
  }
  if (locale.length === 0) return null;
  const tokens = [...new Set(locale.flatMap((part) => part.toLowerCase().split(/[-_]/)))];
  return { prefix: `/${locale.join('/')}/`, tokens };
}

/** How many of the market's tokens a sitemap file name carries ("prod-en-US_1.xml" → 2 for us/en). */
function marketMatch(sitemapUrl: string, scope: MarketScope | null): number {
  if (!scope) return 0;
  const name = sitemapUrl.split(/[?#]/, 1)[0]?.split('/').pop()?.toLowerCase() ?? '';
  const parts = new Set(name.replace(/\.xml(?:\.gz)?$/, '').split(/[-_.]/));
  return scope.tokens.filter((token) => parts.has(token)).length;
}

/** The URLs of a list that sit under the market's path, or the whole list when none does. */
export function preferMarket(urls: readonly string[], scope: MarketScope | null): string[] {
  if (!scope) return [...urls];
  const inMarket = urls.filter((url) => {
    try {
      return new URL(url).pathname.toLowerCase().startsWith(scope.prefix.toLowerCase());
    } catch {
      return false;
    }
  });
  return inMarket.length > 0 ? inMarket : [...urls];
}

async function discoverSitemap(
  origin: string,
  robots: RobotsTxt | null,
  fetcher: Fetcher,
  maxFetches: number,
  warnings: string[],
  scope: MarketScope | null = null,
): Promise<SitemapSummary | null> {
  const candidates = [
    ...new Set([...(robots?.sitemaps ?? []), ...SITEMAP_CANDIDATES.map((path) => origin + path)]),
  ];
  let fetches = 0;
  for (const candidate of candidates) {
    if (fetches >= maxFetches) break;
    const url = resolveSameOrigin(candidate, origin);
    if (!url) continue;
    fetches += 1;
    const response = await fetcher.fetch(url);
    if (response.status !== 200) continue;
    const parsed = parseSitemap(response.body);
    if (parsed.kind === 'invalid') {
      warnings.push(`sitemap at ${url} did not parse: ${parsed.error ?? 'unknown error'}`);
      continue;
    }
    // The sitemap protocol requires absolute URLs; anything else is noise, and anything
    // on another origin is not this store.
    const sameOrigin = (entries: SitemapEntry[]): SitemapEntry[] => {
      const kept: SitemapEntry[] = [];
      for (const entry of entries) {
        const loc = entry.loc.trim();
        if (!/^https?:\/\//i.test(loc)) continue;
        const resolved = resolveSameOrigin(loc, origin);
        if (resolved === null) continue;
        kept.push(
          entry.lastmod === undefined
            ? { loc: resolved }
            : { loc: resolved, lastmod: entry.lastmod },
        );
      }
      return kept;
    };
    // lastmod of the entries in the order they were read, bounded, so the freshness
    // check judges the same sample on every scan.
    const lastmods: string[] = [];
    let entriesSeen = 0;
    const recordLastmods = (entries: SitemapEntry[]): void => {
      for (const entry of entries) {
        if (entriesSeen >= LASTMOD_SAMPLE_LIMIT) return;
        entriesSeen += 1;
        if (entry.lastmod !== undefined) lastmods.push(entry.lastmod);
      }
    };
    const entries = sameOrigin(parsed.entries);
    recordLastmods(entries);
    const urls = entries.map((entry) => entry.loc);
    const summary: SitemapSummary = {
      url,
      kind: parsed.kind,
      childSitemaps: parsed.sitemaps,
      fetchedSitemaps: [],
      urls,
      productUrls: urls.filter(looksLikeProductUrl),
      lastmods,
    };
    if (parsed.kind === 'index') {
      const productFirst = [...parsed.sitemaps].sort(
        (a, b) =>
          Number(looksLikeProductSitemap(b)) - Number(looksLikeProductSitemap(a)) ||
          marketMatch(b, scope) - marketMatch(a, scope),
      );
      for (const child of productFirst) {
        if (fetches >= maxFetches) break;
        const childUrl = resolveSameOrigin(child, origin);
        if (!childUrl) continue;
        fetches += 1;
        const childResponse = await fetcher.fetch(childUrl);
        if (childResponse.status !== 200) {
          warnings.push(`child sitemap ${childUrl} answered HTTP ${childResponse.status}`);
          continue;
        }
        const childParsed = parseSitemap(childResponse.body);
        if (childParsed.partial) {
          warnings.push(
            `child sitemap ${childUrl} is larger than the 2 MB the scanner reads; its first ${childParsed.entries.length} entries were used`,
          );
        }
        if (childParsed.kind !== 'urlset') {
          // Silent drops hid gzip files and 2 MB cut-offs from every report.
          const why =
            childParsed.kind === 'invalid'
              ? childResponse.truncated
                ? 'larger than the 2 MB the scanner reads, so the XML was cut off'
                : (childParsed.error ?? 'not valid sitemap XML')
              : 'a nested sitemap index';
          warnings.push(`child sitemap ${childUrl} could not be read: ${why}`);
          continue;
        }
        summary.fetchedSitemaps.push(childUrl);
        const childEntries = sameOrigin(childParsed.entries);
        recordLastmods(childEntries);
        const childUrls = childEntries.map((entry) => entry.loc);
        summary.urls.push(...childUrls);
        if (looksLikeProductSitemap(childUrl)) {
          // Shopify lists the store root first in its product sitemap; the root is not a product.
          summary.productUrls.push(
            ...childUrls.filter((childUrl) => new URL(childUrl).pathname !== '/'),
          );
        } else {
          summary.productUrls.push(...childUrls.filter(looksLikeProductUrl));
        }
        if (summary.productUrls.length > 0) break;
      }
    }
    return summary;
  }
  return null;
}

/** Paths that are never product pages, whatever the slug: content, help, legal, listings, assets. */
const NON_PRODUCT_PATH =
  /\/(blog|news|magazin|magazine|journal|stories|help|helpdesk|support|faq|faqs|info|compinfo|about|about-us|contact|kontakt|impressum|imprint|legal|privacy|terms|agb|cart|checkout|account|login|search|tag|tags|author|page|pages|policies|collections?|cat|category|categories|kategorie|kategorien|wp-content|wp-json|feed|sitemap|sitemaps|static|assets|media|images?|js|css)(\/|$|\.)/i;
/** Linked pages fetched at most while looking for product pages without a URL pattern. */
const PRODUCT_PROBE_LIMIT = 4;

/**
 * Finds product pages by content when no URL matched a product pattern: a deterministic
 * sample of linked pages (home-page links first, then sitemap entries) is fetched and a
 * page is kept when it carries Product JSON-LD or an add-to-cart control. Bounded by
 * PRODUCT_PROBE_LIMIT requests; the fetcher caches the pages for the checks.
 */
/**
 * Runs an optional resolution step. When the fetcher stops (request or time budget used
 * up, or the store kept answering 429), the step's result is the fallback and a warning
 * says why: the scan still produces a report, and the runner marks every check that
 * needs a request as not run with the same reason.
 */
async function optionalStep<T>(
  step: () => Promise<T>,
  fallback: T,
  what: string,
  warnings: string[],
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    warnings.push(`${what} was cut short: ${error.message}`);
    return fallback;
  }
}

export async function discoverProductsBySampling(
  candidates: readonly string[],
  hostname: string,
  fetcher: Fetcher,
  sampleSize: number,
  warnings: string[],
): Promise<string[]> {
  const pool: string[] = [];
  const seen = new Set<string>();
  for (const href of candidates) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    const path = url.pathname;
    if (path === '/' || seen.has(url.href)) continue;
    if (NON_PRODUCT_PATH.test(path) || ACCOUNT_AREA_PATTERN.test(path) || isListingPath(path))
      continue;
    const deep = path.split('/').filter(Boolean).length >= 2 || /\.html?$/i.test(path);
    if (!deep) continue;
    seen.add(url.href);
    pool.push(url.href);
  }
  const tried = sample(pool, hostname, PRODUCT_PROBE_LIMIT);
  const found: string[] = [];
  for (const url of tried) {
    const response = await fetcher.fetch(url);
    if (response.status === 200 && looksLikeProductPage(new HtmlDocument(response.body))) {
      found.push(url);
      if (found.length >= sampleSize) break;
    }
  }
  if (tried.length > 0) {
    warnings.push(
      found.length > 0
        ? `no URL matched a product URL pattern; ${found.length} product page(s) were found by fetching ${tried.length} linked page(s)`
        : `no URL matched a product URL pattern and none of ${tried.length} sampled linked page(s) is a product page`,
    );
  }
  return found;
}

/** Platforms that only run shops; a site builder or WordPress may host a content site. */
const STORE_PLATFORMS: ReadonlySet<Platform> = new Set([
  'shopify',
  'bigcommerce',
  'magento',
  'shopware',
  'prestashop',
  'salesforce',
  'square',
  'ecwid',
]);

export function selectProfile(
  platform: Platform,
  storeSignals: boolean,
  override?: string,
): Profile {
  if (override) {
    const profile = getProfile(override);
    if (!profile) throw new Error(`Unknown profile: ${override}`);
    return profile;
  }
  const id =
    platform === 'woocommerce'
      ? 'woocommerce-store'
      : STORE_PLATFORMS.has(platform) || storeSignals
        ? 'other-store'
        : 'content-site';
  const profile = getProfile(id);
  if (!profile) throw new Error(`Catalog is missing profile ${id}`);
  return profile;
}

/**
 * Resolves user input into a Target: canonical origin, platform, profile, robots.txt,
 * sitemap, and a deterministic sample of product and policy pages.
 */
export async function resolveTarget(
  inputUrl: string,
  fetcher: Fetcher,
  options: ResolveOptions = {},
): Promise<Target> {
  const sampleSize = options.sampleSize ?? 2;
  const warnings: string[] = [];
  const input = normalizeInputUrl(inputUrl);
  assertPublicUrl(input);

  const home = await fetcher.fetch(input.href);
  if (home.status === 0) {
    throw new TargetUnreachableError(input.href, home.error ?? 'no response');
  }
  // A refusal (403, 429, a challenge page) is a finding, not an error: the site is up and
  // turns unverified clients away, which is what A2.4 reports. Anything else above 400
  // (404, 410, 5xx) means there is no site to scan at this address.
  const blocked: HomeBlocked | undefined = REFUSAL_STATUSES.has(home.status)
    ? {
        status: home.status,
        vendor: botManagementVendor(home),
        challenge: isChallengePage(home),
      }
    : undefined;
  if (home.status >= 400 && !blocked) {
    throw new TargetUnreachableError(input.href, `HTTP ${home.status}`);
  }
  const origin = new URL(home.finalUrl).origin;
  const hostname = new URL(origin).hostname;
  const homeDoc = new HtmlDocument(blocked ? '' : home.body);
  const match = blocked ? null : matchPlatform(homeDoc, home);
  const platform = match?.platform ?? 'unknown';
  const shopifyHosted = platform === 'shopify' ? isShopifyServed(home) : undefined;
  if (shopifyHosted === false) {
    warnings.push(
      'Shopify assets are loaded but Shopify does not serve this origin (a headless storefront); the Shopify-only checks do not apply here',
    );
  }
  if (blocked) {
    warnings.push(
      `the home page refused the scanner's honest request (HTTP ${blocked.status}${blocked.vendor ? `, ${blocked.vendor}` : ''}); platform, profile and product pages could not be determined and most checks were not evaluated`,
    );
  }

  emitProgress(options.onProgress, {
    type: 'phase',
    phase: 'home',
    detail: blocked
      ? `GET ${home.finalUrl} answered HTTP ${home.status}${blocked.vendor ? ` from ${blocked.vendor}` : ''}`
      : `GET ${home.finalUrl} answered HTTP ${home.status}${platform === 'unknown' ? '' : `; ${platform} detected`}`,
  });
  const robotsResponse = await fetcher.fetch(`${origin}/robots.txt`);
  const robotsLooksLikeText =
    robotsResponse.status === 200 && !/<html|<!doctype/i.test(robotsResponse.body.slice(0, 500));
  const robots = robotsLooksLikeText ? parseRobotsTxt(robotsResponse.body) : null;
  if (isRobotsAware(fetcher)) fetcher.setRobots(robots);

  emitProgress(options.onProgress, {
    type: 'phase',
    phase: 'robots',
    detail: robots
      ? `robots.txt parsed: ${robots.groups.length} group(s), ${robots.sitemaps.length} sitemap line(s)`
      : `robots.txt answered HTTP ${robotsResponse.status}`,
  });
  const scope = marketScope(new URL(home.finalUrl));
  const sitemap = await optionalStep(
    () => discoverSitemap(origin, robots, fetcher, options.maxSitemapFetches ?? 4, warnings, scope),
    null,
    'sitemap discovery',
    warnings,
  );

  emitProgress(options.onProgress, {
    type: 'phase',
    phase: 'sitemap',
    detail: sitemap
      ? `sitemap ${sitemap.url} read: ${sitemap.urls.length} URL(s), ${sitemap.productUrls.length} product URL(s)`
      : 'no sitemap found',
  });
  const anchorUrls = homeDoc
    .anchors()
    .map((anchor) => resolveSameOrigin(anchor.href, origin, home.finalUrl))
    .filter((url): url is string => url !== null);
  // Product URLs of the market the owner typed come first; a sitemap for another market
  // is used only when the typed market has none.
  const marketSitemapProducts = preferMarket(sitemap?.productUrls ?? [], scope);
  const marketAnchorProducts = preferMarket(anchorUrls.filter(looksLikeProductUrl), scope);
  const sitemapInMarket =
    scope === null ||
    marketSitemapProducts.some((url) =>
      new URL(url).pathname.toLowerCase().startsWith(scope.prefix.toLowerCase()),
    );
  const productCandidates =
    marketSitemapProducts.length > 0 && (sitemapInMarket || marketAnchorProducts.length === 0)
      ? marketSitemapProducts
      : marketAnchorProducts;
  let products = sample(productCandidates, hostname, sampleSize);
  if (
    scope &&
    products.length > 0 &&
    !products.every((url) =>
      new URL(url).pathname.toLowerCase().startsWith(scope.prefix.toLowerCase()),
    )
  ) {
    warnings.push(
      `no product URLs under ${scope.prefix} were found; the sample comes from another market of this site`,
    );
  }
  const listing = chooseListing(anchorUrls);
  if (
    products.length === 0 &&
    !blocked &&
    (listing !== undefined || hasStoreSignals(homeDoc, home.body))
  ) {
    // A store whose product URLs follow no known pattern (thomann.de: /de/<slug>.htm) is
    // still a store; a few linked pages are fetched and kept when they are product pages.
    products = await optionalStep(
      () =>
        discoverProductsBySampling(
          preferMarket([...anchorUrls, ...(sitemap?.urls ?? [])], scope),
          hostname,
          fetcher,
          sampleSize,
          warnings,
        ),
      [],
      'product discovery',
      warnings,
    );
  }
  if (products.length === 0) {
    warnings.push(
      'no product URLs found in sitemap or homepage links; product checks will not apply',
    );
  }
  const ranked = rankPolicyLinks(homeDoc, origin, home.finalUrl);
  const policies = findPolicyLinks(homeDoc, origin, home.finalUrl);
  if (platform === 'shopify') {
    const weak = new Set(
      (Object.keys(ranked) as PolicyKind[]).filter(
        (kind) => (ranked[kind]?.score ?? 0) < LABELLED_POLICY_SCORE,
      ),
    );
    await optionalStep(
      () => addShopifyPolicyPages(policies, origin, fetcher, weak),
      undefined,
      'policy page discovery',
      warnings,
    );
  }

  // A refused home page says nothing about what the site sells; without an override the
  // scan assumes a store so the commerce dimension is reported as not evaluated rather
  // than as not applicable.
  const storeSignals =
    blocked !== undefined ||
    products.length > 0 ||
    listing !== undefined ||
    hasStoreSignals(homeDoc, home.body);
  const profile = selectProfile(platform, storeSignals, options.profile);
  emitProgress(options.onProgress, {
    type: 'phase',
    phase: 'sample',
    detail: `${products.length} product page(s)${listing ? ', a listing page' : ''} and ${Object.keys(policies).length} policy page(s) sampled; profile ${profile.id}`,
  });

  const sampled: SampledPages = {
    home: home.finalUrl,
    ...(listing ? { listing } : {}),
    products,
    policies,
  };

  return {
    inputUrl,
    origin,
    hostname,
    platform,
    ...(match?.signal ? { platformSignal: match.signal } : {}),
    profile,
    home,
    homeDoc,
    robotsResponse,
    robots,
    sitemap,
    sampled,
    warnings,
    ...(blocked ? { blocked } : {}),
    ...(shopifyHosted === undefined ? {} : { shopifyHosted }),
  };
}
