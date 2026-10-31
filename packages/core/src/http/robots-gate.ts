import { isAllowed, type RobotsTxt } from '../parsers/robots.js';
import type { FetchOptions, FetchedResponse, Fetcher } from './types.js';

/** The product token the scanner identifies as in robots.txt. */
export const SCANNER_ROBOTS_TOKEN = 'AgenticReadinessScanner';

/**
 * Paths the scanner reads even when robots.txt disallows them: the policy file itself,
 * sitemaps and the well-known directory. Everything else honours the store's rules for
 * the scanner's own user agent, as the security model promises.
 */
export function isRobotsExempt(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  return (
    path === '/robots.txt' ||
    path.startsWith('/.well-known/') ||
    path.endsWith('.xml') ||
    path.endsWith('.xml.gz')
  );
}

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export interface RobotsAware {
  setRobots(robots: RobotsTxt | null): void;
}

export function isRobotsAware(fetcher: Fetcher): fetcher is Fetcher & RobotsAware {
  return typeof (fetcher as Partial<RobotsAware>).setRobots === 'function';
}

/**
 * Wraps any Fetcher and refuses requests the target's robots.txt disallows for the
 * scanner. The resolver installs the parsed robots.txt once it has it; until then
 * nothing is blocked (the first requests are the home page and robots.txt itself).
 * A refused request costs no budget and answers like a failed fetch, so checks treat it
 * as "page not readable", which is exactly what an obedient agent would experience.
 */
export class RobotsGatedFetcher implements Fetcher, RobotsAware {
  private robots: RobotsTxt | null = null;
  /** URLs refused so far, for the scan warnings. */
  readonly blocked: string[] = [];

  constructor(
    private readonly inner: Fetcher,
    private readonly token: string = SCANNER_ROBOTS_TOKEN,
  ) {}

  get requestCount(): number {
    return this.inner.requestCount;
  }

  get budget(): number {
    return this.inner.budget;
  }

  setRobots(robots: RobotsTxt | null): void {
    this.robots = robots;
  }

  fetch(url: string, options?: FetchOptions): Promise<FetchedResponse> {
    if (this.robots) {
      const parsed = tryParseUrl(url);
      if (
        parsed &&
        !isRobotsExempt(parsed) &&
        !isAllowed(this.robots, this.token, parsed.pathname + parsed.search)
      ) {
        if (!this.blocked.includes(url)) this.blocked.push(url);
        return Promise.resolve({
          url,
          finalUrl: url,
          status: 0,
          headers: {},
          body: '',
          bytes: 0,
          truncated: false,
          redirects: 0,
          durationMs: 0,
          fromCache: false,
          error: `blocked by robots.txt for ${this.token}`,
        });
      }
    }
    return this.inner.fetch(url, options);
  }
}
