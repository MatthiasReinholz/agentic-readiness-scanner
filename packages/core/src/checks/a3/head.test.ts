import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/check-harness.js';
import { documentHeadWellFormed } from './head.js';

const url = 'https://shop.example/product/mug/';
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

  it('fails when the title or canonical follow an element that ends the head', async () => {
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><iframe src="/consent"></iframe><title>Mug</title><link rel="canonical" href="/mug/"></head><body></body></html>';
    const outcome = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: html }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/title, canonical sit where crawlers do not read them/);
    expect(outcome.message).toMatch(/<iframe> at byte/);
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
    expect(refresh.message).toMatch(/meta refresh of 0 s/);
    const quirks = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: '<html><head><title>Mug</title></head><body></body></html>' }),
    );
    expect(quirks.verdict).toBe('warn');
    expect(quirks.message).toMatch(/1 lack the HTML doctype and 1 declare no character encoding/);
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
    expect(home.evidence).toMatchObject({ sampled: 'home' });
    const missing = await runCheck(
      documentHeadWellFormed,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: { status: 404, body: '' } }),
    );
    expect(missing.verdict).toBe('skip');
  });
});
