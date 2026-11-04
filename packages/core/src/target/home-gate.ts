/**
 * Home pages that cannot stand for the site, besides an outright refusal: a maintenance
 * page served for every URL, a redirect to another site, and a redirect to a consent or
 * region gate. The resolver treats each like a refused home page, so the report says what
 * was not evaluated instead of scoring a page that is not the store.
 */
import { registrableDomain } from '../http/domain.js';
import type { FetchedResponse } from '../http/types.js';
import { HtmlDocument } from '../parsers/html.js';

/** The page's <title>, whitespace collapsed, or '' when it has none. */
export function pageTitle(body: string): string {
  const raw = /<title[^>]*>([^<]{0,300})/i.exec(body.slice(0, 20_000))?.[1] ?? '';
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Words of maintenance and holding pages, in the languages the policy patterns cover. Only
 * read on a small page that robots.txt also answers with, never on its own.
 */
const HOLDING_PHRASES =
  /\bmaintenance\b|\bwartung(?:sarbeiten|smodus)?\b|be right back|back (?:soon|shortly)|temporarily (?:unavailable|closed|down|offline)|currently (?:unavailable|offline|closed|down)|down for maintenance|under construction|coming soon|opening soon|scheduled downtime|we(?:'|’)ll be back|bientôt de retour|en travaux|mantenimiento|manutenzione|onderhoud|im aufbau|in kürze wieder/i;

/** A holding page is small: a full home page served for every path is a routing quirk, not a holding page. */
const HOLDING_MAX_BYTES = 50_000;
const HOLDING_MAX_WORDS = 300;

export interface HoldingPage {
  /** The page title, or a short excerpt of its text when it has none. */
  label: string;
}

/**
 * Recognises a catch-all holding page: robots.txt answers 200 with HTML whose body or
 * title equals the home page's, the page is small, and it either uses maintenance or
 * holding vocabulary or links nowhere and loads no scripts. An app shell that a single-page
 * application serves for every path has the same title too, but it loads scripts and says
 * nothing about maintenance, so it is not one: its emptiness is a finding of its own.
 * A robots.txt that is HTML but differs from the home page (a 404 template served as 200)
 * is never a holding page.
 */
export function detectHoldingPage(
  home: FetchedResponse,
  robots: FetchedResponse,
): HoldingPage | null {
  if (home.status !== 200 || robots.status !== 200) return null;
  if (!/<html|<!doctype|<head|<body|<title/i.test(robots.body.slice(0, 2000))) return null;
  if (home.bytes >= HOLDING_MAX_BYTES || home.body.trim() === '') return null;
  const homeTitle = pageTitle(home.body);
  const sameBody = home.body.trim() === robots.body.trim();
  const sameTitle =
    homeTitle !== '' && homeTitle.toLowerCase() === pageTitle(robots.body).toLowerCase();
  if (!sameBody && !sameTitle) return null;
  const doc = new HtmlDocument(home.body);
  if (doc.wordCount() >= HOLDING_MAX_WORDS) return null;
  const text = doc.text();
  const vocabulary = HOLDING_PHRASES.test(homeTitle) || HOLDING_PHRASES.test(text);
  let origin: string | null = null;
  try {
    origin = new URL(home.finalUrl).origin;
  } catch {
    origin = null;
  }
  const linksSomewhere = doc.anchors().some((anchor) => {
    try {
      const url = new URL(anchor.href, home.finalUrl);
      return url.origin === origin && url.pathname !== new URL(home.finalUrl).pathname;
    } catch {
      return false;
    }
  });
  const inert = !linksSomewhere && doc.externalScripts().length === 0;
  if (!vocabulary && !inert) return null;
  const label = homeTitle || text.replace(/\s+/g, ' ').trim().slice(0, 80);
  return { label };
}

/**
 * True when the final URL is on another registrable domain than the input: a brand that
 * forwards to a parent site or a marketplace. www and apex, http and https, and subdomains
 * of the same registrable domain are the same site.
 */
export function isCrossSiteRedirect(input: URL, finalUrl: string): boolean {
  let final: URL;
  try {
    final = new URL(finalUrl);
  } catch {
    return false;
  }
  return registrableDomain(input.hostname) !== registrableDomain(final.hostname);
}

/**
 * Path segments of consent, cookie and region gates that stand in front of the content:
 * /consent, /cookies, /privacy-gate, /region-select, /choose-country and the like.
 */
const CONSENT_GATE_SEGMENT =
  /^(?:consent|cookies?|cookie-?(?:consent|gate|wall|notice)|gdpr(?:-consent)?|privacy-?(?:gate|consent|choices)|consent-?(?:gate|wall)|region-?select(?:ion|or)?|select-?region|choose-?(?:region|country|location|market)|country-?select(?:ion|or)?|select-?country|geo-?(?:gate|block|blocked)|unsupported-?(?:region|country)|not-available-in-your-(?:region|country))$/i;

/** The gate path when the home page was redirected to one, or null. */
export function consentGatePath(home: FetchedResponse, input: URL): string | null {
  if (home.redirects === 0) return null;
  let final: URL;
  try {
    final = new URL(home.finalUrl);
  } catch {
    return null;
  }
  if (final.pathname === input.pathname) return null;
  const segments = final.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/\.(?:html?|php|aspx?)$/i, ''));
  return segments.some((segment) => CONSENT_GATE_SEGMENT.test(segment)) ? final.pathname : null;
}
