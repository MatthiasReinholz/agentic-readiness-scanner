import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { FetchOptions, Fetcher } from '../../http/types.js';
import { resolveTarget } from '../../target/resolver.js';
import { fixtureFetcher, mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import {
  accessibleMainContent,
  canonicalAndHreflang,
  MARKDOWN_ACCEPT,
  markdownCopyOfProductPages,
  markdownNeighbour,
  pageWeightAndResponseTime,
  probeUrlFor,
  serverRenderedProductContent,
  unknownUrlsAnswer404,
} from './index.js';

const mug = 'https://shop.example/product/mug/';
const bowl = 'https://shop.example/product/bowl/';

function productHtml(options: { title?: boolean; price?: boolean; words?: number } = {}): string {
  const words = Array.from({ length: options.words ?? 100 }, (_, i) => `word${i}`).join(' ');
  return `<!doctype html><html><head>${options.title === false ? '' : '<title>Mug</title>'}</head><body><h1>Mug</h1>${
    options.price === false ? '' : '<p>EUR 24.00</p>'
  }<p>${words}</p></body></html>`;
}

describe('A3.2 server-rendered product content', () => {
  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(serverRenderedProductContent, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
  });

  it('passes when every page carries title, price and description in raw HTML', async () => {
    const outcome = await runCheck(
      serverRenderedProductContent,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: productHtml(), [bowl]: productHtml() }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      complete: 2,
      total: 2,
      // 100 body words plus title, heading and the two price tokens.
      pages: { [mug]: { title: true, price: true, description: true, words: 104 } },
    });
  });

  it('warns when some pages are complete and fails when none is', async () => {
    const some = await runCheck(
      serverRenderedProductContent,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: productHtml(), [bowl]: productHtml({ price: false }) }),
    );
    expect(some.verdict).toBe('warn');
    expect(some.message).toBe(
      '1 of 2 sampled product page(s) carry title, price and description in raw HTML',
    );
    expect(some.evidence).toMatchObject({ pages: { [bowl]: { price: false } } });
    const none = await runCheck(
      serverRenderedProductContent,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: productHtml({ title: false, words: 10 }) }),
    );
    expect(none.verdict).toBe('fail');
    expect(none.evidence).toMatchObject({
      complete: 0,
      pages: { [mug]: { title: false, description: false } },
    });
  });

  it('accepts a price or description from Product JSON-LD or a price class', async () => {
    const jsonLd = `<!doctype html><html><head><title>Mug</title><script type="application/ld+json">${JSON.stringify(
      {
        '@type': 'Product',
        name: 'Mug',
        description: 'A mug.',
        offers: { '@type': 'Offer', price: '24.00' },
      },
    )}</script></head><body>Mug</body></html>`;
    const fromJsonLd = await runCheck(
      serverRenderedProductContent,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: jsonLd }),
    );
    expect(fromJsonLd.verdict).toBe('pass');
    const priceClass = `<!doctype html><html><head><title>Mug</title><meta name="description" content="A mug."></head><body><span class="woocommerce-Price-amount price">24</span></body></html>`;
    const fromClass = await runCheck(
      serverRenderedProductContent,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: priceClass }),
    );
    expect(fromClass.verdict).toBe('pass');
  });
});

/** The inner fetcher's answers with a fixed response time, to exercise the time limits. */
function slowFetcher(inner: Fetcher, durationMs: number): Fetcher {
  return {
    budget: inner.budget,
    get requestCount() {
      return inner.requestCount;
    },
    async fetch(url: string, options?: FetchOptions) {
      return { ...(await inner.fetch(url, options)), durationMs };
    },
  };
}

function pageOfBytes(bytes: number): string {
  return `<!doctype html><html><head><title>Mug</title></head><body><main>${'x'.repeat(bytes)}</main></body></html>`;
}

describe('A3.3 page weight and response time', () => {
  it('passes when every sampled product page is small and fast', async () => {
    const outcome = await runCheck(
      pageWeightAndResponseTime,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: productHtml(), [bowl]: productHtml() }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(
      /every sampled product page is under 1 MB and 3 s response time/,
    );
    expect(outcome.evidence).toMatchObject({
      sampled: 'products',
      pages: { [mug]: { status: 200, response_ms: 1, truncated: false } },
      slowest_response_ms: 1,
      truncated: false,
    });
    const pages = outcome.evidence.pages as Record<string, { bytes: number }>;
    expect(pages[mug]?.bytes).toBe(new TextEncoder().encode(productHtml()).byteLength);
  });

  it('measures the home page when no product pages were sampled, and says so', async () => {
    const outcome = await runCheck(pageWeightAndResponseTime, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(/home page \(no product pages sampled\)/);
    expect(outcome.evidence).toMatchObject({
      sampled: 'home',
      pages: { 'https://shop.example/': { status: 200 } },
    });
  });

  it('warns on a page between 1 MB and 2 MB', async () => {
    const outcome = await runCheck(
      pageWeightAndResponseTime,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: productHtml(), [bowl]: pageOfBytes(1_200_000) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/exceeds 1 MB or 3 s response time \(largest 1200 KB/);
    expect(outcome.evidence).toMatchObject({ largest_bytes: 1_200_085 });
  });

  it('warns on a response time between 3 s and 8 s', async () => {
    const outcome = await runCheck(
      pageWeightAndResponseTime,
      targetFor({ products: [mug] }),
      slowFetcher(mapFetcher({ [mug]: productHtml() }), 4_000),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/slowest response time 4000 ms/);
    expect(outcome.evidence).toMatchObject({ pages: { [mug]: { response_ms: 4_000 } } });
  });

  it('fails on a page above 2 MB', async () => {
    const outcome = await runCheck(
      pageWeightAndResponseTime,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: pageOfBytes(2_100_000) }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/exceeds 2 MB or 8 s response time/);
  });

  it('fails on a response time above 8 s', async () => {
    const outcome = await runCheck(
      pageWeightAndResponseTime,
      targetFor({ products: [mug] }),
      slowFetcher(mapFetcher({ [mug]: productHtml() }), 9_000),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toMatchObject({ slowest_response_ms: 9_000 });
  });
});

function withHead(head: string): string {
  return `<!doctype html><html><head><title>Mug</title>${head}</head><body><main>Mug</main></body></html>`;
}

const canonical = (href: string) => `<link rel="canonical" href="${href}">`;
const alternate = (lang: string, href: string) =>
  `<link rel="alternate" hreflang="${lang}" href="${href}">`;

describe('A3.4 canonical and hreflang', () => {
  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(canonicalAndHreflang, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
  });

  it('passes when every page carries one rel=canonical on the same origin', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withHead(canonical(mug)),
        // A relative canonical resolves against the page.
        [bowl]: withHead(canonical('/product/bowl/')),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'rel=canonical on every sampled product page resolves to shop.example',
    );
    expect(outcome.evidence).toMatchObject({
      total: 2,
      missing: 0,
      hreflang_pages: 0,
      languages: [],
      pages: {
        [mug]: { canonical: mug, canonical_count: 1, same_origin: true, hreflang: [] },
        [bowl]: { canonical: bowl, same_origin: true },
      },
    });
  });

  it('fails when any page lacks rel=canonical', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: withHead(canonical(mug)), [bowl]: withHead('') }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('1 of 2 sampled product page(s) carry no rel=canonical');
    expect(outcome.evidence).toMatchObject({
      missing: 1,
      pages: { [bowl]: { canonical: null, canonical_count: 0, same_origin: false } },
    });
  });

  it('warns when a page carries several canonicals', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withHead(canonical(mug) + canonical(bowl)) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/more than one rel=canonical/);
    expect(outcome.evidence).toMatchObject({ pages: { [mug]: { canonical_count: 2 } } });
  });

  it('warns when the canonical points to another origin', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withHead(canonical('https://other.example/product/mug/')) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/points to another origin/);
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { canonical: 'https://other.example/product/mug/', same_origin: false } },
    });
  });

  it('warns when only some pages carry hreflang alternates', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withHead(canonical(mug) + alternate('en', mug) + alternate('de', `${mug}?lang=de`)),
        [bowl]: withHead(canonical(bowl)),
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe('hreflang alternates on 1 of 2 sampled product page(s) only');
    expect(outcome.evidence).toMatchObject({ hreflang_pages: 1, languages: ['de', 'en'] });
  });

  it('warns when alternates name a single language and no x-default', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withHead(canonical(mug) + alternate('en', mug)) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/fewer than two languages and no x-default/);
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { hreflang: ['en'], x_default: false } },
    });
  });

  it('passes with complete hreflang alternates on every page', async () => {
    const head = (url: string) =>
      canonical(url) +
      alternate('en', url) +
      alternate('de', `${url}?lang=de`) +
      alternate('x-default', url);
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: withHead(head(mug)), [bowl]: withHead(head(bowl)) }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'rel=canonical on every sampled product page resolves to shop.example with hreflang alternates for de, en',
    );
    expect(outcome.evidence).toMatchObject({
      hreflang_pages: 2,
      pages: { [mug]: { hreflang: ['de', 'en'], x_default: true } },
    });
  });
});

function withBody(body: string): string {
  return `<!doctype html><html><head><title>Mug</title></head><body>${body}</body></html>`;
}

describe('A3.5 accessible main content', () => {
  it('passes when a main landmark exists and overlay markup follows it', async () => {
    const outcome = await runCheck(
      accessibleMainContent,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withBody('<header></header><main>Mug</main><div id="cookie-banner"></div>'),
        [bowl]: withBody('<div role="main">Bowl</div><div role="dialog">Newsletter</div>'),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'main landmark present on every sampled product page with no overlay markup before it',
    );
    expect(outcome.evidence).toMatchObject({
      sampled: 'products',
      total: 2,
      missing_main: 0,
      overlaid: 0,
      pages: {
        [mug]: { main_landmark: true, overlay_before_main: null },
        [bowl]: { main_landmark: true, overlay_before_main: null },
      },
    });
  });

  it('falls back to the home page when no product pages were sampled', async () => {
    const outcome = await runCheck(
      accessibleMainContent,
      targetFor({ homeHtml: withBody('<main>Shop</main>') }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(/home page \(no product pages sampled\)/);
    expect(outcome.evidence).toMatchObject({
      sampled: 'home',
      pages: { 'https://shop.example/': { main_landmark: true } },
    });
  });

  it('warns when a page has no main landmark', async () => {
    const outcome = await runCheck(
      accessibleMainContent,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: withBody('<main>Mug</main>'), [bowl]: withBody('<div>Bowl</div>') }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe('1 of 2 sampled product page(s) have no main landmark');
    expect(outcome.evidence).toMatchObject({
      missing_main: 1,
      pages: { [bowl]: { main_landmark: false, overlay_before_main: null } },
    });
  });

  it('warns when an overlay-like element precedes or wraps the main landmark', async () => {
    const byClass = await runCheck(
      accessibleMainContent,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withBody('<div class="cc-banner cookie-consent" id="cc"></div><main>Mug</main>'),
      }),
    );
    expect(byClass.verdict).toBe('warn');
    expect(byClass.message).toBe(
      'an overlay-like element precedes the main landmark on 1 of 1 sampled product page(s)',
    );
    expect(byClass.evidence).toMatchObject({
      overlaid: 1,
      pages: {
        [mug]: { main_landmark: true, overlay_before_main: 'div#cc.cc-banner.cookie-consent' },
      },
    });
    const byRole = await runCheck(
      accessibleMainContent,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withBody('<div role="dialog" aria-modal="true"></div><main>Mug</main>'),
      }),
    );
    expect(byRole.verdict).toBe('warn');
    expect(byRole.evidence).toMatchObject({ pages: { [mug]: { overlay_before_main: 'div' } } });
    const wrapping = await runCheck(
      accessibleMainContent,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withBody('<div id="modal-root"><main>Mug</main></div>') }),
    );
    expect(wrapping.verdict).toBe('warn');
    expect(wrapping.evidence).toMatchObject({
      pages: { [mug]: { overlay_before_main: 'div#modal-root' } },
    });
  });

  it('ignores scripts and styles named after consent tools', async () => {
    const outcome = await runCheck(
      accessibleMainContent,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withBody(
          '<script id="cookie-consent" src="/cc.js"></script><style class="modal-css"></style><main>Mug</main>',
        ),
      }),
    );
    expect(outcome.verdict).toBe('pass');
  });
});

describe('A3 checks on the good WooCommerce fixture', () => {
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

  it('passes A3.3, A3.4 and A3.5', async () => {
    const fetcher = fixtureFetcher(fixture);
    const target = await resolveTarget('ceramics.example', fetcher);
    expect(target.sampled.products).toHaveLength(2);
    for (const check of [pageWeightAndResponseTime, canonicalAndHreflang, accessibleMainContent]) {
      const outcome = await runCheck(check, target, fetcher);
      expect(outcome.verdict, check.id).toBe('pass');
    }
  });

  it('passes A3.1 through content negotiation on the stoneware mug and A3.6 on the probe URL', async () => {
    const fetcher = fixtureFetcher(fixture);
    const target = await resolveTarget('ceramics.example', fetcher);
    const markdown = await runCheck(markdownCopyOfProductPages, target, fetcher);
    expect(markdown.verdict).toBe('pass');
    expect(markdown.evidence).toMatchObject({
      url: 'https://ceramics.example/product/stoneware-mug/',
      outcome: 'negotiated',
      negotiated: { content_type: 'text/markdown', vary: 'Accept', names_product: true },
    });
    const probe = await runCheck(unknownUrlsAnswer404, target, fetcher);
    expect(probe.verdict).toBe('pass');
    expect(probe.evidence).toMatchObject({ status: 404 });
  });
});

describe('A3.1 machine-readable copy of product pages', () => {
  const html = (links = '') =>
    `<!doctype html><html><head><title>Stoneware Mug – Shop</title>${links}<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Stoneware Mug"}</script></head><body><h1>Stoneware Mug</h1></body></html>`;
  const markdown = (body: string, headers: Record<string, string> = {}) => ({
    status: 200,
    headers: { 'content-type': 'text/markdown; charset=utf-8', ...headers },
    body,
  });
  const negotiating = (body: string, headers: Record<string, string> = {}) => [
    { status: 200, headers: { 'content-type': 'text/html' }, body: html() },
    { ...markdown(body, headers), when: { headers: { accept: 'text/markdown' } } },
  ];
  const run = (fetcher: Fetcher) =>
    runCheck(markdownCopyOfProductPages, targetFor({ products: [mug] }), fetcher);

  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(markdownCopyOfProductPages, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
  });

  it('passes when Accept: text/markdown is answered with Markdown naming the product and Vary: Accept', async () => {
    const fetcher = mapFetcher({
      [mug]: negotiating('# Stoneware Mug\n\nEUR 24', { Vary: 'Accept' }),
    });
    const outcome = await run(fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      url: mug,
      names: ['Stoneware Mug', 'Stoneware Mug – Shop'],
      negotiated: {
        status: 200,
        content_type: 'text/markdown',
        vary: 'Accept',
        names_product: true,
      },
      outcome: 'negotiated',
    });
    expect(fetcher.log[0]?.options.headers).toEqual({ Accept: MARKDOWN_ACCEPT });
  });

  it('warns when the negotiated Markdown comes without Vary: Accept', async () => {
    const outcome = await run(mapFetcher({ [mug]: negotiating('# Stoneware Mug') }));
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/no Vary: Accept/);
    expect(outcome.evidence).toMatchObject({ negotiated: { vary: null }, outcome: 'negotiated' });
  });

  it('passes through a rel=alternate link of type text/markdown', async () => {
    const outcome = await run(
      mapFetcher({
        [mug]: html('<link rel="alternate" type="text/markdown" href="/md/mug">'),
        'https://shop.example/md/mug': markdown('# Stoneware Mug'),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      negotiated: { content_type: '', names_product: null },
      alternate: {
        url: 'https://shop.example/md/mug',
        status: 200,
        content_type: 'text/markdown',
        names_product: true,
      },
      md: null,
      outcome: 'alternate',
    });
  });

  it('passes when the page URL with .md appended answers Markdown', async () => {
    const outcome = await run(
      mapFetcher({
        [mug]: html(),
        'https://shop.example/product/mug.md': markdown('# Stoneware Mug'),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      alternate: null,
      md: { url: 'https://shop.example/product/mug.md', status: 200, names_product: true },
      outcome: 'md',
    });
    expect(markdownNeighbour('https://shop.example/p/mug?v=2#x')).toBe(
      'https://shop.example/p/mug.md',
    );
  });

  it('fails when no copy answers text/markdown naming the product, within three requests', async () => {
    const fetcher = mapFetcher({
      [mug]: [...negotiating('# Something else', { Vary: 'Accept' })].map((answer, index) =>
        index === 0
          ? { ...answer, body: html('<link rel="alternate" type="text/markdown" href="/md/mug">') }
          : answer,
      ),
      'https://shop.example/md/mug': {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: '<html>',
      },
    });
    const outcome = await run(fetcher);
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toMatchObject({
      negotiated: { content_type: 'text/markdown', names_product: false },
      alternate: {
        url: 'https://shop.example/md/mug',
        content_type: 'text/html',
        names_product: null,
      },
      md: { url: 'https://shop.example/product/mug.md', skipped: 'request limit reached' },
      outcome: 'none',
    });
    // negotiated, plain HTML, alternate: the .md neighbour would have been the fourth.
    expect(fetcher.requestCount).toBe(3);
  });
});

describe('A3.6 unknown URLs answer 404', () => {
  const origin = 'https://shop.example';
  const probe = probeUrlFor(origin, 'shop.example');
  const run = (answer: Parameters<typeof mapFetcher>[0][string]) =>
    runCheck(unknownUrlsAnswer404, targetFor(), mapFetcher({ [probe]: answer }));

  it('derives the probe path from the hostname so a scan never fetches a real page', () => {
    expect(probe).toBe('https://shop.example/agentic-readiness-probe-62966561');
    expect(probeUrlFor(origin, 'other.example')).not.toBe(probe);
  });

  it('passes on 404 and 410 whatever the body', async () => {
    const missing = await runCheck(unknownUrlsAnswer404, targetFor(), mapFetcher({}));
    expect(missing.verdict).toBe('pass');
    expect(missing.evidence).toEqual({
      url: probe,
      status: 404,
      final_url: probe,
      content_type: '',
    });
    const gone = await run({
      status: 410,
      headers: { 'content-type': 'text/html' },
      body: '<html>gone</html>',
    });
    expect(gone.verdict).toBe('pass');
  });

  it('warns when the probe lands on the home page', async () => {
    const target = targetFor();
    const fetcher: Fetcher = {
      budget: 1,
      requestCount: 1,
      fetch: (url: string) =>
        Promise.resolve({
          url,
          finalUrl: `${origin}/`,
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: '<html>home</html>',
          bytes: 17,
          truncated: false,
          redirects: 1,
          durationMs: 1,
          fromCache: false,
        }),
    };
    const outcome = await runCheck(unknownUrlsAnswer404, target, fetcher);
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/redirects to the home page/);
    expect(outcome.evidence).toMatchObject({ final_url: `${origin}/` });
  });

  it('warns on a 3xx answer and on a 200 without HTML or any other status', async () => {
    const redirect = await run({ status: 302, headers: { location: '/shop/' } });
    expect(redirect.verdict).toBe('warn');
    expect(redirect.message).toBe('an unknown URL answers HTTP 302 (a redirect) instead of 404');
    const json = await run({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"error":"not found"}',
    });
    expect(json.verdict).toBe('warn');
    expect(json.message).toBe('an unknown URL answers HTTP 200 (application/json) instead of 404');
    const forbidden = await run({ status: 403, body: 'no' });
    expect(forbidden.verdict).toBe('warn');
  });

  it('fails on a 200 HTML page (soft 404)', async () => {
    const outcome = await run({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<!doctype html><html><body>Page not found</body></html>',
    });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/soft 404/);
    expect(outcome.evidence).toMatchObject({ status: 200, content_type: 'text/html' });
  });

  it('skips with reason error when nothing answered', async () => {
    const outcome = await run({ status: 0 });
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('error');
  });
});
