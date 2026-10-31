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
import { HtmlDocument } from '../parsers/html.js';
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
 * Policy pages by link text or path. Same-origin links win; a cross-origin link (a
 * privacy policy hosted by the parent company, say) is kept as a fallback because an
 * agent would follow it too.
 */
export function findPolicyLinks(
  doc: HtmlDocument,
  origin: string,
  base: string = origin,
): Partial<Record<PolicyKind, string>> {
  const sameOrigin: Partial<Record<PolicyKind, string>> = {};
  const crossOrigin: Partial<Record<PolicyKind, string>> = {};
  for (const anchor of doc.anchors()) {
    const url = resolveHttpUrl(anchor.href, base);
    if (!url || url.href === `${origin}/`) continue;
    const haystack = `${anchor.text} ${url.pathname}`;
    const bucket = url.origin === origin ? sameOrigin : crossOrigin;
    for (const [kind, pattern] of Object.entries(POLICY_PATTERNS) as [PolicyKind, RegExp][]) {
      if (!bucket[kind] && pattern.test(haystack)) {
        bucket[kind] = url.href;
      }
    }
  }
  return { ...crossOrigin, ...sameOrigin };
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
