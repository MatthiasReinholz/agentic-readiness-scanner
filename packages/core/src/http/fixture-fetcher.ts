import {
  BudgetExhaustedError,
  type FetchOptions,
  type FetchedResponse,
  type Fetcher,
  type HttpMethod,
} from './types.js';

export interface FixtureResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  /**
   * Request conditions under which this answer applies: the method and lower-cased
   * request header names whose values must contain the given text. Lets a fixture
   * answer differently to `Accept: text/markdown` or to another user agent, which is
   * what the negotiation and agent-profile checks look at. An answer without `when`
   * is the default for its URL.
   */
  when?: { method?: HttpMethod; headers?: Record<string, string> };
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
  private readonly responses = new Map<string, FixtureResponse[]>();
  private sent = 0;
  readonly log: { url: string; options: FetchOptions }[] = [];

  constructor(
    responses: Record<string, FixtureResponse | FixtureResponse[]>,
    options: FixtureFetcherOptions = {},
  ) {
    for (const [url, response] of Object.entries(responses)) {
      const key = normalizeKey(url);
      const list = this.responses.get(key) ?? [];
      list.push(...(Array.isArray(response) ? response : [response]));
      this.responses.set(key, list);
    }
    this.budget = options.budget ?? 40;
  }

  /** The recorded answer whose conditions match the request; the most specific one wins. */
  private select(
    key: string,
    method: HttpMethod,
    headers: Record<string, string>,
  ): FixtureResponse | undefined {
    const candidates =
      this.responses.get(key) ??
      this.responses.get(key.endsWith('/') ? key.slice(0, -1) : `${key}/`) ??
      [];
    let best: FixtureResponse | undefined;
    let bestScore = -1;
    for (const candidate of candidates) {
      const when = candidate.when;
      if (when?.method && when.method !== method) continue;
      const wanted = Object.entries(when?.headers ?? {});
      if (!wanted.every(([name, text]) => (headers[name.toLowerCase()] ?? '').includes(text)))
        continue;
      const score = (when?.method ? 1 : 0) + wanted.length;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
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
    const method = options.method ?? 'GET';
    const requestHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(options.headers ?? {}))
      requestHeaders[name.toLowerCase()] = value;
    const recorded = this.select(key, method, requestHeaders);
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
