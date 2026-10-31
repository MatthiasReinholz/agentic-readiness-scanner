import { describe, expect, it } from 'vitest';

import { BudgetedFetcher, type FetchLike } from './budgeted-fetcher.js';
import { BudgetExhaustedError } from './types.js';

interface Scripted {
  status?: number;
  headers?: Record<string, string>;
  body?: string | ReadableStream<Uint8Array>;
  throws?: Error;
}

function scripted(script: Record<string, Scripted>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const impl: FetchLike = (input) => {
    calls.push(input);
    const entry = script[input];
    if (!entry) return Promise.resolve(new Response('missing', { status: 404 }));
    if (entry.throws) return Promise.reject(entry.throws);
    return Promise.resolve(
      new Response(entry.body ?? '', { status: entry.status ?? 200, headers: entry.headers ?? {} }),
    );
  };
  return { fetch: impl, calls };
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
      const fetcher = new BudgetedFetcher({ fetch });
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
    const fetcher = new BudgetedFetcher({ fetch, budget: 3 });
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
    const response = await new BudgetedFetcher({ fetch, maxRedirects: 2 }).fetch(
      'https://a.example/',
    );
    expect(response.status).toBe(0);
    expect(response.error).toMatch(/redirects/);
  });

  it('truncates bodies at the cap and says so', async () => {
    const { fetch } = scripted({ 'https://a.example/big': { body: 'x'.repeat(5000) } });
    const response = await new BudgetedFetcher({ fetch, maxBodyBytes: 1000 }).fetch(
      'https://a.example/big',
    );
    expect(response.truncated).toBe(true);
    expect(response.body).toHaveLength(1000);
  });

  it('serves repeats from the cache without spending budget, keyed by method and headers', async () => {
    const { fetch, calls } = scripted({ 'https://a.example/p': { body: 'page' } });
    const fetcher = new BudgetedFetcher({ fetch });
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

  it('turns network errors and failing body streams into status 0 instead of throwing', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'));
        controller.error(new Error('stream reset'));
      },
    });
    const { fetch } = scripted({
      'https://a.example/down': { throws: new TypeError('fetch failed') },
      'https://a.example/stall': { body: broken, headers: { 'content-type': 'text/html' } },
    });
    const fetcher = new BudgetedFetcher({ fetch });
    const down = await fetcher.fetch('https://a.example/down');
    expect(down.status).toBe(0);
    expect(down.error).toBe('TypeError: fetch failed');
    const stall = await fetcher.fetch('https://a.example/stall');
    expect(stall.status).toBe(0);
    expect(stall.error).toMatch(/stream reset/);
  });

  it('rejects blocked URLs before any request is made', async () => {
    const { fetch, calls } = scripted({});
    const fetcher = new BudgetedFetcher({ fetch });
    const response = await fetcher.fetch('http://localhost:8080/');
    expect(response.status).toBe(0);
    expect(calls).toHaveLength(0);
    expect(fetcher.requestCount).toBe(0);
  });
});
