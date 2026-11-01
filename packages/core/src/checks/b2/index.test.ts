import { describe, expect, it } from 'vitest';

import type { Fetcher, FetchOptions } from '../../http/types.js';
import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import {
  markupMatchesPage,
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

const SHOPIFY_OFFER = {
  price: '40.00',
  priceCurrency: 'USD',
  availability: 'https://schema.org/InStock',
};

/**
 * A ProductGroup modelled on Shopify's native product JSON-LD: offers, gtin13, mpn and sku
 * live on the hasVariant Products, the group carries only name, brand and image.
 */
function shopifyGroup(
  offers: Record<string, unknown>[] = [SHOPIFY_OFFER, SHOPIFY_OFFER],
  variantFields: Record<string, unknown>[] = [],
): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name: 'Vital Seamless Leggings',
    brand: { '@type': 'Brand', name: 'Example Athletics' },
    image: 'https://cdn.shopify.com/s/files/1/0001/products/leggings.jpg?v=1700000000',
    hasVariant: offers.map((offer, index) => ({
      '@type': 'Product',
      name: `Vital Seamless Leggings - Size ${index}`,
      sku: `VSL-${index}`,
      ...variantFields[index],
      offers: { '@type': 'Offer', url: `${mug}?variant=${index}`, ...offer },
    })),
  };
}

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
      '1 of 2 offer(s) on 2 product(s) carry price, currency and schema.org availability; missing: currency on 1, schema.org availability on 1',
    );
    expect(outcome.evidence).toMatchObject({
      products: 2,
      complete_products: 1,
      offers: 2,
      complete_offers: 1,
      missing: { price: 0, currency: 1, availability: 1 },
    });
  });

  it('reads the offers of a ProductGroup from its variants, the way Shopify emits them', async () => {
    const outcome = await runCheck(
      offerComplete,
      targetFor({ products: [mug], platform: 'shopify' }),
      mapFetcher({ [mug]: withJsonLd(shopifyGroup()) }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'all 2 offer(s) on 1 product(s) carry price, currency and schema.org availability (2 on variants)',
    );
    expect(outcome.evidence).toMatchObject({
      pages: {
        [mug]: {
          offers: 2,
          own_offers: 0,
          variant_offers: 2,
          complete_offers: 2,
          price: true,
          currency: true,
          availability: true,
        },
      },
    });
  });

  it('warns when some variant offers are incomplete and fails when none is', async () => {
    const some = await runCheck(
      offerComplete,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd(
          shopifyGroup([
            { price: '40.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
            { price: '40.00', priceCurrency: 'USD' },
          ]),
        ),
      }),
    );
    expect(some.verdict).toBe('warn');
    expect(some.message).toBe(
      '1 of 2 offer(s) on 1 product(s) carry price, currency and schema.org availability (2 on variants); missing: schema.org availability on 1',
    );
    const none = await runCheck(
      offerComplete,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withJsonLd(shopifyGroup([{ price: '40.00' }, { price: '42.00' }])) }),
    );
    expect(none.verdict).toBe('fail');
    expect(none.evidence).toMatchObject({ complete_offers: 0, offers: 2 });
  });

  it('never scores a page that could not be fetched and says so', async () => {
    const outcome = await runCheck(
      offerComplete,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: withJsonLd(product(COMPLETE)), [bowl]: { status: 503, body: '' } }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'all 1 offer(s) on 1 product(s) carry price, currency and schema.org availability; 1 of 2 sampled page(s) could not be fetched',
    );
    expect(outcome.evidence).toMatchObject({ unfetched: [bowl] });
    const allDown = await runCheck(
      offerComplete,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: { status: 0 } }),
    );
    expect(allDown).toMatchObject({ verdict: 'skip', skipReason: 'error' });
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
          signals: [
            'form.variations_form',
            'select[name^=attribute_]',
            'jsonld:ProductGroup.hasVariant',
          ],
          product_group: true,
          jsonld_variants: 2,
          store_api_variations: 0,
        },
      },
    });
  });

  it('treats a ProductGroup with hasVariant as a variable product even without a variation form', async () => {
    const outcome = await runCheck(
      variantsModeled,
      targetFor({ products: [mug], platform: 'shopify' }),
      mapFetcher({ [mug]: withJsonLd(shopifyGroup()) }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      modeled: 1,
      variable: 1,
      pages: {
        [mug]: {
          appears_variable: true,
          signals: ['jsonld:ProductGroup.hasVariant'],
          jsonld_variants: 2,
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

  it('reads shipping and return details from the variant offers of a ProductGroup', async () => {
    const outcome = await runCheck(
      shippingAndReturnsInMarkup,
      targetFor({ products: [mug], platform: 'shopify' }),
      mapFetcher({
        [mug]: withJsonLd(
          shopifyGroup([
            { ...SHOPIFY_OFFER, shippingDetails: SHIPPING, hasMerchantReturnPolicy: RETURNS },
            { ...SHOPIFY_OFFER, shippingDetails: SHIPPING, hasMerchantReturnPolicy: RETURNS },
          ]),
        ),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { offers: 2, shipping: true, returns: true } },
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

/** The fetcher as it answers when `url` gets no response: status 0 with the fetcher's own reason. */
function withTransportFailure(inner: Fetcher, url: string, error: string): Fetcher {
  return {
    get requestCount() {
      return inner.requestCount;
    },
    budget: inner.budget,
    fetch: async (target: string, options?: FetchOptions) => {
      const response = await inner.fetch(target, options);
      return target === url ? { ...response, status: 0, body: '', error } : response;
    },
  };
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
    expect(outcome.message).toBe(
      `1 of 1 product image(s) need attention: ${IMAGE}: no alt text on the rendered img`,
    );
    expect(outcome.evidence).toMatchObject({
      warn: 1,
      pages: { [mug]: { alt: '', issues: ['no alt text on the rendered img'] } },
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
    expect(noTag.message).toBe(
      `1 of 1 product image(s) need attention: ${IMAGE}: not rendered as an img on the page`,
    );
    expect(noTag.evidence).toMatchObject({
      pages: { [mug]: { alt: null, issues: ['not rendered as an img on the page'] } },
    });
  });

  it('matches the image Shopify renders at another size, through srcset and picture sources', async () => {
    const cdn = 'https://cdn.shopify.com/s/files/1/0001/products/leggings.jpg';
    const node = { ...(product(COMPLETE) as object), image: `${cdn}?v=1700000000` };
    const sized = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd(
          node,
          `<img src="${cdn}?v=1700000000&width=1080" alt="Vital Seamless Leggings" width="1080" height="1350" srcset="${cdn}?v=1700000000&width=352 352w, ${cdn}?v=1700000000&width=1080 1080w">`,
        ),
      }),
    );
    expect(sized.verdict).toBe('pass');
    expect(sized.evidence).toMatchObject({
      pages: { [mug]: { alt: 'Vital Seamless Leggings', longest_side: 1350 } },
    });
    const suffixed = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd(
          node,
          `<picture><source srcset="//cdn.shopify.com/s/files/1/0001/products/leggings_1080x.jpg 1x, //cdn.shopify.com/s/files/1/0001/products/leggings_1080x@2x.jpg 2x"><img data-src="//cdn.shopify.com/s/files/1/0001/products/leggings_600x.jpg" alt="Leggings" width="600" height="750"></picture>`,
        ),
      }),
    );
    expect(suffixed.verdict).toBe('warn');
    expect(suffixed.evidence).toMatchObject({
      pages: { [mug]: { alt: 'Leggings', issues: ['longest side is 750 px, below 800 px'] } },
    });
  });

  it('prefers a matching img with alt text and ignores one-pixel and aria-hidden helpers', async () => {
    const outcome = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd(
          { ...(product(COMPLETE) as object), image: IMAGE },
          `<img src="${IMAGE}" width="1" height="1" alt="">
           <img src="${IMAGE}" aria-hidden="true" width="1200" height="1200" alt="">
           <img src="${IMAGE}" width="1200" height="1200" alt="">
           <img src="${IMAGE}" width="1200" height="1200" alt="Blue mug">`,
        ),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ pages: { [mug]: { alt: 'Blue mug' } } });
    const onlyHelpers = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: withJsonLd(
          { ...(product(COMPLETE) as object), image: IMAGE },
          `<img src="${IMAGE}" width="1" height="1" alt="Blue mug">`,
        ),
        [IMAGE]: { status: 200 },
      }),
    );
    expect(onlyHelpers.verdict).toBe('warn');
    expect(onlyHelpers.evidence).toMatchObject({
      pages: { [mug]: { issues: ['not rendered as an img on the page'] } },
    });
  });

  it('treats a HEAD that gets no response as inconclusive, never as a missing image', async () => {
    const page = withJsonLd(
      { ...(product(COMPLETE) as object), image: IMAGE },
      imgTag('alt="Mug"'),
    );
    const alone = await runCheck(
      productImageUsable,
      targetFor({ products: [mug] }),
      withTransportFailure(mapFetcher({ [mug]: page }), IMAGE, 'connection reset'),
    );
    expect(alone).toMatchObject({ verdict: 'skip', skipReason: 'error' });
    expect(alone.message).toBe(
      `no product image could be checked: ${IMAGE}: could not be checked (connection reset)`,
    );
    expect(alone.evidence).toMatchObject({
      inconclusive: 1,
      pages: {
        [mug]: {
          head_status: 0,
          head_error: 'connection reset',
          verdict: 'inconclusive',
          issues: ['could not be checked (connection reset)'],
        },
      },
    });
    const mixed = await runCheck(
      productImageUsable,
      targetFor({ products: [mug, bowl] }),
      withTransportFailure(
        mapFetcher({
          [mug]: page,
          [bowl]: withJsonLd(
            { ...(product(COMPLETE) as object), image: IMAGE },
            imgTag('alt="Mug" width="1000" height="1000"'),
          ),
        }),
        IMAGE,
        'connection reset',
      ),
    );
    expect(mixed.verdict).toBe('pass');
    expect(mixed.message).toBe(
      'all 1 product image(s) resolve with alt text; 1 could not be checked',
    );
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
    expect(broken.message).toBe(
      `1 of 1 product image(s) unusable: ${IMAGE}: did not resolve (HTTP 404)`,
    );
    expect(broken.evidence).toMatchObject({
      pages: { [mug]: { head_status: 404, issues: ['did not resolve (HTTP 404)'] } },
    });
    expect(headRequests(fetcher)).toEqual([IMAGE]);
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
    expect(outcome.message).toBe('price matches on 1 product page(s); availability matches on 1');
    expect(outcome.evidence).toMatchObject({
      compared: 1,
      price_contradictions: [],
      price_not_found: [],
      availability_compared: 1,
      availability_mismatches: [],
      pages: {
        [mug]: {
          markup_prices: [24],
          visible_prices: [24],
          visible_price_count: 1,
          price_element_prices: [24],
          matched_price: 24,
          price_visible: true,
          price_status: 'visible',
          availability: ['InStock'],
          add_to_cart: true,
          out_of_stock_text: false,
          availability_match: true,
        },
      },
    });
  });

  it('fails when the price block shows another amount than the JSON-LD price', async () => {
    const outcome = await run({
      [mug]: pageWith(product(COMPLETE), `<p class="price">€24.00</p>${ADD_TO_CART}`),
      [bowl]: pageWith(
        product({ ...COMPLETE, price: '48.00' }),
        `<p class="price">€39.00</p>${ADD_TO_CART}`,
      ),
    });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      `the visible price contradicts the JSON-LD price on 1 of 2 product page(s): ${bowl} shows 39 while the markup says 48`,
    );
    expect(outcome.evidence).toMatchObject({
      price_contradictions: [bowl],
      pages: {
        [bowl]: {
          markup_prices: [48],
          visible_prices: [39],
          price_element_prices: [39],
          price_visible: false,
          price_status: 'contradicted',
        },
      },
    });
  });

  it('warns, not fails, when the JSON-LD price is simply not found in readable page text', async () => {
    // No price block the scanner can read: the amount is rendered by script or with an
    // unknown currency marker. Nothing contradicts the markup, so nothing is proven wrong.
    const outcome = await run({
      [mug]: pageWith(product(COMPLETE), `<p class="price"></p>${ADD_TO_CART}`),
      [bowl]: pageWith(product(COMPLETE), `<p class="price">€24.00</p>${ADD_TO_CART}`),
    });
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      'the JSON-LD price is not among the prices visible on 1 of 2 product page(s) (no readable price block contradicts it either); price matches on 1',
    );
    expect(outcome.evidence).toMatchObject({
      price_not_found: [mug],
      pages: { [mug]: { price_status: 'not_found', visible_price_count: 0 } },
    });
  });

  it('records the matched price even when site chrome lists ten other prices first', async () => {
    const chrome = Array.from(
      { length: 12 },
      (_, i) => `<a class="promo">Free gift over €${100 + i}</a>`,
    ).join('');
    const outcome = await run({
      [mug]: pageWith(product(COMPLETE), `${chrome}<p class="price">€24.00</p>${ADD_TO_CART}`),
    });
    expect(outcome.verdict).toBe('pass');
    const page = (outcome.evidence.pages as Record<string, { visible_prices: number[] }>)[mug];
    expect(page?.visible_prices).toHaveLength(11);
    expect(page?.visible_prices.at(-1)).toBe(24);
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { visible_price_count: 13, matched_price: 24 } },
    });
  });

  it('reads prices written with kr, zł or ₹ markers', async () => {
    const outcome = await run({
      [mug]: pageWith(
        product({ ...COMPLETE, price: '299', priceCurrency: 'SEK' }),
        `<p class="price">299 kr</p>${ADD_TO_CART}`,
      ),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ pages: { [mug]: { matched_price: 299 } } });
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

  it('says when availability could not be compared instead of claiming it matched', async () => {
    const outcome = await run({
      [mug]: pageWith(product(COMPLETE), '<p class="price">€24.00</p>'),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'price matches on 1 product page(s); availability could not be compared on 1',
    );
    expect(outcome.evidence).toMatchObject({
      availability_compared: 0,
      pages: { [mug]: { availability_match: null } },
    });
    const mixed = await run({
      [mug]: pageWith(product(COMPLETE), '<p class="price">€24.00</p>'),
      [bowl]: pageWith(product(COMPLETE), `<p class="price">€24.00</p>${ADD_TO_CART}`),
    });
    expect(mixed.message).toBe(
      'price matches on 2 product page(s); availability matches on 1 and could not be compared on 1',
    );
  });

  it('compares the variant offers of a Shopify ProductGroup against the page', async () => {
    const outcome = await run({
      [mug]: pageWith(
        shopifyGroup(),
        `<span class="price-item price-item--regular">$40.00</span><button name="add" class="product-form__submit">Add to cart</button>`,
      ),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { markup_prices: [40], matched_price: 40, availability_match: true } },
    });
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
