/**
 * Helpers the platform checks share. A platform check either reads an interface only
 * that platform has, or reads the public trace of one of its settings and names the
 * setting, so the merchant knows which switch to flip.
 */
import type { FetchedResponse } from '../../http/types.js';
import { isAllowed, type RobotsTxt } from '../../parsers/robots.js';
import type { Target } from '../../target/types.js';
import { describeFailure } from '../shared.js';

/** Statuses that say nothing about the resource: throttling or a gateway failure. */
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

export function isTransient(response: Pick<FetchedResponse, 'status'>): boolean {
  return response.status === 0 || TRANSIENT_STATUSES.has(response.status);
}

export function transientPhrase(response: Pick<FetchedResponse, 'status' | 'error'>): string {
  return `${response.status === 429 ? 'was rate limited' : 'failed'} (${describeFailure(response)})`;
}

/** The product tokens of `tokens` that robots.txt disallows at `path`. */
export function disallowed(
  robots: RobotsTxt | null,
  tokens: readonly string[],
  path = '/',
): string[] {
  if (!robots) return [];
  return tokens.filter((token) => !isAllowed(robots, token, path));
}

/** The robots directives of the home page: the meta tag and the X-Robots-Tag header. */
export function homeRobotsDirectives(target: Target): {
  meta: string | null;
  header: string | null;
} {
  return {
    meta: target.homeDoc.meta('robots'),
    header: target.home.headers['x-robots-tag'] ?? null,
  };
}

const NOINDEX = /\bnoindex\b|\bnone\b/i;

/** True when the home page asks every search engine not to index it. */
export function homeNoindex(target: Target): boolean {
  const { meta, header } = homeRobotsDirectives(target);
  // An X-Robots-Tag aimed at one crawler ("bingbot: noindex") is not a site-wide setting.
  const generalHeader = header !== null && !/^\s*[\w-]+\s*:/.test(header) ? header : null;
  return NOINDEX.test(meta ?? '') || NOINDEX.test(generalHeader ?? '');
}

/** True when robots.txt shuts Googlebot and Bingbot out of the whole site. */
export function robotsBlocksSearch(robots: RobotsTxt | null): boolean {
  return disallowed(robots, ['Googlebot', 'Bingbot']).length === 2;
}
