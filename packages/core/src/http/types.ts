/**
 * The fetch boundary. Checks never call fetch directly; they go through a Fetcher that
 * enforces the request budget, timeouts, size caps, redirect limits and URL policy, and
 * caches every response for the lifetime of a scan so two checks never fetch twice.
 */
export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS';

export interface FetchOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
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
  /** Network, timeout or policy error message when status is 0. */
  error?: string;
}

export interface Fetcher {
  fetch(url: string, options?: FetchOptions): Promise<FetchedResponse>;
  /** Requests actually sent (cache hits excluded). */
  readonly requestCount: number;
  readonly budget: number;
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
