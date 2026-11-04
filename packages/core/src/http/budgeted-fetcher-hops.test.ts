import { describe, expect, it } from 'vitest';

import { BudgetedFetcher, type FetchLike } from './budgeted-fetcher.js';
import { StepDeadlineError } from './types.js';

/** Redirects and pages by URL; every call is logged. */
function site(routes: Record<string, { status: number; location?: string; body?: string }>): {
  fetch: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const fetch: FetchLike = (input) => {
    calls.push(input);
    const route = routes[input];
    if (!route) return Promise.resolve(new Response('missing', { status: 404 }));
    return Promise.resolve(
      new Response(route.body ?? '', {
        status: route.status,
        headers: route.location ? { location: route.location } : {},
      }),
    );
  };
  return { fetch, calls };
}

const ROUTES = {
  'http://shop.example/': { status: 301, location: 'https://shop.example/' },
  'https://shop.example/': { status: 301, location: 'https://www.shop.example/' },
  'https://www.shop.example/': { status: 200, body: 'home' },
};

describe('BudgetedFetcher redirect hops', () => {
  it('answers a GET of a hop or of the final URL from the cached response', async () => {
    const { fetch, calls } = site(ROUTES);
    const fetcher = new BudgetedFetcher({ fetch, minIntervalMs: 0 });
    const home = await fetcher.fetch('http://shop.example/');
    expect(home).toMatchObject({
      finalUrl: 'https://www.shop.example/',
      redirects: 2,
      hops: ['http://shop.example/', 'https://shop.example/'],
    });
    expect(fetcher.requestCount).toBe(3);

    const hop = await fetcher.fetch('https://shop.example/');
    expect(hop).toMatchObject({
      url: 'https://shop.example/',
      finalUrl: 'https://www.shop.example/',
      status: 200,
      body: 'home',
      redirects: 1,
      hops: ['https://shop.example/'],
      fromCache: true,
    });
    const final = await fetcher.fetch('https://www.shop.example/');
    expect(final).toMatchObject({
      url: 'https://www.shop.example/',
      redirects: 0,
      fromCache: true,
    });
    expect(final.hops).toBeUndefined();
    expect(fetcher.requestCount).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it('asks again for other headers, other methods and unsuccessful answers', async () => {
    const { fetch, calls } = site({
      ...ROUTES,
      'https://shop.example/gone': { status: 301, location: 'https://shop.example/missing' },
    });
    const fetcher = new BudgetedFetcher({ fetch, minIntervalMs: 0 });
    await fetcher.fetch('http://shop.example/');
    await fetcher.fetch('https://shop.example/', { headers: { accept: 'text/markdown' } });
    await fetcher.fetch('https://shop.example/', { method: 'HEAD' });
    expect(calls.slice(3)).toEqual([
      'https://shop.example/',
      'https://www.shop.example/',
      'https://shop.example/',
      'https://www.shop.example/',
    ]);
    // A redirect to a 404 is not reused.
    await fetcher.fetch('https://shop.example/gone');
    const before = calls.length;
    await fetcher.fetch('https://shop.example/missing');
    expect(calls.length).toBe(before + 1);
  });
});

describe('BudgetedFetcher step-capped timeouts', () => {
  /** A fetch that never answers; it fails only when its signal aborts. */
  const hanging: FetchLike = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation timed out.', 'TimeoutError'));
      });
    });

  it('throws StepDeadlineError when the step cut the timeout short, and does not cache it', async () => {
    const fetcher = new BudgetedFetcher({
      fetch: hanging,
      minIntervalMs: 0,
      timeoutMs: 10_000,
      stepDeadlineMs: 80,
    });
    await expect(fetcher.fetch('https://shop.example/slow')).rejects.toBeInstanceOf(
      StepDeadlineError,
    );
    // Nothing counted, nothing recorded as a failure: the next step sends it again.
    expect(fetcher.requestCount).toBe(0);
    expect(fetcher.failures).toEqual([]);
    expect(fetcher.countedRequests()).toEqual({});
  });

  it('still records a timeout of its own as a failed request', async () => {
    const fetcher = new BudgetedFetcher({
      fetch: hanging,
      minIntervalMs: 0,
      timeoutMs: 30,
      stepDeadlineMs: 60_000,
    });
    const response = await fetcher.fetch('https://shop.example/slow');
    expect(response.status).toBe(0);
    expect(fetcher.failures).toHaveLength(1);
  });
});
