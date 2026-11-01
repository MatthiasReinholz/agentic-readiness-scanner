import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BudgetedFetcher,
  decoderFor,
  describeFetchError,
  retryAfterMs,
  type BudgetedFetcherOptions,
  type FetchLike,
} from './budgeted-fetcher.js';
import { BudgetExhaustedError } from './types.js';

interface Scripted {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>;
  throws?: Error;
}

/** One answer per URL, or a sequence consumed one answer per call (the last one repeats). */
function scripted(script: Record<string, Scripted | Scripted[]>): {
  fetch: FetchLike;
  calls: string[];
  times: number[];
} {
  const calls: string[] = [];
  const times: number[] = [];
  const impl: FetchLike = (input) => {
    calls.push(input);
    times.push(Date.now());
    const scripted = script[input];
    const entry = Array.isArray(scripted)
      ? scripted[Math.min(calls.filter((c) => c === input).length - 1, scripted.length - 1)]
      : scripted;
    if (!entry) return Promise.resolve(new Response('missing', { status: 404 }));
    if (entry.throws) return Promise.reject(entry.throws);
    return Promise.resolve(
      new Response(entry.body ?? '', { status: entry.status ?? 200, headers: entry.headers ?? {} }),
    );
  };
  return { fetch: impl, calls, times };
}

/** Milliseconds between consecutive requests. */
function gaps(times: readonly number[]): number[] {
  return times.slice(1).map((time, index) => time - (times[index] ?? time));
}

/** A fetcher without pacing, so tests run at full speed. */
function fetcherWith(options: BudgetedFetcherOptions): BudgetedFetcher {
  return new BudgetedFetcher({ minIntervalMs: 0, ...options });
}

async function gzipped(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('BudgetedFetcher', () => {
  it('refuses a redirect into a private address and reports it as a policy failure', async () => {
    for (const target of [
      'http://169.254.169.254/latest/',
      'http://[::ffff:127.0.0.1]/',
      'http://10.0.0.1/',
    ]) {
      const { fetch } = scripted({
        'https://shop.example/': { status: 302, headers: { location: target } },
      });
      const fetcher = fetcherWith({ fetch });
      const response = await fetcher.fetch('https://shop.example/');
      expect(response.status).toBe(0);
      expect(response.error).toMatch(/Refusing to fetch/);
      expect(response.redirects).toBe(0);
    }
  });

  it('follows public redirects, counts every hop against the budget, and stops at the limit', async () => {
    const { fetch, calls } = scripted({
      'https://shop.example/': { status: 301, headers: { location: 'https://www.shop.example/' } },
      'https://www.shop.example/': { status: 200, body: 'home' },
    });
    const fetcher = fetcherWith({ fetch, budget: 3 });
    const response = await fetcher.fetch('https://shop.example/');
    expect(response.status).toBe(200);
    expect(response.finalUrl).toBe('https://www.shop.example/');
    expect(response.redirects).toBe(1);
    expect(fetcher.requestCount).toBe(2);
    expect(calls).toHaveLength(2);

    await fetcher.fetch('https://www.shop.example/a');
    expect(fetcher.requestCount).toBe(3);
    await expect(fetcher.fetch('https://www.shop.example/b')).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    );
  });

  it('gives up after too many redirects', async () => {
    const { fetch } = scripted({
      'https://a.example/': { status: 302, headers: { location: 'https://a.example/' } },
    });
    const response = await fetcherWith({ fetch, maxRedirects: 2 }).fetch('https://a.example/');
    expect(response.status).toBe(0);
    expect(response.error).toMatch(/redirects/);
  });

  it('truncates bodies at the cap and says so', async () => {
    const { fetch } = scripted({ 'https://a.example/big': { body: 'x'.repeat(5000) } });
    const response = await fetcherWith({ fetch, maxBodyBytes: 1000 }).fetch(
      'https://a.example/big',
    );
    expect(response.truncated).toBe(true);
    expect(response.body).toHaveLength(1000);
  });

  it('serves repeats from the cache without spending budget, keyed by method and headers', async () => {
    const { fetch, calls } = scripted({ 'https://a.example/p': { body: 'page' } });
    const fetcher = fetcherWith({ fetch });
    const first = await fetcher.fetch('https://a.example/p');
    const second = await fetcher.fetch('https://a.example/p');
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(fetcher.requestCount).toBe(1);
    await fetcher.fetch('https://a.example/p', { headers: { accept: 'text/markdown' } });
    await fetcher.fetch('https://a.example/p', { method: 'HEAD' });
    expect(fetcher.requestCount).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it('rejects blocked URLs before any request is made and lists them as failures', async () => {
    const { fetch, calls } = scripted({});
    const fetcher = fetcherWith({ fetch });
    const response = await fetcher.fetch('http://localhost:8080/');
    expect(response.status).toBe(0);
    expect(calls).toHaveLength(0);
    expect(fetcher.requestCount).toBe(0);
    expect(fetcher.failures).toHaveLength(1);
    expect(fetcher.failures[0]).toMatchObject({ url: 'http://localhost:8080/', status: 0 });
    expect(fetcher.failures[0]?.reason).toMatch(/Refusing/);
  });
});

describe('gzip bodies', () => {
  const sitemap =
    '<?xml version="1.0"?><urlset><url><loc>https://s.example/p/1</loc></url></urlset>';

  it('inflates a sitemap served as application/gzip, from a .gz path, or by its magic bytes', async () => {
    const bytes = await gzipped(sitemap);
    const { fetch } = scripted({
      'https://s.example/sitemap1.xml.gz': {
        headers: { 'content-type': 'application/gzip' },
        body: bytes,
      },
      'https://s.example/by-path.gz': { body: bytes },
      'https://s.example/by-magic': { headers: { 'content-type': 'text/plain' }, body: bytes },
      'https://s.example/x-gzip': {
        headers: { 'content-type': 'application/x-gzip' },
        body: bytes,
      },
    });
    const fetcher = fetcherWith({ fetch });
    for (const path of ['/sitemap1.xml.gz', '/by-path.gz', '/by-magic', '/x-gzip']) {
      const response = await fetcher.fetch(`https://s.example${path}`);
      expect(response.status, path).toBe(200);
      expect(response.body, path).toBe(sitemap);
      expect(response.bytes, path).toBe(sitemap.length);
      expect(response.error, path).toBeUndefined();
    }
  });

  it('applies the body cap to the inflated bytes', async () => {
    const { fetch } = scripted({
      'https://s.example/big.xml.gz': {
        headers: { 'content-type': 'application/gzip' },
        body: await gzipped('y'.repeat(5000)),
      },
    });
    const response = await fetcherWith({ fetch, maxBodyBytes: 1000 }).fetch(
      'https://s.example/big.xml.gz',
    );
    expect(response.truncated).toBe(true);
    expect(response.body).toBe('y'.repeat(1000));
  });

  it('keeps the raw text and records the problem when a declared gzip body does not inflate', async () => {
    const { fetch } = scripted({
      'https://s.example/broken.xml.gz': {
        headers: { 'content-type': 'application/gzip' },
        body: 'not gzip at all',
      },
    });
    const fetcher = fetcherWith({ fetch });
    const response = await fetcher.fetch('https://s.example/broken.xml.gz');
    expect(response.status).toBe(200);
    expect(response.body).toBe('not gzip at all');
    expect(response.error).toMatch(/gzip body did not inflate/);
    expect(fetcher.failures).toEqual([]);
  });

  it('leaves plain text with a .xml path alone', async () => {
    const { fetch } = scripted({
      'https://s.example/sitemap.xml': {
        headers: { 'content-type': 'application/xml' },
        body: sitemap,
      },
    });
    const response = await fetcherWith({ fetch }).fetch('https://s.example/sitemap.xml');
    expect(response.body).toBe(sitemap);
    expect(response.error).toBeUndefined();
  });
});

describe('pacing', () => {
  it('waits the minimum interval between network requests but not before cache hits', async () => {
    const { fetch, times } = scripted({
      'https://a.example/1': { body: '1' },
      'https://a.example/2': { body: '2' },
      'https://a.example/3': { body: '3' },
    });
    const fetcher = new BudgetedFetcher({ fetch, minIntervalMs: 60 });
    await fetcher.fetch('https://a.example/1');
    await fetcher.fetch('https://a.example/2');
    const before = Date.now();
    await fetcher.fetch('https://a.example/2');
    expect(Date.now() - before).toBeLessThan(40);
    await fetcher.fetch('https://a.example/3');
    expect(times).toHaveLength(3);
    expect(gaps(times).every((gap) => gap >= 55)).toBe(true);
  });

  it('runs concurrent callers one after the other', async () => {
    const { fetch, times } = scripted({
      'https://a.example/1': { body: '1' },
      'https://a.example/2': { body: '2' },
    });
    const fetcher = new BudgetedFetcher({ fetch, minIntervalMs: 60 });
    await Promise.all([fetcher.fetch('https://a.example/1'), fetcher.fetch('https://a.example/2')]);
    expect(gaps(times)).toHaveLength(1);
    expect(gaps(times)[0]).toBeGreaterThanOrEqual(55);
  });
});

describe('retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a transport error once after 500 ms and marks the answer as retried', async () => {
    const { fetch, calls } = scripted({
      'https://a.example/flaky': [{ throws: new TypeError('fetch failed') }, { body: 'recovered' }],
    });
    const fetcher = fetcherWith({ fetch });
    const pending = fetcher.fetch('https://a.example/flaky');
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(calls).toHaveLength(2);
    expect(response.status).toBe(200);
    expect(response.body).toBe('recovered');
    expect(response.retried).toBe(true);
    expect(fetcher.requestCount).toBe(2);
    expect(fetcher.failures).toEqual([]);
  });

  it('turns a second failure into status 0 with the cause and lists it once', async () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const { fetch, calls } = scripted({
      'https://a.example/down': { throws: new TypeError('fetch failed', { cause }) },
    });
    const fetcher = fetcherWith({ fetch });
    const pending = fetcher.fetch('https://a.example/down');
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(calls).toHaveLength(2);
    expect(response.status).toBe(0);
    expect(response.retried).toBe(true);
    expect(response.error).toBe('TypeError: fetch failed (read ECONNRESET)');
    expect(fetcher.failures).toEqual([
      {
        url: 'https://a.example/down',
        status: 0,
        reason: 'TypeError: fetch failed (read ECONNRESET)',
      },
    ]);
  });

  it('retries a body stream that fails after the headers arrived', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'));
        controller.error(new Error('stream reset'));
      },
    });
    const { fetch } = scripted({
      'https://a.example/stall': [
        { body: broken, headers: { 'content-type': 'text/html' } },
        { body: 'whole page' },
      ],
    });
    const pending = fetcherWith({ fetch }).fetch('https://a.example/stall');
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.body).toBe('whole page');
    expect(response.retried).toBe(true);
  });

  it('retries a 429 after a short Retry-After, in seconds or as an HTTP date', async () => {
    const date = new Date(Date.now() + 3000).toUTCString();
    const { fetch, calls } = scripted({
      'https://a.example/seconds': [
        { status: 429, headers: { 'retry-after': '2' } },
        { body: 'ok' },
      ],
      'https://a.example/date': [{ status: 429, headers: { 'retry-after': date } }, { body: 'ok' }],
    });
    const fetcher = fetcherWith({ fetch });
    const seconds = fetcher.fetch('https://a.example/seconds');
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await seconds).status).toBe(200);
    expect(calls).toHaveLength(2);

    const dated = fetcher.fetch('https://a.example/date');
    await vi.advanceTimersByTimeAsync(3000);
    expect((await dated).status).toBe(200);
    expect((await dated).retried).toBe(true);
    expect(fetcher.failures).toEqual([]);
  });

  it('retries a 503 without Retry-After after one second', async () => {
    const { fetch, calls } = scripted({
      'https://a.example/busy': [{ status: 503 }, { body: 'ok' }],
    });
    const pending = fetcherWith({ fetch }).fetch('https://a.example/busy');
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
  });

  it('does not retry a 429 that asks for more than five seconds and lists it as a failure', async () => {
    const { fetch, calls } = scripted({
      'https://a.example/limited': { status: 429, headers: { 'retry-after': '30' } },
    });
    const fetcher = fetcherWith({ fetch });
    const pending = fetcher.fetch('https://a.example/limited');
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(calls).toHaveLength(1);
    expect(response.status).toBe(429);
    expect(response.retried).toBeUndefined();
    expect(fetcher.failures).toEqual([
      { url: 'https://a.example/limited', status: 429, reason: 'HTTP 429, Retry-After: 30' },
    ]);
  });

  it('lists a 429 that persisted through the retry', async () => {
    const { fetch, calls } = scripted({ 'https://a.example/still': { status: 429 } });
    const fetcher = fetcherWith({ fetch });
    const pending = fetcher.fetch('https://a.example/still');
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(calls).toHaveLength(2);
    expect(response.status).toBe(429);
    expect(response.retried).toBe(true);
    expect(fetcher.failures).toEqual([
      { url: 'https://a.example/still', status: 429, reason: 'HTTP 429 (after one retry)' },
    ]);
  });

  it('never retries past the budget', async () => {
    const { fetch, calls } = scripted({
      'https://a.example/down': { throws: new TypeError('fetch failed') },
    });
    const fetcher = fetcherWith({ fetch, budget: 1 });
    const pending = fetcher.fetch('https://a.example/down');
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(calls).toHaveLength(1);
    expect(response.status).toBe(0);
    expect(response.retried).toBeUndefined();
    expect(fetcher.requestCount).toBe(1);
  });
});

describe('retryAfterMs', () => {
  it('reads delay-seconds and HTTP dates, and ignores anything else', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    expect(retryAfterMs('3', now)).toBe(3000);
    expect(retryAfterMs(' 0 ', now)).toBe(0);
    expect(retryAfterMs('Sun, 01 Nov 2026 12:00:04 GMT', now)).toBe(4000);
    expect(retryAfterMs('Sun, 01 Nov 2026 11:00:00 GMT', now)).toBe(0);
    expect(retryAfterMs('soon', now)).toBeNull();
    expect(retryAfterMs(null, now)).toBeNull();
  });
});

describe('describeFetchError', () => {
  it('keeps the name and message and adds the cause message or code', () => {
    expect(describeFetchError(new TypeError('fetch failed'))).toBe('TypeError: fetch failed');
    expect(
      describeFetchError(
        new TypeError('fetch failed', { cause: new Error('connect ETIMEDOUT 1.2.3.4:443') }),
      ),
    ).toBe('TypeError: fetch failed (connect ETIMEDOUT 1.2.3.4:443)');
    const silent = Object.assign(new Error(''), { code: 'UND_ERR_SOCKET' });
    expect(describeFetchError(new TypeError('fetch failed', { cause: silent }))).toBe(
      'TypeError: fetch failed (UND_ERR_SOCKET)',
    );
    expect(describeFetchError('boom')).toBe('boom');
  });
});

describe('charset handling', () => {
  function bytes(values: number[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(values));
        controller.close();
      },
    });
  }

  it('decodes a declared ISO-8859-1 body instead of assuming UTF-8', async () => {
    const { fetch } = scripted({
      'https://shop.example/': {
        headers: { 'content-type': 'text/html; charset=ISO-8859-1' },
        body: bytes([0x43, 0x61, 0x66, 0xe9]),
      },
    });
    const response = await fetcherWith({ fetch }).fetch('https://shop.example/');
    expect(response.body).toBe('Café');
  });

  it('falls back to UTF-8 for an unknown or missing charset label', async () => {
    const utf8 = [0x43, 0x61, 0x66, 0xc3, 0xa9];
    const { fetch } = scripted({
      'https://shop.example/bogus': {
        headers: { 'content-type': 'text/html; charset=x-not-a-charset' },
        body: bytes(utf8),
      },
      'https://shop.example/plain': { headers: { 'content-type': 'text/html' }, body: bytes(utf8) },
    });
    const fetcher = fetcherWith({ fetch });
    expect((await fetcher.fetch('https://shop.example/bogus')).body).toBe('Café');
    expect((await fetcher.fetch('https://shop.example/plain')).body).toBe('Café');
    expect(decoderFor('text/html; charset="iso-8859-1"').encoding).toBe('windows-1252');
    expect(decoderFor(null).encoding).toBe('utf-8');
  });
});
