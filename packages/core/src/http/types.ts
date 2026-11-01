/**
 * The fetch boundary. Checks never call fetch directly; they go through a Fetcher that
 * enforces the request budget, timeouts, size caps, redirect limits and URL policy, and
 * caches every response for the lifetime of a scan so two checks never fetch twice.
 */
/** POST exists for one purpose: a read-only JSON-RPC probe of an MCP endpoint the site advertises. */
export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST';

export interface FetchOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  /** Request body, POST only. */
  body?: string;
}

export interface FetchedResponse {
  /** The URL that was requested. */
  url: string;
  /** The URL that answered, after redirects. */
  finalUrl: string;
  /** HTTP status, or 0 when no response was received (see `error`). */
  status: number;
  /** Lower-cased header names. Multi-valued headers are joined with ", ". */
  headers: Record<string, string>;
  body: string;
  bytes: number;
  truncated: boolean;
  redirects: number;
  durationMs: number;
  fromCache: boolean;
  /**
   * Network, timeout or policy error message when status is 0. A response with a status
   * may carry one too, when the body arrived but could not be decoded as declared (for
   * example a gzip sitemap that did not inflate); the body is then the raw text.
   */
  error?: string;
  /** True when this is the outcome of the one retry after a transport error, 429 or 503. */
  retried?: boolean;
}

/** A request that did not succeed: no response after the retry, or a final 429. */
export interface FetchFailure {
  url: string;
  /** 0 for no response, otherwise the final HTTP status (429). */
  status: number;
  /** The error text, or the status with its Retry-After when the server sent one. */
  reason: string;
}

export interface Fetcher {
  fetch(url: string, options?: FetchOptions): Promise<FetchedResponse>;
  /** Requests actually sent (cache hits excluded). */
  readonly requestCount: number;
  readonly budget: number;
  /**
   * Requests that did not succeed, in order, for the scan warnings. Optional so fetchers
   * that answer from a recording need not keep one; a policy refusal is not a failure.
   */
  readonly failures?: readonly FetchFailure[];
}

export class BudgetExhaustedError extends Error {
  constructor(budget: number) {
    super(`Request budget of ${budget} exhausted`);
    this.name = 'BudgetExhaustedError';
  }
}

export class BlockedUrlError extends Error {
  constructor(url: string, reason: string) {
    super(`Refusing to fetch ${url}: ${reason}`);
    this.name = 'BlockedUrlError';
  }
}

export function contentType(response: FetchedResponse): string {
  return (response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export function isOk(response: FetchedResponse): boolean {
  return response.status >= 200 && response.status < 300;
}
