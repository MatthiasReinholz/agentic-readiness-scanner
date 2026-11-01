import { DEFAULT_USER_AGENT } from '../version.js';
import {
  BlockedUrlError,
  BudgetExhaustedError,
  type FetchFailure,
  type FetchOptions,
  type FetchedResponse,
  type Fetcher,
} from './types.js';
import { assertPublicUrl } from './url-policy.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface BudgetedFetcherOptions {
  /** The platform fetch. Defaults to globalThis.fetch. */
  fetch?: FetchLike;
  /** Maximum requests per scan, redirects, retries and cache misses included. */
  budget?: number;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  /**
   * Minimum time between two consecutive network requests of the same scan (cache hits
   * excluded). A politeness measure: a scan sends a few dozen requests one after the
   * other, and bot management on real stores started answering 429 with a challenge after
   * the first dozen when they arrived back to back. Requests are sequential, never
   * parallel. Defaults to 150 ms; tests pass 0.
   */
  minIntervalMs?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRY_STATUSES = new Set([429, 503]);
const GZIP_TYPES = new Set(['application/gzip', 'application/x-gzip']);
/** Wait before the one retry of a request that got no response at all. */
const TRANSPORT_RETRY_MS = 500;
/** Wait before the one retry of a 429 or 503 that carries no Retry-After. */
const DEFAULT_RETRY_MS = 1_000;
/** A Retry-After longer than this is honoured by not retrying at all. */
const MAX_RETRY_AFTER_MS = 5_000;
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

/**
 * The wait a Retry-After header asks for, in milliseconds: delay-seconds or an HTTP date
 * (RFC 9110 section 10.2.3). Null when the header is absent or unreadable.
 */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * `Name: message`, plus the cause's message or code when there is one. The platform
 * fetch reports every transport problem as `TypeError: fetch failed` and keeps the
 * part that matters (ECONNRESET, ETIMEDOUT, a TLS code) in `cause`.
 */
export function describeFetchError(error: unknown): string {
  if (error instanceof BlockedUrlError) return error.message;
  if (!(error instanceof Error)) return String(error);
  const cause = causeText(error.cause);
  return `${error.name}: ${error.message}${cause ? ` (${cause})` : ''}`;
}

function causeText(cause: unknown): string | null {
  if (cause === undefined || cause === null) return null;
  if (cause instanceof Error) {
    if (cause.message) return cause.message;
    const code = (cause as { code?: unknown }).code;
    return typeof code === 'string' ? code : cause.name;
  }
  return typeof cause === 'string' ? cause : JSON.stringify(cause);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ReadBody {
  body: string;
  bytes: number;
  truncated: boolean;
  /** Set when the body arrived but could not be decoded as declared; the body is then the raw text. */
  error?: string;
}

interface RawChunks {
  chunks: Uint8Array<ArrayBuffer>[];
  bytes: number;
  truncated: boolean;
}

const EMPTY_BODY: ReadBody = { body: '', bytes: 0, truncated: false };

async function readChunks(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  maxBytes: number,
): Promise<RawChunks> {
  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (bytes - maxBytes)));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { chunks, bytes, truncated };
}

function decodeChunks(chunks: readonly Uint8Array[], decoder: TextDecoder): string {
  const parts = chunks.map((chunk) => decoder.decode(chunk, { stream: true }));
  parts.push(decoder.decode());
  return parts.join('');
}

function startsWithGzipMagic(chunks: readonly Uint8Array[]): boolean {
  const head: number[] = [];
  for (const chunk of chunks) {
    for (const byte of chunk) {
      head.push(byte);
      if (head.length === 2) return head[0] === 0x1f && head[1] === 0x8b;
    }
  }
  return false;
}

/**
 * Whether a body is a gzip file rather than text: declared as application/gzip, served
 * from a `.gz` path (the sitemaps protocol allows compressed sitemaps), or starting with
 * the gzip magic bytes. This is a gzip file, not Content-Encoding, which the platform
 * fetch already removes.
 */
function isGzipFile(response: Response, finalUrl: string, raw: RawChunks): boolean {
  const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type && GZIP_TYPES.has(type)) return true;
  if (new URL(finalUrl).pathname.toLowerCase().endsWith('.gz')) return true;
  return startsWithGzipMagic(raw.chunks);
}

function inflate(raw: RawChunks, maxBytes: number): Promise<RawChunks> {
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const chunk of raw.chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return readChunks(source.pipeThrough(new DecompressionStream('gzip')), maxBytes);
}

/**
 * Reads a body up to the cap. A gzip file is inflated first and the cap applies to the
 * inflated bytes; a gzip file that does not inflate is kept as raw text with the problem
 * recorded, so the request still counts as answered.
 */
async function readLimited(
  response: Response,
  maxBytes: number,
  finalUrl: string,
): Promise<ReadBody> {
  if (!response.body) return EMPTY_BODY;
  const raw = await readChunks(response.body, maxBytes);
  const decoder = decoderFor(response.headers.get('content-type'));
  const asText = (): ReadBody => ({
    body: decodeChunks(raw.chunks, decoder),
    bytes: raw.bytes,
    truncated: raw.truncated,
  });
  if (!isGzipFile(response, finalUrl, raw)) return asText();
  try {
    const inflated = await inflate(raw, maxBytes);
    return {
      body: decodeChunks(inflated.chunks, decoder),
      bytes: inflated.bytes,
      truncated: inflated.truncated || raw.truncated,
    };
  } catch (error) {
    return {
      ...asText(),
      error: `gzip body did not inflate (${error instanceof Error ? error.message : String(error)}); kept as raw text`,
    };
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    record[name] = name in record ? `${record[name]}, ${value}` : value;
  });
  return record;
}

/** One attempt at one hop: either the platform fetch threw, or a response with its body read. */
type Attempt = { error: unknown } | { response: Response; read: ReadBody };

/**
 * A Fetcher backed by the platform fetch. Enforces the scan budget and URL policy,
 * follows redirects manually so every hop is policy-checked, caps body size, paces
 * requests, retries once on a transport error, 429 or 503, and caches responses per scan
 * keyed by method, URL and request headers.
 */
export class BudgetedFetcher implements Fetcher {
  readonly budget: number;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly maxRedirects: number;
  private readonly userAgent: string;
  /** Current politeness interval; starts at the option and grows after a 429 (see backOff). */
  private intervalMs: number;
  private readonly cache = new Map<string, Promise<FetchedResponse>>();
  private readonly failed: FetchFailure[] = [];
  /** Requests run one at a time, so the pacing interval holds even for concurrent callers. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastSentAt = 0;
  private sent = 0;

  constructor(options: BudgetedFetcherOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.budget = options.budget ?? 40;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.intervalMs = options.minIntervalMs ?? 150;
  }

  get requestCount(): number {
    return this.sent;
  }

  /** The politeness interval in force now; grows after the store answers 429. */
  get currentIntervalMs(): number {
    return this.intervalMs;
  }

  /**
   * A 429 means the store wants fewer requests: the interval grows to a second, then to
   * four, for the rest of the scan. Backing off is the honest answer to being told so.
   */
  private backOff(): void {
    this.intervalMs = this.intervalMs < 1000 ? 1000 : Math.min(this.intervalMs * 4, 4000);
  }

  /** Requests that ended without a response after the retry, and every final 429. */
  get failures(): readonly FetchFailure[] {
    return this.failed;
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
    const pending = this.enqueue(() =>
      this.perform(url, method, Object.fromEntries(headers), body),
    );
    this.cache.set(key, pending);
    return pending;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Waits out the politeness interval, then counts the request against the budget. */
  private async acquire(): Promise<void> {
    if (this.sent >= this.budget) {
      throw new BudgetExhaustedError(this.budget);
    }
    const wait = this.lastSentAt + this.intervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.sent += 1;
    this.lastSentAt = Date.now();
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

    let retried = false;
    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      let attempt = await this.attempt(current, method, extraHeaders, requestBody);
      const delay = retryDelayFor(attempt);
      if (delay !== null && !retried && this.sent < this.budget) {
        retried = true;
        await sleep(delay);
        attempt = await this.attempt(current, method, extraHeaders, requestBody);
      }
      if ('error' in attempt) {
        return this.failure(url, current.href, started, attempt.error, hop, retried);
      }
      const { response, read } = attempt;

      const location = response.headers.get('location');
      if (REDIRECT_STATUSES.has(response.status) && location) {
        try {
          const next = new URL(location, current);
          assertPublicUrl(next);
          current = next;
        } catch (error) {
          return this.failure(url, current.href, started, error, hop, retried);
        }
        continue;
      }

      if (response.status === 429) {
        this.backOff();
        const after = response.headers.get('retry-after');
        this.failed.push({
          url,
          status: 429,
          reason: `HTTP 429${after ? `, Retry-After: ${after}` : ''}${retried ? ' (after one retry)' : ''}`,
        });
      }
      return {
        url,
        finalUrl: current.href,
        status: response.status,
        headers: headersToRecord(response.headers),
        body: read.body,
        bytes: read.bytes,
        truncated: read.truncated,
        redirects: hop,
        durationMs: Date.now() - started,
        fromCache: false,
        ...(read.error !== undefined ? { error: read.error } : {}),
        ...(retried ? { retried: true } : {}),
      };
    }
    return this.failure(
      url,
      current.href,
      started,
      new Error(`more than ${this.maxRedirects} redirects`),
      this.maxRedirects,
      retried,
    );
  }

  /** One request to one URL, body included unless it redirects. Never throws for transport problems. */
  private async attempt(
    current: URL,
    method: FetchOptions['method'] & string,
    extraHeaders: Record<string, string>,
    requestBody?: string,
  ): Promise<Attempt> {
    await this.acquire();
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
      return { error };
    }
    if (REDIRECT_STATUSES.has(response.status) && response.headers.get('location')) {
      await response.body?.cancel();
      return { response, read: EMPTY_BODY };
    }
    if (method === 'HEAD') {
      return { response, read: EMPTY_BODY };
    }
    try {
      return { response, read: await readLimited(response, this.maxBodyBytes, current.href) };
    } catch (error) {
      // The body stream failed or timed out after the headers arrived; same outcome as
      // a failed request, and never an unhandled rejection cached for the whole scan.
      return { error };
    }
  }

  private failure(
    url: string,
    finalUrl: string,
    started: number,
    error: unknown,
    redirects = 0,
    retried = false,
  ): FetchedResponse {
    const message = describeFetchError(error);
    this.failed.push({ url, status: 0, reason: message });
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
      ...(retried ? { retried: true } : {}),
    };
  }
}

/**
 * How long to wait before the one retry, or null when the attempt is not retried: a
 * transport error waits 500 ms; a 429 or 503 waits what Retry-After asks when that is at
 * most five seconds, one second when the header is absent, and is not retried when the
 * server asks for longer.
 */
function retryDelayFor(attempt: Attempt): number | null {
  if ('error' in attempt) return TRANSPORT_RETRY_MS;
  if (!RETRY_STATUSES.has(attempt.response.status)) return null;
  const after = retryAfterMs(attempt.response.headers.get('retry-after'));
  if (after === null) return DEFAULT_RETRY_MS;
  return after <= MAX_RETRY_AFTER_MS ? after : null;
}
