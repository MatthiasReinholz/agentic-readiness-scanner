import {
  getProfile,
  type Platform,
  type PolicyKind,
  type Profile,
  type SampledPages,
} from '@agentic-readiness/catalog';

import { isRobotsAware } from '../http/robots-gate.js';
import type { FetchedResponse, Fetcher } from '../http/types.js';
import { normalizeInputUrl, assertPublicUrl } from '../http/url-policy.js';
import { HtmlDocument, type Anchor } from '../parsers/html.js';
import { parseRobotsTxt, type RobotsTxt } from '../parsers/robots.js';
import {
  looksLikeProductSitemap,
  looksLikeProductUrl,
  parseSitemap,
  type SitemapEntry,
} from '../parsers/sitemap.js';
import { sample } from './sampling.js';
import { LASTMOD_SAMPLE_LIMIT, type SitemapSummary, type Target } from './types.js';

export interface ResolveOptions {
  /** Profile id override; detected otherwise. */
  profile?: string;
  /** Product pages to sample. */
  sampleSize?: number;
  /** Sitemaps to fetch at most while looking for product URLs. */
  maxSitemapFetches?: number;
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

const POLICY_PATTERNS: Record<PolicyKind, RegExp> = {
  returns: /\b(returns?|refunds?|widerruf|rückgabe|retour|reso|devoluci)/i,
  shipping: /\b(shipping|delivery|versand|lieferung|livraison|spedizion|envío)/i,
  privacy: /\b(privacy|datenschutz|confidentialit|privacidad)/i,
  terms: /\b(terms|agb|conditions|condizioni|términos|geschäftsbedingungen)/i,
  imprint: /\b(imprint|impressum|legal notice|mentions légales|aviso legal)/i,
  contact: /\b(contact|kontakt|contatt|contacto)/i,
};

const LISTING_PATTERN =
  /\/(shop|store|products|collections|product-category|kategorie|categorie)\/?/i;

/**
 * Paths that belong to a signed-in or transactional area. A link there may carry the word
 * "contact" or "returns" (an account's support form, a returns portal), but it is not the
 * public policy page an agent can read, and it usually answers with a login wall.
 */
const ACCOUNT_AREA_PATTERN =
  /\/(my-account|account|accounts|customer|login|log-in|signin|sign-in|wp-login\.php|wp-admin|cart|checkout)(\/|$)/i;

export function detectPlatform(doc: HtmlDocument, response: FetchedResponse): Platform {
  const generator = (doc.meta('generator') ?? '').toLowerCase();
  const classes = doc.bodyClasses().map((c) => c.toLowerCase());
  const body = response.body.toLowerCase();
  // Platform fingerprints only, never trust decisions.
  const assetHosts = doc.assetHosts(response.finalUrl);
  if (
    classes.includes('woocommerce') ||
    generator.includes('woocommerce') ||
    body.includes('wc-block') ||
    body.includes('/wp-json/wc/')
  ) {
    return 'woocommerce';
  }
  if (
    generator.includes('shopify') ||
    assetHosts.has('cdn.shopify.com') ||
    body.includes('shopify.theme')
  ) {
    return 'shopify';
  }
  if (
    generator.includes('wordpress') ||
    doc.links().some((link) => link.rel === 'https://api.w.org/') ||
    body.includes('/wp-content/')
  ) {
    return 'wordpress';
  }
  return 'unknown';
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

function lastSegment(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  return (segments[segments.length - 1] ?? '').replace(/\.[a-z0-9]{1,5}$/i, '');
}

/**
 * How strongly an anchor looks like the policy link of a kind: 0 when neither its label
 * nor the last path segment names the kind; otherwise a label match counts most and more
 * when every word in the label belongs to a policy label, a footer position counts next,
 * a matching path segment last. "Shipping & returns" in the footer at /shipping-policy
 * scores 7; a product named "WooCommerce Shipping" in the same footer scores 5.
 */
export function policyLinkScore(anchor: Anchor, pathname: string, kind: PolicyKind): number {
  const pattern = POLICY_PATTERNS[kind];
  const text = anchor.text;
  const labelMatches = pattern.test(text);
  const pathMatches = pattern.test(lastSegment(pathname));
  if (!labelMatches && !pathMatches) return 0;
  let score = 0;
  if (labelMatches) {
    const tokens = text
      .toLowerCase()
      .split(/[^\p{L}\p{N}&]+/u)
      .filter(Boolean);
    const known = tokens.filter(isPolicyWord).length;
    score += 2 + 2 * (tokens.length > 0 ? known / tokens.length : 0);
  }
  if (anchor.inFooter) score += 2;
  if (pathMatches) score += 1;
  return score;
}

/**
 * Policy pages by link label or path, the best-scoring candidate per kind. Same-origin
 * links win; a cross-origin link (a privacy policy hosted by the parent company, say) is
 * kept as a fallback because an agent would follow it too. Product pages, listings and
 * account areas are never policy pages, whatever their label says.
 */
export function findPolicyLinks(
  doc: HtmlDocument,
  origin: string,
  base: string = origin,
): Partial<Record<PolicyKind, string>> {
  type Best = Partial<Record<PolicyKind, { url: string; score: number }>>;
  const sameOrigin: Best = {};
  const crossOrigin: Best = {};
  for (const anchor of doc.anchors()) {
    const url = resolveHttpUrl(anchor.href, base);
    if (!url || url.href === `${origin}/`) continue;
    if (ACCOUNT_AREA_PATTERN.test(url.pathname)) continue;
    if (looksLikeProductUrl(url.href) || LISTING_PATTERN.test(url.pathname)) continue;
    const bucket = url.origin === origin ? sameOrigin : crossOrigin;
    for (const kind of Object.keys(POLICY_PATTERNS) as PolicyKind[]) {
      const score = policyLinkScore(anchor, url.pathname, kind);
      if (score === 0) continue;
      const current = bucket[kind];
      if (!current || score > current.score) bucket[kind] = { url: url.href, score };
    }
  }
  const result: Partial<Record<PolicyKind, string>> = {};
  for (const kind of Object.keys(POLICY_PATTERNS) as PolicyKind[]) {
    const best = sameOrigin[kind] ?? crossOrigin[kind];
    if (best) result[kind] = best.url;
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
): Promise<void> {
  for (const [kind, path] of Object.entries(SHOPIFY_POLICY_PATHS) as [PolicyKind, string][]) {
    if (policies[kind]) continue;
    const response = await fetcher.fetch(origin + path);
    if (response.status === 200 && !/<title>[^<]*password/i.test(response.body.slice(0, 2000))) {
      policies[kind] = origin + path;
    }
  }
}

async function discoverSitemap(
  origin: string,
  robots: RobotsTxt | null,
  fetcher: Fetcher,
  maxFetches: number,
  warnings: string[],
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
        (a, b) => Number(looksLikeProductSitemap(b)) - Number(looksLikeProductSitemap(a)),
      );
      for (const child of productFirst) {
        if (fetches >= maxFetches) break;
        const childUrl = resolveSameOrigin(child, origin);
        if (!childUrl) continue;
        fetches += 1;
        const childResponse = await fetcher.fetch(childUrl);
        if (childResponse.status !== 200) continue;
        const childParsed = parseSitemap(childResponse.body);
        if (childParsed.kind !== 'urlset') continue;
        summary.fetchedSitemaps.push(childUrl);
        const childEntries = sameOrigin(childParsed.entries);
        recordLastmods(childEntries);
        const childUrls = childEntries.map((entry) => entry.loc);
        summary.urls.push(...childUrls);
        if (looksLikeProductSitemap(childUrl)) {
          summary.productUrls.push(...childUrls);
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
      : platform === 'shopify' || storeSignals
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
  if (home.status >= 400) {
    throw new TargetUnreachableError(input.href, `HTTP ${home.status}`);
  }
  const origin = new URL(home.finalUrl).origin;
  const hostname = new URL(origin).hostname;
  const homeDoc = new HtmlDocument(home.body);
  const platform = detectPlatform(homeDoc, home);

  const robotsResponse = await fetcher.fetch(`${origin}/robots.txt`);
  const robotsLooksLikeText =
    robotsResponse.status === 200 && !/<html|<!doctype/i.test(robotsResponse.body.slice(0, 500));
  const robots = robotsLooksLikeText ? parseRobotsTxt(robotsResponse.body) : null;
  if (isRobotsAware(fetcher)) fetcher.setRobots(robots);

  const sitemap = await discoverSitemap(
    origin,
    robots,
    fetcher,
    options.maxSitemapFetches ?? 4,
    warnings,
  );

  const anchorUrls = homeDoc
    .anchors()
    .map((anchor) => resolveSameOrigin(anchor.href, origin, home.finalUrl))
    .filter((url): url is string => url !== null);
  const productCandidates =
    sitemap && sitemap.productUrls.length > 0
      ? sitemap.productUrls
      : anchorUrls.filter(looksLikeProductUrl);
  const products = sample(productCandidates, hostname, sampleSize);
  if (products.length === 0) {
    warnings.push(
      'no product URLs found in sitemap or homepage links; product checks will not apply',
    );
  }
  const listing = anchorUrls.find((url) => LISTING_PATTERN.test(new URL(url).pathname));
  const policies = findPolicyLinks(homeDoc, origin, home.finalUrl);
  if (platform === 'shopify') await addShopifyPolicyPages(policies, origin, fetcher);

  const storeSignals =
    products.length > 0 ||
    listing !== undefined ||
    /add[-_ ]to[-_ ]cart|\/cart\b|\/checkout\b/i.test(home.body);
  const profile = selectProfile(platform, storeSignals, options.profile);

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
    profile,
    home,
    homeDoc,
    robotsResponse,
    robots,
    sitemap,
    sampled,
    warnings,
  };
}
