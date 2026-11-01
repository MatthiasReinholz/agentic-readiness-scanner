import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveTarget } from '../../target/resolver.js';
import { fixtureFetcher, mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import {
  honestFetchNotBlocked,
  noAnswerExclusionDirectives,
  renderResourcesNotBlocked,
  SEARCH_CRAWLERS,
  searchCrawlersAllowed,
  SHARED_TRAINING_TOKEN,
  TRAINING_CRAWLERS,
  trainingPolicyStated,
  usagePreferenceSignalsParse,
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
      blocking: [`${url}: noindex`],
    });
    const header = await run({
      [url]: { status: 200, headers: { 'X-Robots-Tag': 'noindex' }, body: page() },
    });
    expect(header.verdict).toBe('fail');
    expect(header.message).toMatch(/^1 sampled product page\(s\) carry noindex; /);
    expect(header.message).toMatch(/AI Overviews and AI Mode/);
  });

  it('fails on nosnippet, max-snippet:0 and data-nosnippet around the content, naming the directive', async () => {
    const maxSnippet = await run({
      [url]: page('<meta name="robots" content="max-snippet:0">'),
      [other]: page(),
    });
    expect(maxSnippet.verdict).toBe('fail');
    expect(maxSnippet.message).toBe(
      '1 sampled product page(s) carry max-snippet:0; Google documents that this keeps the page out of AI Overviews and AI Mode, and Apple generates no web answer from it',
    );
    expect(maxSnippet.evidence).toMatchObject({
      blocking: [`${url}: max-snippet:0`],
      limiting: [],
    });
    const nosnippet = await run({
      [url]: { status: 200, headers: { 'X-Robots-Tag': 'nosnippet' }, body: page() },
    });
    expect(nosnippet.verdict).toBe('fail');
    expect(nosnippet.message).toMatch(/carry nosnippet;/);
    const wrapped = await run({
      [url]: page(
        '',
        '<div data-nosnippet><main><h1>Mug</h1><p>A fine mug with many words in it.</p></main></div>',
      ),
    });
    expect(wrapped.verdict).toBe('fail');
    expect(wrapped.message).toMatch(/data-nosnippet around the main content/);
    expect(
      (wrapped.evidence.pages as Record<string, { nosnippet_coverage: number }>)[url]
        ?.nosnippet_coverage,
    ).toBeGreaterThanOrEqual(0.5);
  });

  it('warns on Bing noarchive, nocache and ai-grounding in the Bingbot meta tag or a Bingbot-prefixed header', async () => {
    const grounding = await run({
      [url]: page('<meta name="bingbot" content="ai-grounding:disallow">'),
    });
    expect(grounding.verdict).toBe('warn');
    expect(grounding.evidence).toMatchObject({ limiting: [`${url}: Bing ai-grounding:disallow`] });
    const extended = await run({
      [url]: page('<meta name="Bingbot" content="ai-grounding:disallowextended">'),
    });
    expect(extended.verdict).toBe('warn');
    expect(extended.evidence).toMatchObject({
      limiting: [`${url}: Bing ai-grounding:disallowextended`],
    });
    const prefixed = await run({
      [url]: {
        status: 200,
        headers: { 'X-Robots-Tag': 'Bingbot: ai-grounding:disallow' },
        body: page(),
      },
    });
    expect(prefixed.verdict).toBe('warn');
    expect(prefixed.evidence).toMatchObject({
      pages: { [url]: { header: 'Bingbot: ai-grounding:disallow', header_for_bingbot: true } },
      limiting: [`${url}: Bing ai-grounding:disallow`],
    });
    const archive = await run({
      [url]: page('<meta name="robots" content="noarchive">'),
      [other]: page('<meta name="bingbot" content="nocache">'),
    });
    expect(archive.verdict).toBe('warn');
    expect(archive.message).toBe(
      '2 sampled product page(s) carry directives that keep them out of AI answers',
    );
    expect(archive.evidence).toMatchObject({
      limiting: [`${url}: Bing noarchive`, `${other}: Bing nocache`],
    });
  });

  it('warns on isAccessibleForFree:false', async () => {
    const apple = await run({
      [url]: page(
        '<script type="application/ld+json">{"@type":"Product","name":"Mug","isAccessibleForFree":false}</script>',
      ),
    });
    expect(apple.verdict).toBe('warn');
    expect(apple.evidence).toMatchObject({ pages: { [url]: { not_accessible_for_free: true } } });
    expect((apple.evidence.limiting as string[])[0]).toMatch(/Apple/);
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

describe('A2.7 render resources not blocked by robots.txt', () => {
  const product = 'https://shop.example/product/mug/';
  const page = (head: string) =>
    `<!doctype html><html><head><title>Mug</title>${head}</head><body><h1>Mug</h1></body></html>`;
  const assets =
    '<link rel="stylesheet" href="/assets/theme.css"><script src="/assets/app.js?v=3"></script>' +
    '<script src="https://cdn.example/lib.js"></script><link rel="stylesheet" href="//cdn.example/x.css">' +
    '<script src="/assets/app.js?v=3"></script><script>inline()</script>';
  const run = (robots: string | null, html = page(assets)) =>
    runCheck(
      renderResourcesNotBlocked,
      targetFor({ robots, products: [product] }),
      mapFetcher({ [product]: html }),
    );

  it('does not judge scripts under cart, checkout or account paths that platforms block on purpose', async () => {
    const page =
      '<!doctype html><html><head><script src="/checkouts/internal/preloads.js?locale=en"></script><script src="/cdn/shop/t/1/assets/theme.js"></script></head><body><main>Boot</main></body></html>';
    const outcome = await runCheck(
      renderResourcesNotBlocked,
      targetFor({
        products: ['https://shop.example/products/boot'],
        robots: 'User-agent: *\nDisallow: /checkouts/\nDisallow: /cart\n',
      }),
      mapFetcher({ 'https://shop.example/products/boot': page }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      assets_checked: 1,
      ignored_transactional: ['/checkouts/internal/preloads.js?locale=en'],
      blocked_googlebot: [],
    });
  });

  it('fails when robots.txt disallows a same-origin asset for Googlebot, counting cross-origin assets out', async () => {
    const outcome = await run('User-agent: *\nDisallow: /assets/\n');
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      '2 of 2 same-origin scripts and stylesheets are disallowed for Googlebot in robots.txt; Google, Applebot and Bing cannot render the page with them',
    );
    expect(outcome.evidence).toMatchObject({
      pages: [product],
      assets_checked: 2,
      blocked_googlebot: ['/assets/app.js?v=3', '/assets/theme.css'],
      blocked_bingbot: ['/assets/app.js?v=3', '/assets/theme.css'],
    });
  });

  it('warns when only Bingbot is blocked and passes when both may fetch everything', async () => {
    const bing = await run('User-agent: Bingbot\nDisallow: /assets/app.js\n');
    expect(bing.verdict).toBe('warn');
    expect(bing.message).toMatch(/1 of 2 .* disallowed for Bingbot/);
    expect(bing.evidence).toMatchObject({
      blocked_googlebot: [],
      blocked_bingbot: ['/assets/app.js?v=3'],
    });
    const open = await run('User-agent: *\nDisallow: /wp-admin/\nAllow: /assets/\n');
    expect(open.verdict).toBe('pass');
    expect(open.message).toBe(
      'all 2 same-origin scripts and stylesheets may be fetched by Googlebot and Bingbot',
    );
  });

  it('passes without a robots.txt, since nothing can be blocked', async () => {
    const outcome = await run(null);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(/absent or unparsable/);
    expect(outcome.evidence).toMatchObject({ assets_checked: 2 });
  });

  it('does not apply when the page loads no same-origin script or stylesheet', async () => {
    const outcome = await run(
      'User-agent: *\nDisallow: /assets/\n',
      page('<script src="https://cdn.example/lib.js"></script>'),
    );
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
    expect(outcome.evidence).toMatchObject({ assets_checked: 0 });
  });

  it('reads the home page when no product page was sampled', async () => {
    const outcome = await runCheck(
      renderResourcesNotBlocked,
      targetFor({ robots: 'User-agent: *\nDisallow: /assets/\n', homeHtml: page(assets) }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toMatchObject({ pages: ['https://shop.example/'] });
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

  it('warns, not fails, when only a policy page is refused', async () => {
    const contact = 'https://shop.example/my-account/contact-support/';
    const outcome = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [url], policies: { contact } }),
      mapFetcher({ [url]: html, [contact]: { status: 403, body: 'Forbidden' } }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/home page and product pages answered/);
    expect(outcome.message).toMatch(/1 policy page\(s\) refused or challenged/);
    expect(outcome.evidence).toMatchObject({
      refused: [contact],
      blocked_policy_pages: [contact],
      pages: { [url]: { outcome: 'ok' }, [contact]: { outcome: 'refused' } },
    });
    const both = await runCheck(
      honestFetchNotBlocked,
      targetFor({ products: [url], policies: { contact } }),
      mapFetcher({
        [url]: { status: 403, body: 'Forbidden' },
        [contact]: { status: 403, body: 'Forbidden' },
      }),
    );
    expect(both.verdict).toBe('fail');
    expect(both.message).toMatch(/1 page\(s\) refused/);
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

describe('A2.3 usage-preference signals parse', () => {
  const tdmrepUrl = 'https://shop.example/.well-known/tdmrep.json';
  interface Signal {
    field: string;
    value: string;
    valid: boolean;
    problem?: string;
  }
  const signalsOf = (evidence: Record<string, unknown>): Signal[] => evidence.signals as Signal[];

  it('skips when nothing is declared, treating an HTML tdmrep.json as a soft 404', async () => {
    const none = await runCheck(
      usagePreferenceSignalsParse,
      targetFor({ robots: 'User-agent: *\nAllow: /\n' }),
      mapFetcher({}),
    );
    expect(none.verdict).toBe('skip');
    expect(none.skipReason).toBe('not_applicable');
    expect(none.message).toMatch(/no usage-preference signal declared/);
    expect(none.evidence).toMatchObject({
      declared: 0,
      malformed: 0,
      tdmrep: { url: tdmrepUrl, status: 404, outcome: 'absent' },
    });
    const soft = await runCheck(
      usagePreferenceSignalsParse,
      targetFor(),
      mapFetcher({ [tdmrepUrl]: '<!doctype html><html><body>Not found</body></html>' }),
    );
    expect(soft.verdict).toBe('skip');
    expect(soft.evidence).toMatchObject({ declared: 0, tdmrep: { outcome: 'soft_404' } });
  });

  it('passes when every signal in every vocabulary is well-formed and lists each one', async () => {
    const target = targetFor({
      robots: [
        'User-agent: *',
        'Content-Signal: ai-train=no, search=yes, ai-input=yes',
        'Content-Usage: train-ai=n',
        'Content-Usage: /public/ train-ai=y',
        'License: https://shop.example/license.xml',
      ].join('\n'),
      homeHtml:
        '<html><head><title>Shop</title><meta name="tdm-reservation" content="1"><meta name="tdm-policy" content="https://shop.example/tdm-policy.json"><link rel="license" type="application/rsl+xml" href="/license.xml"></head><body></body></html>',
    });
    Object.assign(target.home.headers, {
      'content-usage': 'train-ai=n, search=y',
      'tdm-reservation': '1',
      'tdm-policy': 'https://shop.example/tdm-policy.json',
      link: '</license.xml>; rel="license"; type="application/rsl+xml"',
    });
    const outcome = await runCheck(
      usagePreferenceSignalsParse,
      target,
      mapFetcher({
        [tdmrepUrl]: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify([{ location: '/', 'tdm-reservation': 1 }]),
        },
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('12 usage-preference signal(s) declared and well-formed');
    const fields = signalsOf(outcome.evidence).map((signal) => signal.field);
    expect(fields).toEqual([
      'robots.txt Content-Signal',
      'robots.txt Content-Usage',
      'robots.txt Content-Usage',
      'robots.txt License',
      'Content-Usage header',
      'tdm-reservation header',
      'tdm-policy header',
      'tdm-reservation meta tag',
      'tdm-policy meta tag',
      'Link header rel=license (RSL)',
      '<link rel="license"> (RSL)',
      '/.well-known/tdmrep.json',
    ]);
    expect(signalsOf(outcome.evidence).every((signal) => signal.valid)).toBe(true);
    expect(signalsOf(outcome.evidence)[9]?.value).toBe('https://shop.example/license.xml');
    expect(outcome.evidence).toMatchObject({
      declared: 12,
      malformed: 0,
      tdmrep: { outcome: 'declared' },
    });
  });

  it('warns when a signal is malformed and names the field and the problem', async () => {
    const target = targetFor({
      robots: 'User-agent: *\nContent-Signal: train-ai=n\nLicense: /license.xml\n',
      homeHtml:
        '<html><head><title>Shop</title><meta name="tdm-reservation" content="yes"></head><body></body></html>',
    });
    target.home.headers['content-usage'] = 'ai-train=no';
    const outcome = await runCheck(
      usagePreferenceSignalsParse,
      target,
      mapFetcher({
        [tdmrepUrl]: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: '{"tdm-reservation": 1}',
        },
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      '5 of 5 usage-preference signal(s) malformed: robots.txt Content-Signal, robots.txt License, Content-Usage header, tdm-reservation meta tag, /.well-known/tdmrep.json',
    );
    expect(signalsOf(outcome.evidence)).toEqual([
      {
        field: 'robots.txt Content-Signal',
        value: 'train-ai=n',
        valid: false,
        problem: 'unknown signal "train-ai" (ai-train, search, ai-input)',
      },
      {
        field: 'robots.txt License',
        value: '/license.xml',
        valid: false,
        problem: 'not an absolute URL',
      },
      {
        field: 'Content-Usage header',
        value: 'ai-train=no',
        valid: false,
        problem: 'unknown key "ai-train" (train-ai, ai-use, search)',
      },
      { field: 'tdm-reservation meta tag', value: 'yes', valid: false, problem: 'must be 0 or 1' },
      {
        field: '/.well-known/tdmrep.json',
        value: '{"tdm-reservation": 1}',
        valid: false,
        problem: 'must be a JSON array',
      },
    ]);
  });
});

describe('A2 checks on the good WooCommerce fixture', () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    '..',
    'fixtures',
    'stores',
    'good-woocommerce',
  );

  it('passes A2.3', async () => {
    const fetcher = fixtureFetcher(fixture);
    const target = await resolveTarget('ceramics.example', fetcher);
    const outcome = await runCheck(usagePreferenceSignalsParse, target, fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ malformed: 0 });
  });
});
