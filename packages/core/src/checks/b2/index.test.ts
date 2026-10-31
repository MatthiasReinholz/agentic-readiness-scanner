import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import { markupMatchesPage, offerComplete, productJsonLd } from './index.js';

const mug = 'https://shop.example/product/mug/';
const bowl = 'https://shop.example/product/bowl/';

function withJsonLd(node: unknown): string {
  return `<!doctype html><html><head><title>P</title><script type="application/ld+json">${JSON.stringify(node)}</script></head><body></body></html>`;
}

const PLAIN = '<!doctype html><html><head><title>P</title></head><body>No markup</body></html>';

function product(offer: Record<string, unknown> | undefined): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Mug',
    ...(offer ? { offers: { '@type': 'Offer', ...offer } } : {}),
  };
}

const COMPLETE = {
  price: '24.00',
  priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
};

describe('B2.1 Product JSON-LD on product pages', () => {
  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(productJsonLd, targetFor(), mapFetcher({}));
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });

  it('passes, warns and fails by the share of pages with a Product node', async () => {
    const all = await runCheck(
      productJsonLd,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: withJsonLd(product(COMPLETE)), [bowl]: withJsonLd(product(COMPLETE)) }),
    );
    expect(all.verdict).toBe('pass');
    expect(all.evidence).toMatchObject({ with_product: 2, total: 2 });
    const some = await runCheck(
      productJsonLd,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: withJsonLd(product(COMPLETE)), [bowl]: PLAIN }),
    );
    expect(some.verdict).toBe('warn');
    expect(some.evidence).toMatchObject({
      pages: { [bowl]: { product_nodes: 0, types: [], parse_errors: [] } },
    });
    const none = await runCheck(
      productJsonLd,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: PLAIN }),
    );
    expect(none.verdict).toBe('fail');
  });

  it('records parse errors as evidence instead of throwing', async () => {
    const broken = `<!doctype html><html><head><script type="application/ld+json">{not json</script></head><body></body></html>`;
    const outcome = await runCheck(
      productJsonLd,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: broken }),
    );
    expect(outcome.verdict).toBe('fail');
    const pages = outcome.evidence.pages as Record<string, { parse_errors: string[] }>;
    expect(pages[mug]?.parse_errors).toHaveLength(1);
  });
});

describe('B2.2 offers carry price, currency and availability', () => {
  it('does not apply without product pages, and defers to B2.1 when no page has Product JSON-LD', async () => {
    const noPages = await runCheck(offerComplete, targetFor(), mapFetcher({}));
    expect(noPages).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
    const noProducts = await runCheck(
      offerComplete,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: PLAIN }),
    );
    expect(noProducts).toMatchObject({ verdict: 'skip', skipReason: 'dependency_failed' });
  });

  it('passes on a complete offer and fails on a missing offer or field', async () => {
    const complete = await runCheck(
      offerComplete,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withJsonLd(product(COMPLETE)) }),
    );
    expect(complete.verdict).toBe('pass');
    expect(complete.evidence).toMatchObject({
      pages: { [mug]: { offers: 1, price: true, currency: true, availability: true } },
    });
    const noOffer = await runCheck(
      offerComplete,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withJsonLd(product(undefined)) }),
    );
    expect(noOffer.verdict).toBe('fail');
    expect(noOffer.evidence).toMatchObject({ pages: { [mug]: { offers: 0, price: false } } });
    const badAvailability = await runCheck(
      offerComplete,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withJsonLd(product({ ...COMPLETE, availability: 'in stock' })) }),
    );
    expect(badAvailability.verdict).toBe('fail');
    expect(badAvailability.evidence).toMatchObject({ pages: { [mug]: { availability: false } } });
  });

  it('warns when only some products are complete and counts only pages with Product nodes', async () => {
    const outcome = await runCheck(
      offerComplete,
      targetFor({ products: [mug, bowl, 'https://shop.example/product/plate/'] }),
      mapFetcher({
        [mug]: withJsonLd(product(COMPLETE)),
        [bowl]: withJsonLd(product({ price: '9.00' })),
        'https://shop.example/product/plate/': PLAIN,
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      '1 of 2 product(s) have an Offer with price, currency and schema.org availability',
    );
    expect(outcome.evidence).toMatchObject({ complete: 1, total: 2 });
  });

  it('accepts an AggregateOffer with lowPrice', async () => {
    const node = {
      '@type': 'ProductGroup',
      name: 'Mugs',
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: '19.00',
        priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock',
      },
    };
    const outcome = await runCheck(
      offerComplete,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withJsonLd(node) }),
    );
    expect(outcome.verdict).toBe('pass');
  });
});

describe('B2.6 markup matches the visible page', () => {
  const ADD_TO_CART =
    '<form class="cart"><button type="submit" class="single_add_to_cart_button">Add to cart</button></form>';
  const OUT_OF_STOCK = '<p class="stock out-of-stock">Out of stock</p>';
  function pageWith(node: unknown, body: string): string {
    return `<!doctype html><html><head><title>P</title><script type="application/ld+json">${JSON.stringify(node)}</script></head><body><main><h1>Mug</h1>${body}</main></body></html>`;
  }
  const run = (pages: Record<string, string>) =>
    runCheck(markupMatchesPage, targetFor({ products: Object.keys(pages) }), mapFetcher(pages));

  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(markupMatchesPage, targetFor(), mapFetcher({}));
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });

  it('defers to B2.2 when no page has an Offer with a price', async () => {
    const outcome = await run({
      [mug]: pageWith(product(undefined), '€24.00'),
      [bowl]: PLAIN,
    });
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'dependency_failed' });
  });

  it('passes when the JSON-LD price is visible and the add-to-cart state agrees', async () => {
    const outcome = await run({
      [mug]: pageWith(product(COMPLETE), `<p class="price">€24.00</p>${ADD_TO_CART}`),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      compared: 1,
      price_mismatches: [],
      availability_mismatches: [],
      pages: {
        [mug]: {
          markup_prices: [24],
          visible_prices: [24],
          price_visible: true,
          availability: ['InStock'],
          add_to_cart: true,
          out_of_stock_text: false,
          availability_match: true,
        },
      },
    });
  });

  it('fails when the JSON-LD price is not visible on a page', async () => {
    const outcome = await run({
      [mug]: pageWith(product(COMPLETE), `<p class="price">€24.00</p>${ADD_TO_CART}`),
      [bowl]: pageWith(
        product({ ...COMPLETE, price: '48.00' }),
        `<p class="price">€39.00</p>${ADD_TO_CART}`,
      ),
    });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('JSON-LD price is not visible on 1 of 2 product page(s)');
    expect(outcome.evidence).toMatchObject({
      price_mismatches: [bowl],
      pages: { [bowl]: { markup_prices: [48], visible_prices: [39], price_visible: false } },
    });
  });

  it('warns when availability contradicts the add-to-cart state', async () => {
    const claimedInStock = await run({
      [mug]: pageWith(product(COMPLETE), `<p class="price">€24.00</p>${OUT_OF_STOCK}`),
    });
    expect(claimedInStock.verdict).toBe('warn');
    expect(claimedInStock.evidence).toMatchObject({
      availability_mismatches: [mug],
      pages: { [mug]: { add_to_cart: false, out_of_stock_text: true, availability_match: false } },
    });
    const claimedOut = await run({
      [mug]: pageWith(
        product({ ...COMPLETE, availability: 'https://schema.org/OutOfStock' }),
        `<p class="price">€24.00</p>${ADD_TO_CART}`,
      ),
    });
    expect(claimedOut.verdict).toBe('warn');
    expect(claimedOut.evidence).toMatchObject({
      pages: {
        [mug]: { availability: ['OutOfStock'], add_to_cart: true, availability_match: false },
      },
    });
  });

  it('leaves availability unjudged when the page shows neither a control nor wording', async () => {
    const outcome = await run({
      [mug]: pageWith(product(COMPLETE), '<p class="price">€24.00</p>'),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ pages: { [mug]: { availability_match: null } } });
  });

  it('compares every variant offer of a ProductGroup and passes when one price is visible', async () => {
    const group = {
      '@context': 'https://schema.org',
      '@type': 'ProductGroup',
      name: 'Mugs',
      hasVariant: [
        {
          '@type': 'Product',
          name: 'Small',
          offers: { '@type': 'Offer', ...COMPLETE, price: '19.00' },
        },
        {
          '@type': 'Product',
          name: 'Large',
          offers: { '@type': 'Offer', ...COMPLETE, price: '29.00' },
        },
      ],
    };
    const outcome = await run({
      [mug]: pageWith(group, `<p class="price">€29.00</p>${ADD_TO_CART}`),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { markup_prices: [19, 29], visible_prices: [29], price_visible: true } },
    });
  });

  it('matches an AggregateOffer range and European number formatting', async () => {
    const node = product({
      '@type': 'AggregateOffer',
      lowPrice: '1234.50',
      highPrice: '2000',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    });
    const outcome = await run({
      [mug]: pageWith(node, `<p class="price">ab 1.234,50 €</p>${ADD_TO_CART}`),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { markup_prices: [1234.5, 2000], visible_prices: [1234.5] } },
    });
  });
});
