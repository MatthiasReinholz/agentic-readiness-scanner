import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import {
  offerComplete,
  productImageUsable,
  productJsonLd,
  shippingAndReturnsInMarkup,
  variantsModeled,
} from './index.js';

const mug = 'https://shop.example/product/mug/';
const bowl = 'https://shop.example/product/bowl/';
const STORE_API = 'https://shop.example/wp-json/wc/store/v1/products?per_page=20';

function withJsonLd(node: unknown, body = ''): string {
  return `<!doctype html><html><head><title>P</title><script type="application/ld+json">${JSON.stringify(node)}</script></head><body>${body}</body></html>`;
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

const VARIATIONS_FORM =
  '<form class="variations_form cart"><select name="attribute_pa_size"><option value="s">S</option></select></form>';

function productGroup(variants: number): unknown {
  return {
    '@type': 'ProductGroup',
    name: 'Mugs',
    hasVariant: Array.from({ length: variants }, (_, i) => ({
      '@type': 'Product',
      name: `Mug ${i}`,
      sku: `MUG-${i}`,
    })),
  };
}

function storeApi(products: Record<string, unknown>[]): string {
  return JSON.stringify(
    products.map((product, i) => ({ id: i + 1, name: `P${i}`, sku: `P-${i}`, ...product })),
  );
}

describe('B2.3 variants modeled', () => {
  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(variantsModeled, targetFor(), mapFetcher({}));
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });

  it('does not apply when no sampled product appears variable', async () => {
    const outcome = await runCheck(
      variantsModeled,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withJsonLd(product(COMPLETE), '<form class="cart"></form>') }),
    );
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { appears_variable: false, signals: [] } },
    });
  });

  it('passes when the variations form is backed by a ProductGroup with hasVariant', async () => {
    const outcome = await runCheck(
      variantsModeled,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withJsonLd(productGroup(2), VARIATIONS_FORM) }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      modeled: 1,
      variable: 1,
      pages: {
        [mug]: {
          appears_variable: true,
          signals: ['form.variations_form', 'select[name^=attribute_]'],
          product_group: true,
          jsonld_variants: 2,
          store_api_variations: 0,
        },
      },
    });
  });

  it('passes when the Store API marks the product variable and lists its variations', async () => {
    const outcome = await runCheck(
      variantsModeled,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd(product(COMPLETE)),
        [STORE_API]: storeApi([
          { permalink: mug, type: 'variable', variations: [{ id: 11 }, { id: 12 }] },
        ]),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pages: {
        [mug]: {
          signals: ['store-api:type=variable'],
          product_group: false,
          store_api_variations: 2,
        },
      },
    });
  });

  it('warns when only some variable products are modeled', async () => {
    const outcome = await runCheck(
      variantsModeled,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withJsonLd(productGroup(1), VARIATIONS_FORM),
        [bowl]: withJsonLd(product(COMPLETE), '<div data-product_variations="[]"></div>'),
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({
      modeled: 1,
      variable: 2,
      pages: { [bowl]: { signals: ['data-product_variations'], jsonld_variants: 0 } },
    });
  });

  it('fails when a variable product is a plain Product with no variants anywhere', async () => {
    const outcome = await runCheck(
      variantsModeled,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd(product(COMPLETE), VARIATIONS_FORM),
        [STORE_API]: storeApi([{ permalink: mug, type: 'variable', variations: [] }]),
      }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toMatchObject({ modeled: 0, variable: 1 });
    // A ProductGroup without Product variants does not count as modeled either.
    const emptyGroup = await runCheck(
      variantsModeled,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withJsonLd(productGroup(0), VARIATIONS_FORM) }),
    );
    expect(emptyGroup.verdict).toBe('fail');
    expect(emptyGroup.evidence).toMatchObject({
      pages: { [mug]: { product_group: true, jsonld_variants: 0 } },
    });
  });
});

const SHIPPING = {
  '@type': 'OfferShippingDetails',
  shippingRate: { '@type': 'MonetaryAmount', value: '4.90', currency: 'EUR' },
};
const RETURNS = { '@type': 'MerchantReturnPolicy', merchantReturnDays: 30 };

describe('B2.4 shipping and return details in markup', () => {
  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(shippingAndReturnsInMarkup, targetFor(), mapFetcher({}));
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });

  it('defers to B2.1 without Product JSON-LD and to B2.2 without an Offer', async () => {
    const noProduct = await runCheck(
      shippingAndReturnsInMarkup,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: PLAIN }),
    );
    expect(noProduct).toMatchObject({ verdict: 'skip', skipReason: 'dependency_failed' });
    const noOffer = await runCheck(
      shippingAndReturnsInMarkup,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withJsonLd(product(undefined)) }),
    );
    expect(noOffer).toMatchObject({ verdict: 'skip', skipReason: 'dependency_failed' });
    expect(noOffer.evidence).toMatchObject({ pages: { [mug]: { offers: 0 } } });
  });

  it('passes when every offer carries typed shipping details and a return policy', async () => {
    const outcome = await runCheck(
      shippingAndReturnsInMarkup,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withJsonLd(
          product({ ...COMPLETE, shippingDetails: SHIPPING, hasMerchantReturnPolicy: RETURNS }),
        ),
        // Both properties are also accepted on the Product itself.
        [bowl]: withJsonLd({
          ...(product({ ...COMPLETE, shippingDetails: [SHIPPING] }) as object),
          hasMerchantReturnPolicy: RETURNS,
        }),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      complete: 2,
      total: 2,
      pages: { [mug]: { offers: 1, shipping: true, returns: true } },
    });
  });

  it('warns when only one of the two is present', async () => {
    const outcome = await runCheck(
      shippingAndReturnsInMarkup,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withJsonLd(product({ ...COMPLETE, shippingDetails: SHIPPING })) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({
      complete: 0,
      partial: 1,
      pages: { [mug]: { shipping: true, returns: false } },
    });
  });

  it('fails when neither is present or the values are not of the expected type', async () => {
    const outcome = await runCheck(
      shippingAndReturnsInMarkup,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd(
          product({
            ...COMPLETE,
            shippingDetails: { shippingRate: '4.90' },
            hasMerchantReturnPolicy: 'https://shop.example/returns/',
          }),
        ),
      }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { shipping: false, returns: false } },
    });
  });
});

const IMAGE = 'https://shop.example/wp-content/uploads/mug.jpg';

function imgTag(attributes: string): string {
  return `<div class="woocommerce-product-gallery"><img src="${IMAGE}" ${attributes}></div>`;
}

function headRequests(fetcher: ReturnType<typeof mapFetcher>): string[] {
  return fetcher.log.filter((entry) => entry.options.method === 'HEAD').map((entry) => entry.url);
}

describe('B2.5 images with alt text and resolution', () => {
  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(productImageUsable, targetFor(), mapFetcher({}));
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });

  it('defers to B2.1 when no page carries Product JSON-LD', async () => {
    const outcome = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: PLAIN }),
    );
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'dependency_failed' });
  });

  it('passes on alt text plus width and height attributes without a HEAD request', async () => {
    const fetcher = mapFetcher({
      [mug]: withJsonLd(
        { ...(product(COMPLETE) as object), image: IMAGE },
        imgTag('alt="Blue mug" width="1200" height="900"'),
      ),
    });
    const outcome = await runCheck(productImageUsable, targetFor({ products: [mug] }), fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pass: 1,
      total: 1,
      pages: {
        [mug]: {
          image_url: IMAGE,
          alt: 'Blue mug',
          width: 1200,
          height: 900,
          longest_side: 1200,
          size_source: 'html',
          head_status: null,
          issues: [],
        },
      },
    });
    expect(headRequests(fetcher)).toEqual([]);
  });

  it('passes on an unknown size when one HEAD request confirms the image resolves', async () => {
    const fetcher = mapFetcher({
      [mug]: withJsonLd(
        { ...(product(COMPLETE) as object), image: [IMAGE, 'https://shop.example/other.jpg'] },
        imgTag('alt="Blue mug"'),
      ),
      [IMAGE]: { status: 200, headers: { 'content-type': 'image/jpeg' } },
    });
    const outcome = await runCheck(productImageUsable, targetFor({ products: [mug] }), fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { longest_side: null, size_source: null, head_status: 200, issues: [] } },
    });
    expect(headRequests(fetcher)).toEqual([IMAGE]);
  });

  it('reads the size from an ImageObject and matches a relative img src', async () => {
    const fetcher = mapFetcher({
      [mug]: withJsonLd(
        {
          ...(product(COMPLETE) as object),
          image: { '@type': 'ImageObject', contentUrl: IMAGE, width: '1600', height: '1600' },
        },
        `<img class="attachment-shop_single wp-post-image" src="/wp-content/uploads/mug.jpg" alt="Mug">`,
      ),
    });
    const outcome = await runCheck(productImageUsable, targetFor({ products: [mug] }), fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { alt: 'Mug', longest_side: 1600, size_source: 'jsonld' } },
    });
    expect(headRequests(fetcher)).toEqual([]);
  });

  it('warns when the rendered img has no alt text', async () => {
    const outcome = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd(
          { ...(product(COMPLETE) as object), image: IMAGE },
          imgTag('alt="" width="1000" height="1000"'),
        ),
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({
      warn: 1,
      pages: { [mug]: { alt: '', issues: ['rendered img has no alt text'] } },
    });
    const noTag = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd({ ...(product(COMPLETE) as object), image: IMAGE }),
        [IMAGE]: { status: 200 },
      }),
    );
    expect(noTag.verdict).toBe('warn');
    expect(noTag.evidence).toMatchObject({
      pages: { [mug]: { alt: null, issues: ['no rendered img matches the Product image'] } },
    });
  });

  it('warns when the known size is below 800 px on the longest side', async () => {
    const outcome = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd(
          { ...(product(COMPLETE) as object), image: IMAGE },
          imgTag('alt="Blue mug" width="600" height="400"'),
        ),
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({
      pages: {
        [mug]: { longest_side: 600, issues: ['longest side is 600 px, below 800 px'] },
      },
    });
    // WooCommerce's data-large_image_width describes the full-size image behind the thumbnail.
    const large = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd(
          { ...(product(COMPLETE) as object), image: IMAGE },
          imgTag(
            'alt="Blue mug" width="600" height="600" data-large_image_width="1200" data-large_image_height="1200"',
          ),
        ),
      }),
    );
    expect(large.verdict).toBe('pass');
    expect(large.evidence).toMatchObject({ pages: { [mug]: { longest_side: 1200 } } });
  });

  it('fails when the Product has no image, a non-http image, or one that does not resolve', async () => {
    const none = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withJsonLd(product(COMPLETE), imgTag('alt="Mug"')) }),
    );
    expect(none.verdict).toBe('fail');
    expect(none.evidence).toMatchObject({
      fail: 1,
      pages: { [mug]: { image_url: null, issues: ['Product has no image'] } },
    });
    const relative = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd({ ...(product(COMPLETE) as object), image: '/uploads/mug.jpg' }),
      }),
    );
    expect(relative.verdict).toBe('fail');
    expect(relative.evidence).toMatchObject({
      pages: {
        [mug]: {
          image_url: '/uploads/mug.jpg',
          issues: ['Product image is not an absolute http(s) URL'],
        },
      },
    });
    const fetcher = mapFetcher({
      [mug]: withJsonLd({ ...(product(COMPLETE) as object), image: IMAGE }, imgTag('alt="Mug"')),
    });
    const broken = await runCheck(productImageUsable, targetFor({ products: [mug] }), fetcher);
    expect(broken.verdict).toBe('fail');
    expect(broken.evidence).toMatchObject({
      pages: { [mug]: { head_status: 404, issues: ['image does not resolve (HEAD 404)'] } },
    });
    expect(headRequests(fetcher)).toEqual([IMAGE]);
  });
});
