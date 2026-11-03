import type { FetchLike } from '../http/budgeted-fetcher.js';
import type { FetchedResponse, Fetcher } from '../http/types.js';

/**
 * A platform fetch that answers from a Fetcher (a recorded store, a map of responses),
 * so a scan goes through the real BudgetedFetcher: budget, pacing, redirects, step
 * limits. A recorded redirect becomes a 301 to the final URL, which then answers with
 * the recorded body; a recorded network error rejects like a failed fetch. Give the
 * Fetcher a large budget: the BudgetedFetcher in front of it is the one that counts.
 */
export function fetcherAsFetch(fetcher: Fetcher): FetchLike & { calls: () => number } {
  const redirected = new Map<string, FetchedResponse>();
  let calls = 0;
  const fetch: FetchLike = async (input, init) => {
    calls += 1;
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const method = (init.method ?? 'GET') as 'GET' | 'HEAD' | 'POST' | 'OPTIONS';
    const recorded = redirected.get(input) ?? (await fetcher.fetch(input, { method, headers }));
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
  return Object.assign(fetch, { calls: () => calls });
}
