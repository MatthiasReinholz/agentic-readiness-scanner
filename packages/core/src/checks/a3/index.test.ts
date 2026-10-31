import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import { serverRenderedProductContent } from './index.js';

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
