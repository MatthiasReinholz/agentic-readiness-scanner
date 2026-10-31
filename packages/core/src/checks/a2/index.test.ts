import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import {
  honestFetchNotBlocked,
  noAnswerExclusionDirectives,
  SEARCH_CRAWLERS,
  searchCrawlersAllowed,
  SHARED_TRAINING_TOKEN,
  TRAINING_CRAWLERS,
  trainingPolicyStated,
  USER_FETCHERS,
  userFetchersAllowed,
} from './index.js';

describe('A2.1 training policy stated', () => {
  const run = (robots: string | null) =>
    runCheck(trainingPolicyStated, targetFor({ robots }), mapFetcher({}));

  it('warns without a robots.txt or when nothing about training is stated', async () => {
    expect((await run(null)).verdict).toBe('warn');
    const silent = await run('User-agent: *\nDisallow: /cart/\n');
    expect(silent.verdict).toBe('warn');
    expect(silent.evidence).toMatchObject({ shared_token: false, named: 0, usage_line: false });
  });

  it('passes on the shared token, whether it allows or disallows', async () => {
    const disallow = await run(`User-agent: ${SHARED_TRAINING_TOKEN}\nDisallow: /\n`);
    expect(disallow.verdict).toBe('pass');
    expect(disallow.evidence).toMatchObject({ shared_token: true, shared_token_allows: false });
    const allow = await run(`User-agent: ${SHARED_TRAINING_TOKEN}\nAllow: /\n`);
    expect(allow.verdict).toBe('pass');
    expect(allow.evidence).toMatchObject({ shared_token_allows: true });
  });

  it('passes when named training crawlers have a rule and records each decision', async () => {
    const outcome = await run(
      'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nAllow: /\n',
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      named: 2,
      total: TRAINING_CRAWLERS.length,
      tokens: {
        GPTBot: { named: true, allowed: false },
        ClaudeBot: { named: true, allowed: true },
        CCBot: { named: false, allowed: true },
      },
    });
  });

  it('passes on a Content-Signal or Content-Usage training value', async () => {
    const signal = await run('User-agent: *\nContent-Signal: ai-train=no, search=yes\nAllow: /\n');
    expect(signal.verdict).toBe('pass');
    expect(signal.evidence).toMatchObject({ usage_line: true });
    const usage = await run('User-agent: *\nContent-Usage: train-ai=n\nAllow: /\n');
    expect(usage.verdict).toBe('pass');
  });
});

describe('A2.2 search and assistant crawlers may read a product page', () => {
  const products = ['https://shop.example/product/mug/'];
  const run = (robots: string | null) =>
    runCheck(searchCrawlersAllowed, targetFor({ products, robots }), mapFetcher({}));

  it('passes without robots.txt and when the product path is allowed', async () => {
    const none = await run(null);
    expect(none.verdict).toBe('pass');
    expect(none.evidence).toMatchObject({ path: '/product/mug/' });
    const allowed = await run('User-agent: *\nDisallow: /cart/\n');
    expect(allowed.verdict).toBe('pass');
    expect(allowed.evidence).toMatchObject({ blocked: [] });
  });

  it('fails when Googlebot or Bingbot is disallowed, naming what is lost', async () => {
    const outcome = await run('User-agent: Bingbot\nDisallow: /product/\n');
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/^Bingbot disallowed on \/product\/mug\//);
    expect(outcome.evidence).toMatchObject({
      crawlers: { Bingbot: { allowed: false, core: true }, Googlebot: { allowed: true } },
    });
  });

  it('warns on one blocked AI search crawler and fails on two', async () => {
    const one = await run('User-agent: PerplexityBot\nDisallow: /\n');
    expect(one.verdict).toBe('warn');
    expect(one.message).toBe('PerplexityBot disallowed on /product/mug/');
    const two = await run('User-agent: PerplexityBot\nUser-agent: OAI-SearchBot\nDisallow: /\n');
    expect(two.verdict).toBe('fail');
    expect(two.evidence).toMatchObject({ blocked: ['OAI-SearchBot', 'PerplexityBot'] });
  });

  it('never counts a training crawler block against the site', async () => {
    const outcome = await run(
      `${TRAINING_CRAWLERS.map((token) => `User-agent: ${token}`).join('\n')}\nDisallow: /\n`,
    );
    expect(outcome.verdict).toBe('pass');
    expect(Object.keys(outcome.evidence.crawlers as object)).toHaveLength(SEARCH_CRAWLERS.length);
  });
});

describe('A2.5 user-triggered fetchers not disallowed', () => {
  const products = ['https://shop.example/product/mug/'];

  it('passes without rules and fails naming the disallowed fetchers', async () => {
    const none = await runCheck(userFetchersAllowed, targetFor({ products }), mapFetcher({}));
    expect(none.verdict).toBe('pass');
    const blocked = await runCheck(
      userFetchersAllowed,
      targetFor({ products, robots: 'User-agent: ChatGPT-User\nDisallow: /product/\n' }),
      mapFetcher({}),
    );
    expect(blocked.verdict).toBe('fail');
    expect(blocked.message).toMatch(/^ChatGPT-User disallowed on \/product\/mug\//);
    expect(blocked.evidence).toMatchObject({
      fetchers: { 'ChatGPT-User': false, 'Claude-User': true },
      blocked: ['ChatGPT-User'],
    });
    expect(Object.keys(blocked.evidence.fetchers as object)).toHaveLength(USER_FETCHERS.length);
  });
});

describe('A2.6 directives that keep product pages out of AI answers', () => {
  const page = (head = '', body = '<main><h1>Mug</h1><p>A fine mug.</p></main>') =>
    `<!doctype html><html><head><title>Mug</title>${head}</head><body>${body}</body></html>`;
  const url = 'https://shop.example/product/mug/';
  const other = 'https://shop.example/product/bowl/';
  const run = (
    pages: Record<
      string,
      string | { status: number; headers?: Record<string, string>; body?: string }
    >,
  ) =>
    runCheck(
      noAnswerExclusionDirectives,
      targetFor({ products: Object.keys(pages) }),
      mapFetcher(pages),
    );

  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(noAnswerExclusionDirectives, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
  });

  it('fails on noindex in the meta tag or the X-Robots-Tag header', async () => {
    const meta = await run({ [url]: page('<meta name="robots" content="noindex, nofollow">') });
    expect(meta.verdict).toBe('fail');
    expect(meta.evidence).toMatchObject({
      pages: { [url]: { header: null, meta: 'noindex, nofollow', bingbot: null } },
    });
    const header = await run({
      [url]: { status: 200, headers: { 'X-Robots-Tag': 'noindex' }, body: page() },
    });
    expect(header.verdict).toBe('fail');
    expect(header.message).toBe('1 sampled product page(s) carry noindex');
  });

  it('warns on Google snippet limits, data-nosnippet around the content, Bing directives and isAccessibleForFree:false', async () => {
    const google = await run({
      [url]: page('<meta name="robots" content="max-snippet:0">'),
      [other]: page(),
    });
    expect(google.verdict).toBe('warn');
    expect((google.evidence.limiting as string[])[0]).toMatch(/nosnippet \(Google/);
    const wrapped = await run({
      [url]: page(
        '',
        '<div data-nosnippet><main><h1>Mug</h1><p>A fine mug with many words in it.</p></main></div>',
      ),
    });
    expect(wrapped.verdict).toBe('warn');
    expect(
      (wrapped.evidence.pages as Record<string, { nosnippet_coverage: number }>)[url]
        ?.nosnippet_coverage,
    ).toBeGreaterThanOrEqual(0.5);
    const bing = await run({
      [url]: page('<meta name="bingbot" content="ai-grounding:disallow">'),
    });
    expect(bing.verdict).toBe('warn');
    expect((bing.evidence.limiting as string[])[0]).toMatch(/Bing/);
    const apple = await run({
      [url]: page(
        '<script type="application/ld+json">{"@type":"Product","name":"Mug","isAccessibleForFree":false}</script>',
      ),
    });
    expect(apple.verdict).toBe('warn');
    expect(apple.evidence).toMatchObject({ pages: { [url]: { not_accessible_for_free: true } } });
  });

  it('passes on clean pages and records noai as a declared preference only', async () => {
    const outcome = await run({
      [url]: page('<meta name="robots" content="noai, max-image-preview:large">'),
      [other]: page(),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pages: { [url]: { declared_preferences: ['noai'] } },
    });
  });
});

describe('A2.4 no block or challenge on an honest fetch', () => {
  const url = 'https://shop.example/product/mug/';
  const html =
    '<!doctype html><html><head><title>Mug</title></head><body><main>Mug</main></body></html>';

  it('passes when every page the scan touched answered with content', async () => {
    const outcome = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [url], robots: 'User-agent: *\nAllow: /\n' }),
      mapFetcher({ [url]: html }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ refused: [], challenged: [], interstitial: [] });
  });

  it('fails on a refusal status and on a challenge marker or page', async () => {
    const refused = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: { status: 403, body: 'Forbidden' } }),
    );
    expect(refused.verdict).toBe('fail');
    expect(refused.message).toMatch(/refused an honestly identified client \(HTTP 403\)/);
    const header = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: { status: 403, headers: { 'cf-mitigated': 'challenge' }, body: html } }),
    );
    expect(header.verdict).toBe('fail');
    expect(header.evidence).toMatchObject({
      pages: { [url]: { outcome: 'challenged', detail: 'cf-mitigated: challenge' } },
    });
    const page = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [url] }),
      mapFetcher({
        [url]:
          '<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>',
      }),
    );
    expect(page.verdict).toBe('fail');
    expect(page.message).toMatch(/challenge/);
  });

  it('warns when a page redirects to a consent interstitial and ignores network errors', async () => {
    const target = targetFor({ products: [url] });
    const fetcher = mapFetcher({});
    const redirected = {
      ...(await fetcher.fetch(url)),
      status: 200,
      redirects: 1,
      finalUrl: 'https://shop.example/consent?return=/product/mug/',
      body: html,
    };
    const outcome = await runCheck(honestFetchNotBlocked, target, {
      budget: 40,
      requestCount: 0,
      fetch: () => Promise.resolve(redirected),
    });
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({ interstitial: [url] });
    const offline = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: { status: 0 } }),
    );
    expect(offline.verdict).toBe('pass');
    expect(offline.evidence).toMatchObject({ pages: { [url]: { outcome: 'not_fetched' } } });
  });
});
