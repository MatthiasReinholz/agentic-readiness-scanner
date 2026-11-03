import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScanResult } from '@agentic-readiness/catalog';
import { describe, expect, it } from 'vitest';

import type { FetchLike } from './http/budgeted-fetcher.js';
import type { FetchedResponse, ResponseCache } from './http/types.js';
import {
  continueScan,
  ScanStateMismatchError,
  startScan,
  type ScanStep,
  type StartScanOptions,
} from './resumable.js';
import { scan } from './scan.js';
import { fixtureFetcher } from './testing/index.js';

const fixture = (name: string) =>
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'stores', name);

/**
 * A platform fetch that answers from a recorded store, so a scan goes through the real
 * BudgetedFetcher (budget, pacing, redirects, step limits). Recorded redirects become a
 * 301 to the final URL, which then answers with the recorded body. Counts calls.
 */
function recordedFetch(name: string): { fetch: FetchLike; calls: () => number } {
  const recording = fixtureFetcher(fixture(name), { budget: 1_000_000 });
  const redirected = new Map<string, FetchedResponse>();
  let calls = 0;
  const fetch: FetchLike = async (input, init) => {
    calls += 1;
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const method = (init.method ?? 'GET') as 'GET' | 'HEAD' | 'POST' | 'OPTIONS';
    const recorded = redirected.get(input) ?? (await recording.fetch(input, { method, headers }));
    if (recorded.status === 0) throw new TypeError(recorded.error ?? 'network error');
    if (recorded.redirects > 0 && recorded.finalUrl !== input) {
      redirected.set(recorded.finalUrl, { ...recorded, redirects: 0, url: recorded.finalUrl });
      return new Response(null, { status: 301, headers: { location: recorded.finalUrl } });
    }
    // Statuses that cannot carry a body (204, 205, 304) and HEAD answers get none.
    const body =
      method === 'HEAD' || [204, 205, 304].includes(recorded.status) ? null : recorded.body;
    return new Response(body, { status: recorded.status, headers: recorded.headers });
  };
  return { fetch, calls: () => calls };
}

/** Runs a resumable scan to the end, sending the state through JSON between steps. */
async function stepped(
  url: string,
  options: StartScanOptions,
): Promise<{ result: ScanResult; steps: number; largest: number; decided: number[] }> {
  let step: ScanStep = await startScan(url, options);
  let steps = 1;
  let largest = 0;
  // Checks decided after each paused step: proof that steps, not only the last, do work.
  const decided: number[] = [];
  while (!step.done) {
    const stored = JSON.stringify(step.state);
    largest = Math.max(largest, stored.length);
    decided.push(
      Object.keys(step.state.outcomes).length + Object.keys(step.state.legal_outcomes).length,
    );
    step = await continueScan(JSON.parse(stored) as typeof step.state, options);
    steps += 1;
  }
  return { result: step.result, steps, largest, decided };
}

/** A ResponseCache in memory, as a host would back it with a key-value store. */
function memoryCache(): ResponseCache & { size: () => number } {
  const entries = new Map<string, FetchedResponse>();
  return {
    get: (key) => Promise.resolve(entries.get(key)),
    set: (key, response) => {
      entries.set(key, response);
      return Promise.resolve();
    },
    size: () => entries.size,
  };
}

/**
 * The result without what legitimately differs between runs: when it ran, how long it
 * took, the step count, and measured response times inside evidence and messages.
 */
function comparable(result: ScanResult): unknown {
  const rest: Partial<ScanResult> = { ...result };
  delete rest.duration_ms;
  delete rest.scanned_at;
  delete rest.steps;
  return JSON.parse(
    JSON.stringify(rest, (key, value: unknown) =>
      key.endsWith('_ms')
        ? 'ms'
        : typeof value === 'string'
          ? value.replace(/\d+ ms\b/g, 'N ms')
          : value,
    ),
  ) as unknown;
}

const NOW = () => new Date('2026-11-03T12:00:00Z');

describe('resumable scans', () => {
  it('produce the same result in many steps as in one call', async () => {
    const single = await scan('https://ceramics.example/', {
      fetch: recordedFetch('good-woocommerce').fetch,
      minIntervalMs: 0,
      now: NOW,
    });
    const { result, steps, largest, decided } = await stepped('https://ceramics.example/', {
      fetch: recordedFetch('good-woocommerce').fetch,
      cache: memoryCache(),
      minIntervalMs: 0,
      stepDeadlineMs: 60_000,
      stepBudget: 3,
      maxSteps: 100,
      now: NOW,
    });
    expect(steps).toBeGreaterThan(5);
    expect(result.steps).toBe(steps);
    // Paused steps decide checks one after another; the last step is not doing all the work.
    expect(decided.at(-1)).toBeGreaterThan(40);
    expect(comparable(result)).toEqual(comparable(single));
    // A step deadline never leaves a skip behind.
    expect(result.results.filter((item) => item.skip_reason === 'budget_exhausted')).toEqual([]);
    // Small enough for a database row: no response bodies in the state.
    expect(largest).toBeLessThan(64 * 1024);
  });

  it('count the request budget across steps and end with the usual skips', async () => {
    const { result } = await stepped('https://ceramics.example/', {
      fetch: recordedFetch('good-woocommerce').fetch,
      cache: memoryCache(),
      minIntervalMs: 0,
      budget: 12,
      stepDeadlineMs: 60_000,
      stepBudget: 3,
      maxSteps: 100,
      now: NOW,
    });
    expect(result.requests).toBe(12);
    expect(result.results.some((item) => item.skip_reason === 'budget_exhausted')).toBe(true);
  });

  it('finish with the usual skip semantics once the steps run out', async () => {
    const { result, steps } = await stepped('https://ceramics.example/', {
      fetch: recordedFetch('good-woocommerce').fetch,
      minIntervalMs: 0,
      stepDeadlineMs: 60_000,
      stepBudget: 3,
      maxSteps: 3,
      now: NOW,
    });
    expect(steps).toBe(3);
    expect(result.results.every((item) => item.verdict !== undefined)).toBe(true);
  });

  it('read what a later step needs from the host cache instead of the store', async () => {
    const cache = memoryCache();
    const withCache = recordedFetch('good-woocommerce');
    const withoutCache = recordedFetch('good-woocommerce');
    // Without a cache a step re-reads the resolver's pages, so it needs room for them.
    const options = {
      minIntervalMs: 0,
      stepDeadlineMs: 60_000,
      stepBudget: 14,
      maxSteps: 100,
      now: NOW,
    };
    const cached = await stepped('https://ceramics.example/', {
      ...options,
      fetch: withCache.fetch,
      cache,
    });
    const refetched = await stepped('https://ceramics.example/', {
      ...options,
      fetch: withoutCache.fetch,
    });
    expect(comparable(cached.result)).toEqual(comparable(refetched.result));
    expect(withCache.calls()).toBeLessThan(withoutCache.calls());
    expect(withCache.calls()).toBe(cached.result.requests);
  });

  it('refuse a state from another scanner or catalog version', async () => {
    const first = await startScan('https://ceramics.example/', {
      fetch: recordedFetch('good-woocommerce').fetch,
      minIntervalMs: 0,
      stepDeadlineMs: 60_000,
      stepBudget: 2,
    });
    if (first.done) throw new Error('expected a paused scan');
    await expect(
      continueScan({ ...first.state, scanner_version: '0.0.1' }, { stepDeadlineMs: 60_000 }),
    ).rejects.toBeInstanceOf(ScanStateMismatchError);
    await expect(
      continueScan({ ...first.state, catalog_version: '0.0.1' }, { stepDeadlineMs: 60_000 }),
    ).rejects.toThrow(/catalog 0\.0\.1/);
  });

  it('report active time and the number of steps', async () => {
    const { result, steps } = await stepped('https://blog.example/', {
      fetch: recordedFetch('content-site').fetch,
      minIntervalMs: 0,
      stepDeadlineMs: 60_000,
      stepBudget: 2,
      maxSteps: 100,
    });
    expect(result.steps).toBe(steps);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.duration_ms).toBeLessThan(60_000);
  });

  it('carry on after a step runs out of time, without skipping the check it cut off', async () => {
    const recorded = recordedFetch('good-woocommerce');
    const slow: FetchLike = async (input, init) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return recorded.fetch(input, init);
    };
    const cache = memoryCache();
    const single = await scan('https://ceramics.example/', {
      fetch: recordedFetch('good-woocommerce').fetch,
      minIntervalMs: 0,
      now: NOW,
    });
    const { result, steps } = await stepped('https://ceramics.example/', {
      fetch: slow,
      cache,
      minIntervalMs: 0,
      stepDeadlineMs: 150,
      maxSteps: 50,
      now: NOW,
    });
    expect(steps).toBeGreaterThan(2);
    expect(result.results.filter((item) => item.skip_reason === 'budget_exhausted')).toEqual([]);
    expect(comparable(result)).toEqual(comparable(single));
  }, 60_000);

  it('stop stepping when steps stop deciding checks, and finish with the usual skips', async () => {
    const recorded = recordedFetch('good-woocommerce');
    const slow: FetchLike = async (input, init) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return recorded.fetch(input, init);
    };
    // No cache: every step re-reads the resolver's pages and soon cannot fit the next check.
    const { result, steps } = await stepped('https://ceramics.example/', {
      fetch: slow,
      minIntervalMs: 0,
      stepDeadlineMs: 150,
      maxSteps: 50,
      now: NOW,
    });
    expect(steps).toBeLessThan(50);
    expect(result.results.some((item) => item.skip_reason === 'budget_exhausted')).toBe(true);
  }, 60_000);
});
