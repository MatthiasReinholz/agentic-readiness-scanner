import { DEFAULT_USER_AGENT } from '../version.js';
import {
  BlockedUrlError,
  BudgetExhaustedError,
  type FetchOptions,
  type FetchedResponse,
  type Fetcher,
} from './types.js';
import { assertPublicUrl } from './url-policy.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface BudgetedFetcherOptions {
  /** The platform fetch. Defaults to globalThis.fetch. */
  fetch?: FetchLike;
  /** Maximum requests per scan, redirects and cache misses included. */
  budget?: number;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7';

/**
 * The decoder for a response's declared charset. Pages that still declare ISO-8859-1 or
 * Windows-1252 would otherwise lose every accented character; unknown labels fall back to
 * UTF-8, which is also the default when no charset is declared.
 */
export function decoderFor(contentTypeHeader: string | null): TextDecoder {
  const label = /;\s*charset\s*=\s*["']?([^"';\s]+)/i.exec(contentTypeHeader ?? '')?.[1];
  if (label) {
    try {
      return new TextDecoder(label, { fatal: false });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return new TextDecoder('utf-8', { fatal: false });
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; bytes: number; truncated: boolean }> {
  if (!response.body) {
    return { body: '', bytes: 0, truncated: false };
  }
  const reader = response.body.getReader();
  const decoder = decoderFor(response.headers.get('content-type'));
  const chunks: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      const keep = value.byteLength - (bytes - maxBytes);
      chunks.push(decoder.decode(value.subarray(0, keep), { stream: true }));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return { body: chunks.join(''), bytes, truncated };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    record[name] = name in record ? `${record[name]}, ${value}` : value;
  });
  return record;
}

/**
 * A Fetcher backed by the platform fetch. Enforces the scan budget and URL policy,
 * follows redirects manually so every hop is policy-checked, caps body size, and caches
 * responses per scan keyed by method, URL and request headers.
 */
export class BudgetedFetcher implements Fetcher {
  readonly budget: number;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly maxRedirects: number;
  private readonly userAgent: string;
  private readonly cache = new Map<string, Promise<FetchedResponse>>();
  private sent = 0;

  constructor(options: BudgetedFetcherOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.budget = options.budget ?? 40;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  get requestCount(): number {
    return this.sent;
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<FetchedResponse> {
    const method = options.method ?? 'GET';
    const headers = Object.entries(options.headers ?? {})
      .map(([key, value]) => [key.toLowerCase(), value] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    const body = method === 'POST' ? (options.body ?? '') : undefined;
    const key = `${method} ${url} ${JSON.stringify(headers)} ${body ?? ''}`;
    const cached = this.cache.get(key);
    if (cached) {
      return { ...(await cached), fromCache: true };
    }
    const pending = this.perform(url, method, Object.fromEntries(headers), body);
    this.cache.set(key, pending);
    return pending;
  }

  private async perform(
    url: string,
    method: FetchOptions['method'] & string,
    extraHeaders: Record<string, string>,
    requestBody?: string,
  ): Promise<FetchedResponse> {
    const started = Date.now();
    let current: URL;
    try {
      current = new URL(url);
      assertPublicUrl(current);
    } catch (error) {
      return this.failure(url, url, started, error);
    }

    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      if (this.sent >= this.budget) {
        throw new BudgetExhaustedError(this.budget);
      }
      this.sent += 1;
      let response: Response;
      try {
        response = await this.fetchImpl(current.href, {
          method,
          headers: { 'user-agent': this.userAgent, accept: DEFAULT_ACCEPT, ...extraHeaders },
          ...(requestBody !== undefined ? { body: requestBody } : {}),
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        return this.failure(url, current.href, started, error, hop);
      }

      const location = response.headers.get('location');
      if (REDIRECT_STATUSES.has(response.status) && location) {
        try {
          const next = new URL(location, current);
          assertPublicUrl(next);
          current = next;
        } catch (error) {
          return this.failure(url, current.href, started, error, hop);
        }
        await response.body?.cancel();
        continue;
      }

      let read: { body: string; bytes: number; truncated: boolean };
      try {
        read =
          method === 'HEAD'
            ? { body: '', bytes: 0, truncated: false }
            : await readLimited(response, this.maxBodyBytes);
      } catch (error) {
        // The body stream failed or timed out after the headers arrived; same outcome as
        // a failed request, and never an unhandled rejection cached for the whole scan.
        return this.failure(url, current.href, started, error, hop);
      }
      const { body, bytes, truncated } = read;
      return {
        url,
        finalUrl: current.href,
        status: response.status,
        headers: headersToRecord(response.headers),
        body,
        bytes,
        truncated,
        redirects: hop,
        durationMs: Date.now() - started,
        fromCache: false,
      };
    }
    return this.failure(
      url,
      current.href,
      started,
      new Error(`more than ${this.maxRedirects} redirects`),
      this.maxRedirects,
    );
  }

  private failure(
    url: string,
    finalUrl: string,
    started: number,
    error: unknown,
    redirects = 0,
  ): FetchedResponse {
    const message =
      error instanceof BlockedUrlError
        ? error.message
        : error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
    return {
      url,
      finalUrl,
      status: 0,
      headers: {},
      body: '',
      bytes: 0,
      truncated: false,
      redirects,
      durationMs: Date.now() - started,
      fromCache: false,
      error: message,
    };
  }
}
