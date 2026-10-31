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
  private sent = 0;
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
    if (this.sent >= this.budget) {
      throw new BudgetExhaustedError(this.budget);
    }
    this.sent += 1;
    this.log.push({ url, options });
    const key = normalizeKey(url);
    const recorded =
      this.responses.get(key) ??
      this.responses.get(key.endsWith('/') ? key.slice(0, -1) : `${key}/`);
    const method = options.method ?? 'GET';
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
      fromCache: false,
    });
  }
}
