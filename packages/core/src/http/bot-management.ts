/**
 * Recognising bot-management responses. Used by the resolver (a refused home page) and by
 * the honest-fetch check (A2.4) so both name the same vendor and the same kind of page.
 * Fingerprints are the documented or well-known headers and page phrases of each product;
 * an unrecognised refusal is still a refusal, just without a name.
 */
import type { FetchedResponse } from './types.js';

/** Status codes with which a site refuses a polite client outright. */
export const REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 402, 403, 406, 429, 451]);

/** Titles and phrases of challenge pages: the client is asked to prove itself. */
export const CHALLENGE_PHRASES =
  /just a moment|attention required|verify you are human|checking your browser|enable javascript and cookies to continue|请稍候|pardon our interruption|are you a robot|px-captcha|captcha-delivery\.com|__cf_chl/i;
/** Titles and phrases of denial pages: the client is turned away without a challenge. */
export const DENIAL_PHRASES =
  /access denied|request unsuccessful|incapsula incident|unable to give you access|the request could not be satisfied|request blocked|forbidden/i;
/** Either kind, for callers that only need to know a page is not the content. */
export const CHALLENGE_PAGE = new RegExp(
  `${CHALLENGE_PHRASES.source}|${DENIAL_PHRASES.source}`,
  'i',
);

interface VendorFingerprint {
  name: string;
  header?: [string, RegExp];
  body?: RegExp;
}

const VENDORS: readonly VendorFingerprint[] = [
  { name: 'Cloudflare', header: ['cf-mitigated', /./] },
  {
    name: 'Cloudflare',
    header: ['server', /^cloudflare$/i],
    body: /just a moment|attention required|cf-ray|__cf_chl/i,
  },
  { name: 'Akamai', header: ['server', /akamai/i] },
  { name: 'Akamai', header: ['x-reference-error', /./] },
  {
    name: 'Akamai',
    body: /reference\s*(#|&#35;)\s*\d+\.[0-9a-f]+\.\d+\.[0-9a-f]+|errors\.edgesuite\.net/i,
  },
  { name: 'DataDome', header: ['x-datadome', /./] },
  { name: 'DataDome', body: /captcha-delivery\.com|datadome/i },
  { name: 'Vercel', header: ['x-vercel-mitigated', /./] },
  { name: 'Imperva', header: ['x-iinfo', /./] },
  { name: 'Imperva', body: /incapsula/i },
  { name: 'HUMAN (PerimeterX)', body: /perimeterx|_pxhd|px-captcha/i },
  { name: 'AWS WAF', header: ['x-amzn-waf-action', /./] },
  { name: 'Fastly', header: ['server', /fastly/i], body: /fastly error/i },
];

/** The bot-management product a response names, or null when none is recognisable. */
export function botManagementVendor(response: FetchedResponse): string | null {
  const head = response.body.slice(0, 8000);
  for (const vendor of VENDORS) {
    if (vendor.header) {
      const value = response.headers[vendor.header[0]];
      if (value === undefined || !vendor.header[1].test(value)) continue;
      if (vendor.body && !vendor.body.test(head)) continue;
      return vendor.name;
    }
    if (vendor.body?.test(head)) return vendor.name;
  }
  return null;
}

/**
 * True when the response is a challenge (JavaScript or CAPTCHA) rather than a plain
 * denial: the Cloudflare and Vercel mitigation headers, a DataDome captcha page, or a
 * challenge phrase in a small page.
 */
export function isChallengePage(response: FetchedResponse): boolean {
  if ((response.headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge') return true;
  if ((response.headers['x-vercel-mitigated'] ?? '').toLowerCase() === 'challenge') return true;
  const head = response.body.slice(0, 4000);
  return CHALLENGE_PHRASES.test(head) && response.bytes < 20_000;
}

/**
 * True when a page answered 200 but is a denial or challenge page standing in for the
 * content (a WAF that serves its block page with a success status).
 */
export function isBlockPageServedAs200(response: FetchedResponse): boolean {
  if (response.status !== 200 || response.bytes >= 20_000) return false;
  const head = response.body.slice(0, 4000);
  const title = /<title[^>]*>([^<]{0,200})/i.exec(head)?.[1]?.trim() ?? '';
  return CHALLENGE_PAGE.test(title) || CHALLENGE_PHRASES.test(head);
}

/** One phrase for a refusal: "HTTP 403 from Akamai bot management" or "a DataDome challenge (HTTP 403)". */
export function describeRefusal(response: FetchedResponse): string {
  const vendor = botManagementVendor(response);
  if (isChallengePage(response))
    return `${vendor ? `a ${vendor} challenge` : 'a bot-management challenge'} (HTTP ${response.status})`;
  return `HTTP ${response.status}${vendor ? ` from ${vendor} bot management` : ''}`;
}
