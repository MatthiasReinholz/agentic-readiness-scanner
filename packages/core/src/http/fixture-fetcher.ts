import {
  BudgetExhaustedError,
  type FetchOptions,
  type FetchedResponse,
  type Fetcher,
} from './types.js';

export interface FixtureResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface FixtureFetcherOptions {
  budget?: number;
}

function normalizeKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.href;
}

/**
 * A Fetcher that answers from a recorded map of URL to response. Used by tests, the
 * nightly reference diff and the CLI's --fixture flag. Unknown URLs answer 404 so a
 * check sees the same thing it would see on a store that lacks the resource.
 */
export class FixtureFetcher implements Fetcher {
  readonly budget: number;
  private readonly responses = new Map<string, FixtureResponse>();
  /** Method and URL of every request counted so far; a repeat is a cache hit, as in production. */
  private readonly seen = new Set<string>();
  private sent = 0;
  /** Every call, cache hits included, so a test can assert what a check asked for. */
  readonly log: { url: string; options: FetchOptions }[] = [];

  constructor(responses: Record<string, FixtureResponse>, options: FixtureFetcherOptions = {}) {
    for (const [url, response] of Object.entries(responses)) {
      this.responses.set(normalizeKey(url), response);
    }
    this.budget = options.budget ?? 40;
  }

  get requestCount(): number {
    return this.sent;
  }

  fetch(url: string, options: FetchOptions = {}): Promise<FetchedResponse> {
    const key = normalizeKey(url);
    const method = options.method ?? 'GET';
    const fromCache = this.seen.has(`${method} ${key}`);
    if (!fromCache) {
      if (this.sent >= this.budget) {
        throw new BudgetExhaustedError(this.budget);
      }
      this.sent += 1;
      this.seen.add(`${method} ${key}`);
    }
    this.log.push({ url, options });
    const recorded =
      this.responses.get(key) ??
      this.responses.get(key.endsWith('/') ? key.slice(0, -1) : `${key}/`);
    const body = recorded?.body ?? '';
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(recorded?.headers ?? {}))
      headers[name.toLowerCase()] = value;
    return Promise.resolve({
      url,
      finalUrl: key,
      status: recorded?.status ?? 404,
      headers,
      body: method === 'HEAD' ? '' : body,
      bytes: new TextEncoder().encode(body).byteLength,
      truncated: false,
      redirects: 0,
      durationMs: 1,
      fromCache,
    });
  }
}
