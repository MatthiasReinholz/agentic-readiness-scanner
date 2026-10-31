import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import { offerComplete, productJsonLd } from './index.js';

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
