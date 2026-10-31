import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { FetchOptions, Fetcher } from '../../http/types.js';
import { resolveTarget } from '../../target/resolver.js';
import { fixtureFetcher, mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import {
  accessibleMainContent,
  canonicalAndHreflang,
  pageWeightAndResponseTime,
  serverRenderedProductContent,
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
});
