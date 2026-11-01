import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { FetchedResponse, FetchOptions, Fetcher } from '../../http/types.js';
import { resolveTarget } from '../../target/resolver.js';
import { fixtureFetcher, mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import {
  accessibleMainContent,
  canonicalAndHreflang,
  conditionalRequestsSupported,
  MARKDOWN_ACCEPT,
  markdownCopyOfProductPages,
  markdownNeighbour,
  mobileViewportDeclared,
  otherHostVariant,
  pageWeightAndResponseTime,
  probeUrlFor,
  productUrlsAnswerDirectly,
  readViewport,
  serverRenderedProductContent,
  titleAndDescriptionPresent,
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
      /every sampled product page is under 1 MB and answered in under 3 s/,
    );
    expect(outcome.evidence).toMatchObject({
      sampled: 'products',
      pages: { [mug]: { status: 200, response_ms: 1, truncated: false } },
      slowest_response_ms: 1,
      truncated: false,
      thresholds: { pass: { bytes: 1_000_000, ms: 3_000 }, fail: { bytes: 2_000_000 } },
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
    expect(outcome.message).toMatch(
      /is 1 MB or more or took 3 s or more to answer \(largest 1200 KB/,
    );
    expect(outcome.evidence).toMatchObject({ largest_bytes: 1_200_085 });
  });

  it('warns on a response time of 3 s or more, however slow', async () => {
    const outcome = await runCheck(
      pageWeightAndResponseTime,
      targetFor({ products: [mug] }),
      slowFetcher(mapFetcher({ [mug]: productHtml() }), 4_000),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/slowest response time 4000 ms/);
    expect(outcome.evidence).toMatchObject({ pages: { [mug]: { response_ms: 4_000 } } });
    // Response time is a crawl-health hint: it never fails the page on its own.
    const verySlow = await runCheck(
      pageWeightAndResponseTime,
      targetFor({ products: [mug] }),
      slowFetcher(mapFetcher({ [mug]: productHtml() }), 9_000),
    );
    expect(verySlow.verdict).toBe('warn');
    expect(verySlow.evidence).toMatchObject({ slowest_response_ms: 9_000 });
  });

  it('fails on a page at or above 2 MB and names the cutoff', async () => {
    const outcome = await runCheck(
      pageWeightAndResponseTime,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: pageOfBytes(2_100_000) }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/reaches the 2 MB cutoff .* \(largest 2100 KB/);
    const exactly = await runCheck(
      pageWeightAndResponseTime,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: pageOfBytes(2_000_000 - 85) }),
    );
    expect(exactly.verdict).toBe('fail');
    expect(exactly.evidence).toMatchObject({ largest_bytes: 2_000_000 });
  });

  it('fails on a truncated body even when the bytes read stay under 2 MB', async () => {
    const inner = mapFetcher({ [mug]: productHtml() });
    const truncating: Fetcher = {
      budget: inner.budget,
      requestCount: 0,
      fetch: async (url, options) => ({ ...(await inner.fetch(url, options)), truncated: true }),
    };
    const outcome = await runCheck(
      pageWeightAndResponseTime,
      targetFor({ products: [mug] }),
      truncating,
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/2 MB cutoff/);
    expect(outcome.evidence).toMatchObject({
      truncated: true,
      pages: { [mug]: { truncated: true } },
    });
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

  it('passes when every page names itself with one absolute rel=canonical', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withHead(canonical(mug)),
        // Host case, a default port and a fragment do not make it another URL.
        [bowl]: withHead(canonical('https://SHOP.example:443/product/bowl/#top')),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'rel=canonical on every sampled product page is absolute and names the page itself',
    );
    expect(outcome.evidence).toMatchObject({
      total: 2,
      missing: 0,
      hreflang_pages: 0,
      languages: [],
      pages: {
        [mug]: {
          canonical: mug,
          canonical_count: 1,
          header_canonical: null,
          source: 'html',
          self_referencing: true,
          same_origin: true,
          absolute: true,
          hreflang: [],
          x_default: false,
          relative_alternates: 0,
        },
        [bowl]: { self_referencing: true, same_origin: true },
      },
    });
  });

  it('reads the canonical from the Link response header too', async () => {
    const headerOnly = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: { status: 200, headers: { Link: `<${mug}>; rel="canonical"` }, body: withHead('') },
      }),
    );
    expect(headerOnly.verdict).toBe('pass');
    expect(headerOnly.evidence).toMatchObject({
      pages: { [mug]: { canonical: mug, header_canonical: mug, source: 'header' } },
    });
    const agreeing = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: {
          status: 200,
          headers: { link: `<${mug}>; rel=canonical, </llms.txt>; rel="llms-txt"` },
          body: withHead(canonical(mug)),
        },
      }),
    );
    expect(agreeing.verdict).toBe('pass');
    expect(agreeing.evidence).toMatchObject({
      pages: { [mug]: { canonical_count: 2, source: 'both', self_referencing: true } },
    });
  });

  it('fails when any page lacks rel=canonical in both places', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: withHead(canonical(mug)), [bowl]: withHead('') }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      '1 of 2 sampled product page(s) carry no rel=canonical in the HTML or the Link header',
    );
    expect(outcome.evidence).toMatchObject({
      missing: 1,
      pages: {
        [bowl]: {
          canonical: null,
          canonical_count: 0,
          source: null,
          same_origin: false,
          absolute: false,
          self_referencing: false,
        },
      },
    });
  });

  it('warns when a page carries several or conflicting canonicals', async () => {
    const several = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withHead(canonical(mug) + canonical(bowl)) }),
    );
    expect(several.verdict).toBe('warn');
    expect(several.message).toMatch(/several or conflicting rel=canonical/);
    expect(several.evidence).toMatchObject({
      issues: { conflicting: 1 },
      pages: { [mug]: { canonical_count: 2 } },
    });
    const disagreeing = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: {
          status: 200,
          headers: { link: `<${bowl}>; rel="canonical"` },
          body: withHead(canonical(mug)),
        },
      }),
    );
    expect(disagreeing.verdict).toBe('warn');
    expect(disagreeing.message).toMatch(/several or conflicting/);
    expect(disagreeing.evidence).toMatchObject({
      pages: { [mug]: { canonical: mug, header_canonical: bowl, source: 'both' } },
    });
  });

  it('warns when the canonical is relative', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withHead(canonical('/product/mug/')) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      'rel=canonical on 1 of 1 sampled product page(s) is a relative URL instead of an absolute one',
    );
    expect(outcome.evidence).toMatchObject({
      issues: { relative: 1 },
      pages: { [mug]: { canonical: mug, absolute: false, self_referencing: true } },
    });
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
      issues: { other_origin: 1 },
      pages: {
        [mug]: {
          canonical: 'https://other.example/product/mug/',
          same_origin: false,
          self_referencing: false,
        },
      },
    });
  });

  it('warns when the canonical is http while the page is https', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withHead(canonical('http://shop.example/product/mug/')) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      'rel=canonical on 1 of 1 sampled product page(s) names http:// while the page is served over https://',
    );
    expect(outcome.evidence).toMatchObject({
      issues: { http_downgrade: 1 },
      pages: { [mug]: { same_origin: false, absolute: true } },
    });
  });

  it('warns when the canonical names another URL, so the sampled page is a duplicate', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withHead(canonical(mug)),
        [bowl]: withHead(canonical('https://shop.example/product/bowl/?variant=blue')),
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      'rel=canonical on 1 of 2 sampled product page(s) names a different URL, so the sampled page is a duplicate of https://shop.example/product/bowl/?variant=blue and that one is what gets indexed',
    );
    expect(outcome.evidence).toMatchObject({
      issues: { not_self: 1 },
      pages: {
        [mug]: { self_referencing: true },
        [bowl]: { self_referencing: false, same_origin: true, absolute: true },
      },
    });
  });

  it('warns when an hreflang alternate is relative', async () => {
    const outcome = await runCheck(
      canonicalAndHreflang,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withHead(
          canonical(mug) +
            alternate('en', mug) +
            alternate('de', '/de/product/mug/') +
            alternate('x-default', mug),
        ),
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      '1 hreflang alternate(s) use a relative URL instead of an absolute one',
    );
    expect(outcome.evidence).toMatchObject({
      relative_alternates: 1,
      pages: { [mug]: { hreflang: ['de', 'en'], x_default: true, relative_alternates: 1 } },
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
      'rel=canonical on every sampled product page is absolute and names the page itself with hreflang alternates for de, en',
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

  it('passes A3.3, A3.4, A3.5 and A3.8', async () => {
    const fetcher = fixtureFetcher(fixture);
    const target = await resolveTarget('ceramics.example', fetcher);
    expect(target.sampled.products).toHaveLength(2);
    for (const check of [
      pageWeightAndResponseTime,
      canonicalAndHreflang,
      accessibleMainContent,
      titleAndDescriptionPresent,
    ]) {
      const outcome = await runCheck(check, target, fetcher);
      expect(outcome.verdict, `${check.id}: ${outcome.message ?? ''}`).toBe('pass');
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

/**
 * A Fetcher whose answers come from `mapFetcher` but whose redirect bookkeeping is
 * overridden per URL: the fixture fetcher cannot express a redirect chain, so a test
 * spreads the recorded response and sets `finalUrl`, `redirects`, `status` and `error`.
 */
function redirectingFetcher(
  record: Parameters<typeof mapFetcher>[0],
  overrides: Record<string, Partial<FetchedResponse>>,
): Fetcher {
  const inner = mapFetcher(record);
  return {
    budget: inner.budget,
    get requestCount() {
      return inner.requestCount;
    },
    async fetch(url: string, options?: FetchOptions) {
      return { ...(await inner.fetch(url, options)), ...overrides[url] };
    },
  };
}

describe('A3.7 product URLs answer directly', () => {
  const origin = 'https://shop.example';
  const httpHome = 'http://shop.example/';
  const wwwHome = 'https://www.shop.example/';
  /** Both host variants redirect to the origin, as a well-configured shop does. */
  const variantsRedirect = {
    [httpHome]: { finalUrl: `${origin}/`, redirects: 1 },
    [wwwHome]: { finalUrl: `${origin}/`, redirects: 1 },
  };

  it('derives the other host variant from the hostname', () => {
    expect(otherHostVariant('shop.example')).toBe('www.shop.example');
    expect(otherHostVariant('www.shop.example')).toBe('shop.example');
  });

  it('passes when every product URL answers 200 in place and both host variants redirect to the origin', async () => {
    const fetcher = redirectingFetcher(
      { [mug]: productHtml(), [bowl]: productHtml(), [httpHome]: 'x', [wwwHome]: 'x' },
      variantsRedirect,
    );
    const outcome = await runCheck(
      productUrlsAnswerDirectly,
      targetFor({ products: [mug, bowl] }),
      fetcher,
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'every sampled product URL answers 200 at its own address and http://shop.example/ and https://www.shop.example/ redirect to https://shop.example',
    );
    expect(outcome.evidence).toMatchObject({
      sampled: 'products',
      origin,
      products: {
        [mug]: { status: 200, redirects: 0, final_url: mug },
        [bowl]: { status: 200, redirects: 0, final_url: bowl },
      },
      variants: {
        http: {
          url: httpHome,
          status: 200,
          final_url: `${origin}/`,
          redirects: 1,
          lands_on_origin: true,
        },
        other_host: { url: wwwHome, lands_on_origin: true, unreachable: false },
      },
    });
    // The product pages were cached by earlier checks; the two variants are the only new requests.
    expect(fetcher.requestCount).toBe(4);
  });

  it('judges the home page when no product pages were sampled, and says so', async () => {
    const outcome = await runCheck(
      productUrlsAnswerDirectly,
      targetFor(),
      redirectingFetcher({ [httpHome]: 'x', [wwwHome]: 'x' }, variantsRedirect),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(
      /^the home page \(no product pages sampled\) answers 200 at its own address/,
    );
    expect(outcome.evidence).toMatchObject({
      sampled: 'home',
      products: { [`${origin}/`]: { status: 200, redirects: 0 } },
    });
  });

  it('does not hold an unreachable host variant against the shop', async () => {
    const outcome = await runCheck(
      productUrlsAnswerDirectly,
      targetFor({ products: [mug] }),
      redirectingFetcher(
        { [mug]: productHtml(), [httpHome]: 'x', [wwwHome]: { status: 0 } },
        { [httpHome]: variantsRedirect[httpHome] },
      ),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'every sampled product URL answers 200 at its own address and http://shop.example/ redirects to https://shop.example (https://www.shop.example/ did not answer)',
    );
    expect(outcome.evidence).toMatchObject({
      variants: { other_host: { status: 0, unreachable: true, lands_on_origin: false } },
    });
  });

  it('fails when a product URL redirects from https to http', async () => {
    const outcome = await runCheck(
      productUrlsAnswerDirectly,
      targetFor({ products: [mug, bowl] }),
      redirectingFetcher(
        { [mug]: productHtml(), [bowl]: productHtml(), [httpHome]: 'x', [wwwHome]: 'x' },
        {
          ...variantsRedirect,
          [bowl]: { finalUrl: 'http://shop.example/product/bowl/', redirects: 1 },
        },
      ),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('1 of 2 sampled product URL(s) redirect from https:// to http://');
    expect(outcome.evidence).toMatchObject({
      products: { [bowl]: { final_url: 'http://shop.example/product/bowl/', redirects: 1 } },
    });
  });

  it('fails when a redirect chain exceeds what the scanner follows', async () => {
    const outcome = await runCheck(
      productUrlsAnswerDirectly,
      targetFor({ products: [mug] }),
      redirectingFetcher(
        { [mug]: productHtml(), [httpHome]: 'x', [wwwHome]: 'x' },
        {
          ...variantsRedirect,
          [mug]: { status: 0, redirects: 5, error: 'Error: more than 5 redirects' },
        },
      ),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      '1 of 1 sampled product URL(s) redirect more times than the scanner follows (Google stops at ten hops)',
    );
    expect(outcome.evidence).toMatchObject({
      products: { [mug]: { status: 0, redirects: 5, error: 'Error: more than 5 redirects' } },
    });
  });

  it('warns when a product URL redirects, naming the count and the longest chain', async () => {
    const oneHop = await runCheck(
      productUrlsAnswerDirectly,
      targetFor({ products: [mug, bowl] }),
      redirectingFetcher(
        { [mug]: productHtml(), [bowl]: productHtml(), [httpHome]: 'x', [wwwHome]: 'x' },
        { ...variantsRedirect, [mug]: { finalUrl: 'https://shop.example/p/mug/', redirects: 1 } },
      ),
    );
    expect(oneHop.verdict).toBe('warn');
    expect(oneHop.message).toBe(
      '1 of 2 sampled product URL(s) redirect before answering, so the sitemap or link should name the final URL',
    );
    expect(oneHop.evidence).toMatchObject({ redirected: 1, longest_chain: 1 });
    const twoHops = await runCheck(
      productUrlsAnswerDirectly,
      targetFor({ products: [mug] }),
      redirectingFetcher(
        { [mug]: productHtml(), [httpHome]: 'x', [wwwHome]: 'x' },
        { ...variantsRedirect, [mug]: { finalUrl: 'https://shop.example/p/mug/', redirects: 2 } },
      ),
    );
    expect(twoHops.verdict).toBe('warn');
    expect(twoHops.message).toBe(
      '1 of 1 sampled product URL(s) redirect through up to 2 hops before answering, so the sitemap or link should name the final URL',
    );
    expect(twoHops.evidence).toMatchObject({ longest_chain: 2 });
  });

  it('warns when a product URL answers something other than 200 without redirecting', async () => {
    const outcome = await runCheck(
      productUrlsAnswerDirectly,
      targetFor({ products: [mug, bowl] }),
      redirectingFetcher(
        { [mug]: productHtml(), [httpHome]: 'x', [wwwHome]: 'x' },
        variantsRedirect,
      ),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe('1 of 2 sampled product URL(s) answer HTTP 404 instead of 200');
  });

  it('warns when a host variant serves its own content or does not lead to the origin', async () => {
    const ownContent = await runCheck(
      productUrlsAnswerDirectly,
      targetFor({ products: [mug] }),
      redirectingFetcher(
        { [mug]: productHtml(), [httpHome]: 'x', [wwwHome]: '<html>www</html>' },
        { [httpHome]: variantsRedirect[httpHome] },
      ),
    );
    expect(ownContent.verdict).toBe('warn');
    expect(ownContent.message).toBe(
      'https://www.shop.example/ answers 200 with its own content instead of redirecting to https://shop.example, so the index holds duplicates',
    );
    expect(ownContent.evidence).toMatchObject({
      variants: { other_host: { status: 200, final_url: wwwHome, lands_on_origin: false } },
    });
    const elsewhere = await runCheck(
      productUrlsAnswerDirectly,
      targetFor({ products: [mug] }),
      redirectingFetcher(
        { [mug]: productHtml(), [httpHome]: { status: 404 }, [wwwHome]: 'x' },
        {
          [httpHome]: { finalUrl: 'https://parked.example/', redirects: 1 },
          [wwwHome]: variantsRedirect[wwwHome],
        },
      ),
    );
    expect(elsewhere.verdict).toBe('warn');
    expect(elsewhere.message).toBe(
      'http://shop.example/ answers HTTP 404 at https://parked.example/ instead of redirecting to https://shop.example',
    );
  });

  it('skips with reason error when no product URL answered at all', async () => {
    const outcome = await runCheck(
      productUrlsAnswerDirectly,
      targetFor({ products: [mug] }),
      redirectingFetcher(
        { [mug]: { status: 0 }, [httpHome]: 'x', [wwwHome]: 'x' },
        variantsRedirect,
      ),
    );
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('error');
  });
});

describe('A3.8 title and description present', () => {
  const page = (title: string | null, description: string | null = 'A fine piece of stoneware.') =>
    `<!doctype html><html><head>${title === null ? '' : `<title>${title}</title>`}${
      description === null ? '' : `<meta name="description" content="${description}">`
    }</head><body><main>x</main></body></html>`;
  const listing = 'https://shop.example/shop/';
  const home = 'https://shop.example/';

  it('passes when the home, listing and product pages all carry distinct titles and descriptions', async () => {
    const outcome = await runCheck(
      titleAndDescriptionPresent,
      targetFor({
        homeHtml: page('Example Ceramics – Stoneware from Berlin', 'Hand-thrown tableware.'),
        listing,
        products: [mug, bowl],
      }),
      mapFetcher({
        [listing]: page('Shop – Example Ceramics'),
        [mug]: page('Stoneware Mug – Example Ceramics'),
        [bowl]: page('  Serving   Bowl – Example Ceramics  '),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'all 4 sampled page(s) carry a distinct title and a meta description',
    );
    expect(outcome.evidence).toMatchObject({
      total: 4,
      untitled: 0,
      short_titles: 0,
      undescribed: 0,
      duplicates: [],
      pages: {
        [home]: {
          kind: 'home',
          title: 'Example Ceramics – Stoneware from Berlin',
          title_length: 40,
          description_present: true,
          description_length: 22,
        },
        [listing]: { kind: 'listing' },
        [bowl]: { kind: 'product', title: 'Serving   Bowl – Example Ceramics' },
      },
    });
  });

  it('judges the home page alone when nothing else was sampled', async () => {
    const outcome = await runCheck(
      titleAndDescriptionPresent,
      targetFor({ homeHtml: page('Example Ceramics', 'Tableware.') }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ total: 1, pages: { [home]: { kind: 'home' } } });
  });

  it('fails when any page has no title or an empty one', async () => {
    const missing = await runCheck(
      titleAndDescriptionPresent,
      targetFor({ homeHtml: page('Example Ceramics'), products: [mug] }),
      mapFetcher({ [mug]: page(null) }),
    );
    expect(missing.verdict).toBe('fail');
    expect(missing.message).toBe('1 of 2 sampled page(s) have no title element or an empty one');
    expect(missing.evidence).toMatchObject({
      untitled: 1,
      pages: { [mug]: { title: null, title_length: 0 } },
    });
    const empty = await runCheck(
      titleAndDescriptionPresent,
      targetFor({ homeHtml: page('   '), products: [mug] }),
      mapFetcher({ [mug]: page('Stoneware Mug') }),
    );
    expect(empty.verdict).toBe('fail');
    expect(empty.evidence).toMatchObject({ pages: { [home]: { title: null } } });
  });

  it('warns when two pages share a title, ignoring case and whitespace', async () => {
    const outcome = await runCheck(
      titleAndDescriptionPresent,
      targetFor({ homeHtml: page('Example Ceramics'), products: [mug, bowl] }),
      mapFetcher({ [mug]: page('Stoneware Mug – Shop'), [bowl]: page('stoneware  MUG – shop') }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      '1 title(s) are shared by several sampled pages, starting with "Stoneware Mug – Shop"',
    );
    expect(outcome.evidence).toMatchObject({ duplicates: ['Stoneware Mug – Shop'] });
  });

  it('warns on a title shorter than ten characters', async () => {
    const outcome = await runCheck(
      titleAndDescriptionPresent,
      targetFor({ homeHtml: page('Example Ceramics'), products: [mug] }),
      mapFetcher({ [mug]: page('Mug') }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe('1 of 2 sampled page(s) have a title shorter than 10 characters');
    expect(outcome.evidence).toMatchObject({
      short_titles: 1,
      pages: { [mug]: { title: 'Mug', title_length: 3 } },
    });
  });

  it('warns when a page has no meta description or an empty one', async () => {
    const outcome = await runCheck(
      titleAndDescriptionPresent,
      targetFor({ homeHtml: page('Example Ceramics', null), products: [mug] }),
      mapFetcher({ [mug]: page('Stoneware Mug – Shop', '  ') }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe('2 of 2 sampled page(s) have no meta description or an empty one');
    expect(outcome.evidence).toMatchObject({
      undescribed: 2,
      pages: {
        [home]: { description_present: false, description_length: 0 },
        [mug]: { description_present: false },
      },
    });
  });

  it('records but does not judge pages that did not answer 2xx', async () => {
    const outcome = await runCheck(
      titleAndDescriptionPresent,
      targetFor({ homeHtml: page('Example Ceramics'), listing, products: [mug, bowl] }),
      mapFetcher({
        [listing]: { status: 0 },
        [mug]: page('Stoneware Mug – Shop'),
        [bowl]: { status: 404, body: '<html><head></head><body>Not found</body></html>' },
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      total: 2,
      unavailable: { [listing]: 0, [bowl]: 404 },
    });
    expect(Object.keys(outcome.evidence.pages as object)).toEqual([home, mug]);
  });
});

describe('A3.9 conditional requests supported', () => {
  const html = productHtml();
  const withValidator = (
    headers: Record<string, string>,
    conditional: Record<string, string>,
    status = 304,
  ) => [
    { status: 200, headers: { 'content-type': 'text/html', ...headers }, body: html },
    { status, headers: {}, body: '', when: { headers: conditional } },
  ];

  it('passes when If-None-Match with the ETag is answered 304', async () => {
    const fetcher = mapFetcher({
      [mug]: withValidator({ ETag: '"abc123"' }, { 'if-none-match': '"abc123"' }),
    });
    const outcome = await runCheck(
      conditionalRequestsSupported,
      targetFor({ products: [mug] }),
      fetcher,
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'the product page answers 304 Not Modified to a conditional request with its ETag',
    );
    expect(outcome.evidence).toEqual({
      url: mug,
      etag: '"abc123"',
      last_modified: null,
      conditional_header_sent: 'if-none-match',
      conditional_status: 304,
    });
    expect(fetcher.log[1]?.options.headers).toEqual({ 'if-none-match': '"abc123"' });
    // The plain fetch and the conditional one: the only repeated URL in the scan.
    expect(fetcher.requestCount).toBe(2);
  });

  it('falls back to If-Modified-Since when only Last-Modified is sent', async () => {
    const stamp = 'Fri, 30 Oct 2026 09:00:00 GMT';
    const fetcher = mapFetcher({
      [mug]: withValidator({ 'Last-Modified': stamp }, { 'if-modified-since': stamp }),
    });
    const outcome = await runCheck(
      conditionalRequestsSupported,
      targetFor({ products: [mug] }),
      fetcher,
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(/with its Last-Modified$/);
    expect(outcome.evidence).toMatchObject({
      etag: null,
      last_modified: stamp,
      conditional_header_sent: 'if-modified-since',
    });
    expect(fetcher.log[1]?.options.headers).toEqual({ 'if-modified-since': stamp });
  });

  it('warns when the validator is ignored and the conditional request answers 200', async () => {
    const outcome = await runCheck(
      conditionalRequestsSupported,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: { status: 200, headers: { etag: 'W/"x"' }, body: html } }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      'the product page sends a ETag but answers 200 to a request that repeats it, so the validator is ignored',
    );
    expect(outcome.evidence).toMatchObject({ etag: 'W/"x"', conditional_status: 200 });
  });

  it('warns on any other status to the conditional request', async () => {
    const outcome = await runCheck(
      conditionalRequestsSupported,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withValidator({ etag: '"a"' }, { 'if-none-match': '"a"' }, 412) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/answers HTTP 412 instead of 304/);
  });

  it('warns when neither ETag nor Last-Modified is sent, without a second request', async () => {
    const fetcher = mapFetcher({ [mug]: html });
    const outcome = await runCheck(
      conditionalRequestsSupported,
      targetFor({ products: [mug] }),
      fetcher,
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      'the product page sends no ETag or Last-Modified header, so a crawler must download it again to see whether it changed',
    );
    expect(outcome.evidence).toMatchObject({
      etag: null,
      last_modified: null,
      conditional_header_sent: null,
      conditional_status: null,
    });
    expect(fetcher.requestCount).toBe(1);
  });

  it('judges the home page response when no product pages were sampled', async () => {
    const target = targetFor();
    target.home.headers.etag = '"home"';
    const outcome = await runCheck(
      conditionalRequestsSupported,
      target,
      mapFetcher({
        'https://shop.example/': { status: 304, when: { headers: { 'if-none-match': '"home"' } } },
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(/^the home page \(no product pages sampled\) answers 304/);
    expect(outcome.evidence).toMatchObject({ url: 'https://shop.example/', etag: '"home"' });
  });

  it('skips with reason error when the conditional request fails', async () => {
    const outcome = await runCheck(
      conditionalRequestsSupported,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withValidator({ etag: '"a"' }, { 'if-none-match': '"a"' }, 0) }),
    );
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('error');
    expect(outcome.evidence).toMatchObject({ conditional_status: 0 });
  });
});

describe('A3.10 mobile viewport declared', () => {
  const withViewport = (content: string | null) =>
    `<!doctype html><html><head><title>Mug</title>${
      content === null ? '' : `<meta name="viewport" content="${content}">`
    }</head><body><main>Mug</main></body></html>`;

  it('reads viewport properties tolerant of case, spaces and separators', () => {
    expect(readViewport('width=device-width, initial-scale=1')).toEqual({
      viewport: 'width=device-width, initial-scale=1',
      device_width: true,
      fixed_width: false,
      zoom_blocked: false,
    });
    expect(readViewport('Width = Device-Width ; initial-scale = 1.0')).toMatchObject({
      device_width: true,
    });
    expect(readViewport('width=1024')).toMatchObject({ device_width: false, fixed_width: true });
    expect(readViewport('width=device-width, user-scalable=no')).toMatchObject({
      zoom_blocked: true,
    });
    expect(readViewport('width=device-width, user-scalable=0')).toMatchObject({
      zoom_blocked: true,
    });
    expect(readViewport('width=device-width, maximum-scale=0.5')).toMatchObject({
      zoom_blocked: true,
    });
    expect(readViewport('width=device-width, maximum-scale=1')).toMatchObject({
      zoom_blocked: false,
    });
    expect(readViewport(null)).toEqual({
      viewport: null,
      device_width: false,
      fixed_width: false,
      zoom_blocked: false,
    });
  });

  it('passes when every sampled product page declares width=device-width', async () => {
    const outcome = await runCheck(
      mobileViewportDeclared,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withViewport('width=device-width, initial-scale=1'),
        [bowl]: withViewport('WIDTH=device-width; initial-scale=1; maximum-scale=5'),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('every sampled product page declares width=device-width');
    expect(outcome.evidence).toMatchObject({
      sampled: 'products',
      total: 2,
      missing: 0,
      fixed_width: 0,
      zoom_blocked: 0,
      pages: {
        [mug]: {
          viewport: 'width=device-width, initial-scale=1',
          device_width: true,
          fixed_width: false,
          zoom_blocked: false,
        },
      },
    });
  });

  it('falls back to the home page when no product pages were sampled', async () => {
    const outcome = await runCheck(
      mobileViewportDeclared,
      targetFor({ homeHtml: withViewport('width=device-width') }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'the home page (no product pages sampled) declares width=device-width',
    );
    const missing = await runCheck(
      mobileViewportDeclared,
      targetFor({ homeHtml: withViewport(null) }),
      mapFetcher({}),
    );
    expect(missing.verdict).toBe('warn');
    expect(missing.message).toBe(
      'the home page (no product pages sampled) declares no meta viewport',
    );
  });

  it('warns when a page lacks the viewport tag', async () => {
    const outcome = await runCheck(
      mobileViewportDeclared,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: withViewport('width=device-width'), [bowl]: withViewport(null) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe('1 of 2 sampled product page(s) declare no meta viewport');
    expect(outcome.evidence).toMatchObject({
      missing: 1,
      pages: { [bowl]: { viewport: null, device_width: false } },
    });
  });

  it('warns when a page declares a fixed pixel width', async () => {
    const outcome = await runCheck(
      mobileViewportDeclared,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withViewport('width=1024, initial-scale=1') }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      '1 of 1 sampled product page(s) declare a viewport without width=device-width',
    );
    expect(outcome.evidence).toMatchObject({
      fixed_width: 1,
      pages: { [mug]: { device_width: false, fixed_width: true } },
    });
  });

  it('warns when a page forbids zooming', async () => {
    const outcome = await runCheck(
      mobileViewportDeclared,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withViewport('width=device-width, initial-scale=1, user-scalable=no'),
        [bowl]: withViewport('width=device-width, maximum-scale=0.9'),
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      '2 of 2 sampled product page(s) declare a viewport that forbids zooming (user-scalable=no or maximum-scale below 1)',
    );
    expect(outcome.evidence).toMatchObject({
      zoom_blocked: 2,
      pages: { [mug]: { device_width: true, zoom_blocked: true }, [bowl]: { zoom_blocked: true } },
    });
  });
});
