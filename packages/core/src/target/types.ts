import type { Market, Platform, Profile, SampledPages } from '@agentic-readiness/catalog';

import type { FetchedResponse } from '../http/types.js';
import type { HtmlDocument } from '../parsers/html.js';
import type { RobotsTxt } from '../parsers/robots.js';

/** URL entries whose lastmod the resolver records, so a huge sitemap stays bounded. */
export const LASTMOD_SAMPLE_LIMIT = 5000;

export interface SitemapSummary {
  /** The sitemap URL that answered first. */
  url: string;
  kind: 'index' | 'urlset';
  childSitemaps: string[];
  /** Child sitemaps that were actually fetched within budget. */
  fetchedSitemaps: string[];
  urls: string[];
  productUrls: string[];
  /**
   * <lastmod> values, as written, of the first LASTMOD_SAMPLE_LIMIT URL entries read
   * (entries without one contribute nothing). Optional so summaries built by hand stay
   * valid; the resolver always records it.
   */
  lastmods?: string[];
}

/**
 * Why the home page was not evaluated:
 * - `refused`: it answered 401, 402, 403, 406, 429 or 451,
 * - `challenge`: it is a bot-management challenge or block page (any status, 200 included),
 * - `holding_page`: a maintenance or holding page the site serves for every URL (robots.txt
 *   answers with the same page),
 * - `cross_site_redirect`: it redirected to another registrable domain,
 * - `consent_gate`: it redirected to a consent, cookie or region gate.
 */
export type HomeBlockedKind =
  'refused' | 'challenge' | 'holding_page' | 'cross_site_redirect' | 'consent_gate';

/** How the home page refused the scanner, when it did; the rest of the scan is then moot. */
export interface HomeBlocked {
  status: number;
  /** The bot-management product the response names, when recognisable. */
  vendor: string | null;
  /** True when the response is a challenge page (JavaScript or CAPTCHA) rather than a plain refusal. */
  challenge: boolean;
  /**
   * Why the home page was not evaluated. The resolver always sets it; optional so targets
   * built by hand stay valid (absent reads as `refused`, or `challenge` when `challenge`).
   */
  kind?: HomeBlockedKind;
  /**
   * The reason as one phrase for messages, e.g. "the home page redirected to another site
   * (www.other.example)". The resolver always sets it.
   */
  detail?: string;
}

/**
 * Whether sitemap discovery could answer "is there a sitemap": complete when a sitemap was
 * read, or when every guess answered definitively (404 and the like). Incomplete when a
 * guess answered 429, 5xx or nothing, the request budget ran out, the fetch allowance for
 * discovery was used up, or the home page was blocked so only declared sitemaps were tried.
 */
export interface SitemapDiscovery {
  complete: boolean;
  /** Why discovery was not complete, as a phrase. */
  reason?: string;
  /** The sitemap URLs requested, in order. */
  tried?: string[];
}

/**
 * The resolved store: everything checks share. Built once by resolveTarget and passed
 * read-only to every check. Page bodies are not stored here; the fetcher caches them.
 */

export interface Target {
  inputUrl: string;
  origin: string;
  hostname: string;
  platform: Platform;
  /** The fingerprint that recognised the platform, e.g. "x-bc-store-id header". */
  platformSignal?: string;
  profile: Profile;
  home: FetchedResponse;
  homeDoc: HtmlDocument;
  robotsResponse: FetchedResponse;
  robots: RobotsTxt | null;
  sitemap: SitemapSummary | null;
  /**
   * How sitemap discovery ended. The resolver always sets it; optional so targets built by
   * hand stay valid (absent reads as complete).
   */
  sitemapDiscovery?: SitemapDiscovery;
  /**
   * Whether the search for product pages ran to the end. False when it stopped on a rate
   * limit, a server error or the budget, so "no product pages" is not established.
   */
  productDiscovery?: { complete: boolean; reason?: string };
  sampled: SampledPages;
  warnings: string[];
  /**
   * Set when the home page cannot stand for the site: it answered 401, 402, 403, 406, 429
   * or 451 to the scanner's honest request, is a challenge page, is a maintenance page the
   * site serves for every URL, or redirected to another site or to a consent gate (see
   * HomeBlocked.kind). Checks that read the home page or sampled pages are skipped by the
   * runner; A2.4 reports the reason.
   */
  blocked?: HomeBlocked;
  /**
   * For Shopify: true when Shopify itself serves the origin (its response headers or the
   * rel="ucp" Link header are present), false for a headless storefront that only loads
   * Shopify assets. The Shopify-only checks (products.json, the UCP catalog) are not
   * applicable to a headless storefront, which gets neither on its own domain.
   */
  shopifyHosted?: boolean;
  /**
   * Markets the store appears to sell to (or that whoever started the scan chose). Set
   * before the legal-signals checks run; readiness checks never read it.
   */
  markets?: readonly Market[];
}
