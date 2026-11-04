import { describe, expect, it } from 'vitest';

import { BudgetExhaustedError } from '../../http/types.js';
import { mapFetcher, responseOf, runCheck, targetFor } from '../../testing/index.js';
import type { Target } from '../../target/types.js';
import { honestFetchNotBlocked } from './index.js';

const product = 'https://shop.example/product/mug/';
const other = 'https://shop.example/product/bowl/';
const contact = 'https://shop.example/contact/';
const html =
  '<!doctype html><html><head><title>Mug</title></head><body><main>Mug</main></body></html>';

describe('A2.4 decides from the home page, robots.txt and product pages', () => {
  it('counts a 429 on the home page as a refusal', async () => {
    const base = targetFor({ products: [product] });
    const target: Target = {
      ...base,
      home: responseOf('https://shop.example/', { status: 429, body: 'Too Many Requests' }),
    };
    const outcome = await runCheck(honestFetchNotBlocked, target, mapFetcher({ [product]: html }));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(
      /^the home page refused an honestly identified client \(HTTP 429\)/,
    );
  });

  it('is inconclusive when only a product page answered 429 later in the scan', async () => {
    const outcome = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [product, other] }),
      mapFetcher({ [product]: html, [other]: { status: 429, body: '' } }),
    );
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('error');
    expect(outcome.message).toMatch(/^inconclusive: 1 product page\(s\) answered 429/);
    expect(outcome.evidence).toMatchObject({
      rate_limited: [other],
      pages: { [other]: { outcome: 'rate_limited' } },
    });
  });

  it('still fails on a 429 product page when another page shows a block', async () => {
    const outcome = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [product, other] }),
      mapFetcher({
        [product]: { status: 403, body: 'Forbidden' },
        [other]: { status: 429, body: '' },
      }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/^1 product page\(s\) refused/);
  });

  it('ignores a rate-limited policy page', async () => {
    const outcome = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [product], policies: { contact } }),
      mapFetcher({ [product]: html, [contact]: { status: 429, body: '' } }),
    );
    expect(outcome.verdict).toBe('pass');
  });

  it('decides without the policy pages when the budget runs out before them', async () => {
    // The home page and robots.txt are on the target; the product page uses the budget.
    const fetcher = mapFetcher({ [product]: html, [contact]: html }, { budget: 1 });
    const outcome = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [product], policies: { contact } }),
      fetcher,
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(
      /1 policy page\(s\) were not fetched \(Request budget of 1 exhausted\); this check does not need them/,
    );
    expect(outcome.evidence).toMatchObject({ policy_pages_not_fetched: 1 });
  });

  it('does not pass when the budget ran out before a product page', async () => {
    const run = runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [product, other] }),
      mapFetcher({ [product]: html, [other]: html }, { budget: 1 }),
    );
    await expect(run).rejects.toBeInstanceOf(BudgetExhaustedError);
    // A block already seen still decides.
    const blocked = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [product, other] }),
      mapFetcher({ [product]: { status: 403, body: 'Forbidden' }, [other]: html }, { budget: 1 }),
    );
    expect(blocked.verdict).toBe('fail');
  });
});

describe('A2.4 on home pages the resolver did not evaluate', () => {
  it('skips with reason error on a maintenance page or a redirect to another site', async () => {
    for (const [kind, detail] of [
      ['holding_page', 'the home page is a maintenance or holding page ("Shop")'],
      ['cross_site_redirect', 'the home page redirected to another site (other.example)'],
    ] as const) {
      const target: Target = {
        ...targetFor(),
        blocked: { status: 200, vendor: null, challenge: false, kind, detail },
      };
      const outcome = await runCheck(honestFetchNotBlocked, target, mapFetcher({}));
      expect(outcome.verdict).toBe('skip');
      expect(outcome.skipReason).toBe('error');
      expect(outcome.message).toMatch(
        /^The home page .*, so whether the store blocks honest clients could not be judged$/,
      );
    }
  });

  it('warns on a consent gate the resolver recognised', async () => {
    const base = targetFor();
    const target: Target = {
      ...base,
      home: { ...base.home, finalUrl: 'https://shop.example/select-country', redirects: 1 },
      blocked: {
        status: 200,
        vendor: null,
        challenge: false,
        kind: 'consent_gate',
        detail:
          'the home page redirected to a consent or region gate (/select-country) instead of the content',
      },
    };
    const outcome = await runCheck(honestFetchNotBlocked, target, mapFetcher({}));
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({ interstitial: ['https://shop.example/'] });
  });

  it('fails on a challenge page the home page served with HTTP 200', async () => {
    const base = targetFor();
    const target: Target = {
      ...base,
      home: responseOf('https://shop.example/', {
        status: 200,
        headers: { 'cf-mitigated': 'challenge' },
        body: '<html><head><title>Just a moment...</title></head></html>',
      }),
      blocked: { status: 200, vendor: 'Cloudflare', challenge: true, kind: 'challenge' },
    };
    const outcome = await runCheck(honestFetchNotBlocked, target, mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/challenge/);
  });
});
