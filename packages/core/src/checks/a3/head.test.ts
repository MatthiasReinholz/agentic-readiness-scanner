import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/check-harness.js';
import { documentHeadWellFormed } from './head.js';

const url = 'https://shop.example/product/mug/';
const bowl = 'https://shop.example/product/bowl/';
const good =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mug</title><link rel="canonical" href="https://shop.example/product/mug/"></head><body><main>Mug</main></body></html>';

describe('A3.11 document head is well-formed', () => {
  it('passes a clean document', async () => {
    const outcome = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: good }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pages: { [url]: { doctype: 'html', charset: 'meta', misplaced: [] } },
    });
  });

  it('fails when the title or canonical follow an element that ends the head, naming both and the culprit', async () => {
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><iframe src="/consent"></iframe><title>Mug</title><link rel="canonical" href="/mug/"></head><body></body></html>';
    const outcome = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: html }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      `on the sampled product page the <title> and rel=canonical sit after an <iframe> at byte ${html.indexOf('<iframe')} that ends the head, where crawlers do not read it`,
    );
    expect(outcome.evidence).toMatchObject({
      pages: {
        [url]: {
          invalid_head_element: `<iframe> at byte ${html.indexOf('<iframe')}`,
          misplaced: [
            `title after the invalid element at byte ${html.indexOf('<title>')}`,
            `canonical after the invalid element at byte ${html.indexOf('<link')}`,
          ],
        },
      },
    });
    const two = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url, bowl] }),
      mapFetcher({
        [url]:
          '<!doctype html><html><head><meta charset="utf-8"><div></div><title>Mug</title></head><body></body></html>',
        [bowl]:
          '<!doctype html><html><head><meta charset="utf-8"><div></div><title>Bowl</title></head><body></body></html>',
      }),
    );
    expect(two.verdict).toBe('fail');
    expect(two.message).toMatch(
      /^on 2 of 2 sampled product pages the <title> sits after a <div> at byte \d+ that ends the head/,
    );
  });

  it('names the home page and the body when the title sits there', async () => {
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><iframe src="/tag"></iframe></head><body><h1>Shop</h1><title>Shop</title><link rel="canonical" href="https://shop.example/"></body></html>';
    const outcome = await runCheck(
      documentHeadWellFormed,
      targetFor({ homeHtml: html }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      `the home page's <title> and rel=canonical sit in the body, after an <iframe> at byte ${html.indexOf('<iframe')}, where crawlers do not read it`,
    );
    const plain = await runCheck(
      documentHeadWellFormed,
      targetFor({
        homeHtml:
          '<!doctype html><html><head><meta charset="utf-8"></head><body><title>Shop</title></body></html>',
      }),
      mapFetcher({}),
    );
    expect(plain.message).toBe(
      "the home page's <title> sits in the body, where crawlers do not read it",
    );
  });

  it('does not mistake the title of an inline SVG icon for a misplaced document title', async () => {
    const icons =
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title><link rel="canonical" href="https://shop.example/"></head><body><a href="/"><svg viewBox="0 0 24 24" aria-hidden="true"><title>Home</title><path d="M0 0h24v24H0z"/></svg></a><button><svg><title>Cart</title></svg></button><math><title>x</title><mi>x</mi></math><main>Shop</main></body></html>';
    const home = await runCheck(
      documentHeadWellFormed,
      targetFor({ homeHtml: icons }),
      mapFetcher({}),
    );
    expect(home.verdict).toBe('pass');
    expect(home.evidence).toMatchObject({ pages: { 'https://shop.example/': { misplaced: [] } } });
    const product = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: icons }),
    );
    expect(product.verdict).toBe('pass');
    // A real document title in the body still fails, SVG icons or not.
    const misplaced = icons.replace('<main>Shop</main>', '<title>Shop</title><main>Shop</main>');
    const real = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: misplaced }),
    );
    expect(real.verdict).toBe('fail');
    expect(real.message).toBe(
      'on the sampled product page the <title> sits in the body, where crawlers do not read it',
    );
  });

  it('fails on a meta refresh redirect and warns on missing doctype or charset', async () => {
    const refresh = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({
        [url]:
          '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=/new/"></head></html>',
      }),
    );
    expect(refresh.verdict).toBe('fail');
    expect(refresh.message).toBe(
      'the sampled product page redirects with a meta refresh of 0 s; crawlers treat the page as a redirect, not as content',
    );
    const quirks = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: '<html><head><title>Mug</title></head><body></body></html>' }),
    );
    expect(quirks.verdict).toBe('warn');
    expect(quirks.message).toBe(
      'the sampled product page lacks the HTML doctype and the sampled product page declares no character encoding within the first 1024 bytes',
    );
    const several = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url, bowl] }),
      mapFetcher({
        [url]: '<html><head><meta charset="utf-8"><title>Mug</title></head><body></body></html>',
        [bowl]: '<html><head><meta charset="utf-8"><title>Bowl</title></head><body></body></html>',
      }),
    );
    expect(several.message).toBe('2 of 2 sampled product pages lack the HTML doctype');
    const homeQuirks = await runCheck(
      documentHeadWellFormed,
      targetFor({ homeHtml: '<html><head><title>Shop</title></head><body></body></html>' }),
      mapFetcher({}),
    );
    expect(homeQuirks.message).toBe(
      'the home page lacks the HTML doctype and the home page declares no character encoding within the first 1024 bytes',
    );
    const headerCharset = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({
        [url]: {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: '<!doctype html><html><head><title>Mug</title></head><body></body></html>',
        },
      }),
    );
    expect(headerCharset.verdict).toBe('pass');
  });

  it('judges the home page when no products were sampled and skips without a body', async () => {
    const home = await runCheck(
      documentHeadWellFormed,
      targetFor({ homeHtml: good }),
      mapFetcher({}),
    );
    expect(home.verdict).toBe('pass');
    expect(home.message).toBe(
      'the home page starts with the HTML doctype, declares its encoding and keeps title, canonical and directives inside a valid head',
    );
    expect(home.evidence).toMatchObject({ sampled: 'home' });
    const missing = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: { status: 404, body: '' } }),
    );
    expect(missing.verdict).toBe('skip');
    expect(missing.skipReason).toBe('error');
    expect(missing.message).toMatch(/no sampled product page could be fetched/);
    const empty = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: '   ' }),
    );
    expect(empty.verdict).toBe('skip');
    expect(empty.skipReason).toBe('not_applicable');
  });

  it('never scores a page that could not be fetched, and says that one was not', async () => {
    const outcome = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url, bowl] }),
      mapFetcher({ [url]: good, [bowl]: { status: 503, body: '<html>down</html>' } }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'the sampled product page starts with the HTML doctype, declares its encoding and keeps title, canonical and directives inside a valid head; 1 sampled product page could not be fetched (HTTP 503)',
    );
    expect(outcome.evidence).toMatchObject({
      total: 1,
      failed: { [bowl]: { status: 503, failure: 'HTTP 503' } },
    });
    expect(Object.keys(outcome.evidence.pages as object)).toEqual([url]);
  });
});
