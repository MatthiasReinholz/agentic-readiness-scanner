import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import {
  AI_TRAINING_CRAWLERS,
  aiCrawlerRulesExplicit,
  noIndexingRestrictionsOnProducts,
  shoppingAgentsAllowed,
} from './index.js';

describe('A2.1 explicit rules for AI training crawlers', () => {
  const run = (robots: string | null) =>
    runCheck(aiCrawlerRulesExplicit, targetFor({ robots }), mapFetcher({}));

  it('fails without a robots.txt or when no crawler is named', async () => {
    expect((await run(null)).verdict).toBe('fail');
    const unnamed = await run('User-agent: *\nDisallow: /cart/\n');
    expect(unnamed.verdict).toBe('fail');
    expect(unnamed.evidence).toMatchObject({ named: 0, total: AI_TRAINING_CRAWLERS.length });
  });

  it('warns when some crawlers are named and records each decision', async () => {
    const outcome = await run(
      'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nAllow: /\n',
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({
      named: 2,
      bots: {
        GPTBot: { named: true, allowed: false },
        ClaudeBot: { named: true, allowed: true },
        CCBot: { named: false, allowed: true },
      },
    });
  });

  it('passes when every crawler on the list has a rule, in one shared group or several', async () => {
    const shared = `${AI_TRAINING_CRAWLERS.map((bot) => `User-agent: ${bot}`).join('\n')}\nAllow: /\n`;
    const outcome = await run(shared);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ named: AI_TRAINING_CRAWLERS.length });
  });
});

describe('A2.2 shopping agents allowed on a product page', () => {
  const products = ['https://shop.example/product/mug/'];

  it('passes without robots.txt and when the product path is allowed', async () => {
    const none = await runCheck(shoppingAgentsAllowed, targetFor({ products }), mapFetcher({}));
    expect(none.verdict).toBe('pass');
    expect(none.evidence).toMatchObject({ path: '/product/mug/' });
    const allowed = await runCheck(
      shoppingAgentsAllowed,
      targetFor({ products, robots: 'User-agent: *\nDisallow: /cart/\n' }),
      mapFetcher({}),
    );
    expect(allowed.verdict).toBe('pass');
  });

  it('fails and names the blocked agents', async () => {
    const outcome = await runCheck(
      shoppingAgentsAllowed,
      targetFor({ products, robots: 'User-agent: ChatGPT-User\nDisallow: /product/\n' }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('ChatGPT-User blocked on /product/mug/');
    expect(outcome.evidence).toMatchObject({
      agents: { 'ChatGPT-User': false, 'Claude-User': true },
    });
  });
});

describe('A2.6 indexing restrictions on product pages', () => {
  const page = (robotsMeta?: string) =>
    `<!doctype html><html><head><title>Mug</title>${robotsMeta ? `<meta name="robots" content="${robotsMeta}">` : ''}</head><body>Mug</body></html>`;
  const url = 'https://shop.example/product/mug/';
  const other = 'https://shop.example/product/bowl/';

  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(noIndexingRestrictionsOnProducts, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
  });

  it('fails on noindex in the meta tag or the X-Robots-Tag header', async () => {
    const meta = await runCheck(
      noIndexingRestrictionsOnProducts,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: page('noindex, nofollow') }),
    );
    expect(meta.verdict).toBe('fail');
    expect(meta.evidence).toEqual({
      pages: { [url]: { header: null, meta: 'noindex, nofollow' } },
    });
    const header = await runCheck(
      noIndexingRestrictionsOnProducts,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: { status: 200, headers: { 'X-Robots-Tag': 'noindex' }, body: page() } }),
    );
    expect(header.verdict).toBe('fail');
    expect(header.message).toBe('1 sampled product page(s) carry noindex');
  });

  it('warns on snippet or AI limits and passes on clean pages', async () => {
    const limited = await runCheck(
      noIndexingRestrictionsOnProducts,
      targetFor({ products: [url, other] }),
      mapFetcher({ [url]: page('nosnippet'), [other]: page() }),
    );
    expect(limited.verdict).toBe('warn');
    expect(limited.message).toBe('1 sampled product page(s) limit snippets or AI use');
    const clean = await runCheck(
      noIndexingRestrictionsOnProducts,
      targetFor({ products: [url, other] }),
      mapFetcher({ [url]: page('index, follow, max-snippet:-1'), [other]: page() }),
    );
    expect(clean.verdict).toBe('pass');
  });
});
