import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor, type MapResponse } from '../../testing/index.js';
import {
  brandEntity,
  gtinPresent,
  gtinValid,
  mpnWhenGtinAbsent,
  skuPresentAndUnique,
} from './index.js';

const STORE_API = 'https://shop.example/wp-json/wc/store/v1/products?per_page=20';
const VALID_GTIN = '4006381333931';

function productPage(gtin?: string): string {
  return withProduct(gtin ? { gtin13: gtin } : {});
}

/** A product page whose Product node carries the given extra fields. */
function withProduct(fields: Record<string, unknown>): string {
  const node = { '@type': 'Product', name: 'P', ...fields };
  return `<!doctype html><html><head><title>P</title><script type="application/ld+json">${JSON.stringify(node)}</script></head><body></body></html>`;
}

const PLAIN = '<!doctype html><html><head><title>P</title></head><body>No markup</body></html>';

/** n product pages, the first `withGtin` of them carrying a GTIN in JSON-LD. */
function sampled(
  n: number,
  withGtin: number,
): { products: string[]; record: Record<string, MapResponse> } {
  const products = Array.from({ length: n }, (_, i) => `https://shop.example/product/p${i}/`);
  const record: Record<string, MapResponse> = {};
  products.forEach((url, i) => {
    record[url] = productPage(i < withGtin ? VALID_GTIN : undefined);
  });
  return { products, record };
}

describe('B3.1 GTIN present', () => {
  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(gtinPresent, targetFor(), mapFetcher({}));
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });

  it('passes at 80 percent, warns above 50 percent, fails at or below 50 percent', async () => {
    const expectations: [number, number, string][] = [
      [5, 5, 'pass'],
      [5, 4, 'pass'],
      [5, 3, 'warn'],
      [2, 1, 'fail'],
      [5, 2, 'fail'],
      [5, 0, 'fail'],
    ];
    for (const [total, withGtin, verdict] of expectations) {
      const { products, record } = sampled(total, withGtin);
      const outcome = await runCheck(gtinPresent, targetFor({ products }), mapFetcher(record));
      expect(outcome.verdict, `${withGtin} of ${total}`).toBe(verdict);
      expect(outcome.evidence).toMatchObject({ sampled: total, with_gtin: withGtin });
      const without = total - withGtin;
      expect(outcome.message).toBe(
        verdict === 'fail'
          ? `${withGtin} of ${total} sampled product(s) carry a GTIN; ${without} of the ${without} without one also lack brand plus mpn, Google's documented alternative`
          : `${withGtin} of ${total} sampled product(s) carry a GTIN`,
      );
    }
  });

  it('warns instead of failing when the products without a GTIN carry brand and mpn', async () => {
    const identified = withProduct({
      mpn: 'MUG-350',
      brand: { '@type': 'Brand', name: 'Example' },
    });
    const outcome = await runCheck(
      gtinPresent,
      targetFor({ products: [mug, bowl], platform: 'shopify' }),
      mapFetcher({ [mug]: identified, [bowl]: identified }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      "0 of 2 sampled product(s) carry a GTIN; the 2 without one carry brand and mpn, Google's documented alternative to a GTIN",
    );
    expect(outcome.evidence).toMatchObject({
      without_gtin_with_brand_and_mpn: 2,
      products: [
        { url: mug, brand_and_mpn: true },
        { url: bowl, brand_and_mpn: true },
      ],
    });
    const half = await runCheck(
      gtinPresent,
      targetFor({ products: [mug, bowl], platform: 'shopify' }),
      mapFetcher({ [mug]: identified, [bowl]: withProduct({ brand: 'Example' }) }),
    );
    expect(half.verdict).toBe('fail');
    expect(half.message).toBe(
      "0 of 2 sampled product(s) carry a GTIN; 1 of the 2 without one also lack brand plus mpn, Google's documented alternative",
    );
  });

  it('falls back to the Store API global_unique_id on WooCommerce and records the source', async () => {
    const url = 'https://shop.example/product/mug/';
    const outcome = await runCheck(
      gtinPresent,
      targetFor({ products: [url] }),
      mapFetcher({
        [url]: productPage(),
        [STORE_API]: JSON.stringify([
          { id: 1, name: 'Mug', permalink: url, sku: 'MUG', global_unique_id: VALID_GTIN },
        ]),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      products: [{ url, gtin: VALID_GTIN, source: 'store-api' }],
    });
    const other = await runCheck(
      gtinPresent,
      targetFor({ products: [url], platform: 'shopify' }),
      mapFetcher({ [url]: productPage() }),
    );
    expect(other.verdict).toBe('fail');
    expect(other.evidence).toMatchObject({ products: [{ url, gtin: null, source: null }] });
  });

  it('reads GTINs from the variants of a ProductGroup, the way Shopify emits them', async () => {
    const outcome = await runCheck(
      gtinPresent,
      targetFor({ products: [mug], platform: 'shopify' }),
      mapFetcher({
        [mug]: shopifyGroupPage([
          { gtin13: VALID_GTIN, mpn: 'VSL-001' },
          { gtin13: '4006381333948', mpn: 'VSL-002' },
          { mpn: 'VSL-003' },
        ]),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('1 of 1 sampled product(s) carry a GTIN (1 on variants)');
    expect(outcome.evidence).toMatchObject({
      with_gtin: 1,
      from_variants: 1,
      invalid_format: [],
      products: [
        {
          url: mug,
          gtin: VALID_GTIN,
          gtins: [VALID_GTIN, '4006381333948'],
          variants_with_gtin: 2,
          source: 'jsonld',
        },
      ],
    });
  });

  it('does not count a gtin value that is not 8, 12, 13 or 14 digits and says so', async () => {
    const outcome = await runCheck(
      gtinPresent,
      targetFor({ products: [mug, bowl], platform: 'shopify' }),
      mapFetcher({
        [mug]: withProduct({ gtin: 'FG006780' }),
        [bowl]: withProduct({ gtin13: '4006 3813 33931' }),
      }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      "1 of 2 sampled product(s) carry a GTIN; 1 gtin value(s) not counted because they are not 8, 12, 13 or 14 digits: FG006780; 1 of the 1 without one also lack brand plus mpn, Google's documented alternative",
    );
    expect(outcome.evidence).toMatchObject({
      with_gtin: 1,
      invalid_format: ['FG006780'],
      products: [
        { url: mug, gtin: null, invalid_format: ['FG006780'], source: null },
        { url: bowl, gtin: '4006 3813 33931', source: 'jsonld' },
      ],
    });
  });

  it('never scores a page that could not be fetched and says so', async () => {
    const outcome = await runCheck(
      gtinPresent,
      targetFor({ products: [mug, bowl], platform: 'shopify' }),
      mapFetcher({ [mug]: productPage(VALID_GTIN), [bowl]: { status: 403, body: 'denied' } }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      '1 of 1 sampled product(s) carry a GTIN; 1 of 2 sampled page(s) could not be fetched',
    );
    expect(outcome.evidence).toMatchObject({ sampled: 1, unfetched: [bowl] });
    const none = await runCheck(
      gtinPresent,
      targetFor({ products: [mug], platform: 'shopify' }),
      mapFetcher({ [mug]: { status: 0 } }),
    );
    expect(none).toMatchObject({ verdict: 'skip', skipReason: 'error' });
  });
});

/** A Shopify-style ProductGroup page: identifiers and offers live on the hasVariant Products. */
function shopifyGroupPage(variants: Record<string, unknown>[]): string {
  const node = {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name: 'Vital Seamless Leggings',
    brand: { '@type': 'Brand', name: 'Example Athletics' },
    hasVariant: variants.map((fields, index) => ({
      '@type': 'Product',
      name: `Vital Seamless Leggings - ${index}`,
      sku: `VSL-${index}`,
      offers: { '@type': 'Offer', price: '40.00', priceCurrency: 'USD' },
      ...fields,
    })),
  };
  return `<!doctype html><html><head><title>P</title><script type="application/ld+json">${JSON.stringify(node)}</script></head><body></body></html>`;
}

describe('B3.2 GTIN valid', () => {
  const url = 'https://shop.example/product/mug/';

  it('skips for the right reason with no pages and with no GTINs', async () => {
    expect(await runCheck(gtinValid, targetFor(), mapFetcher({}))).toMatchObject({
      verdict: 'skip',
      skipReason: 'not_applicable',
    });
    expect(
      await runCheck(
        gtinValid,
        targetFor({ products: [url] }),
        mapFetcher({ [url]: productPage() }),
      ),
    ).toMatchObject({ verdict: 'skip', skipReason: 'dependency_failed' });
  });

  it('passes on GS1-valid check digits and fails on invalid ones', async () => {
    const valid = await runCheck(
      gtinValid,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: productPage(VALID_GTIN) }),
    );
    expect(valid.verdict).toBe('pass');
    expect(valid.evidence).toMatchObject({ checked: 1, invalid: 0 });
    const invalid = await runCheck(
      gtinValid,
      targetFor({ products: [url] }),
      mapFetcher({ [url]: productPage('4006381333932') }),
    );
    expect(invalid.verdict).toBe('fail');
    expect(invalid.message).toBe('1 of 1 GTIN(s) fail the GS1 check digit: 4006381333932');
    expect(invalid.evidence).toMatchObject({
      checked: 1,
      invalid: 1,
      products: [{ url, gtin: '4006381333932', valid: false }],
    });
  });

  it('validates every well-formed GTIN on the variants, and leaves malformed values to B3.1', async () => {
    const outcome = await runCheck(
      gtinValid,
      targetFor({ products: [url], platform: 'shopify' }),
      mapFetcher({
        [url]: shopifyGroupPage([
          { gtin13: VALID_GTIN },
          { gtin13: '4006381333932' },
          { gtin: 'FG006780' },
        ]),
      }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toMatchObject({
      checked: 2,
      invalid: 1,
      invalid_values: ['4006381333932'],
      products: [{ url, gtin: VALID_GTIN, valid: false }],
    });
  });
});

const mug = 'https://shop.example/product/mug/';
const bowl = 'https://shop.example/product/bowl/';
const BRAND = { '@type': 'Brand', name: 'Example Ceramics' };

describe('B3.3 brand present as entity', () => {
  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(brandEntity, targetFor(), mapFetcher({}));
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });

  it('defers to B2.1 when no page carries Product JSON-LD', async () => {
    const outcome = await runCheck(
      brandEntity,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: PLAIN }),
    );
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'dependency_failed' });
  });

  it('passes when every product carries a Brand or Organization object with one spelling', async () => {
    const outcome = await runCheck(
      brandEntity,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withProduct({ brand: BRAND }),
        [bowl]: withProduct({
          brand: [{ '@type': 'https://schema.org/Organization', name: 'Example Ceramics' }],
        }),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      considered: 2,
      missing: 0,
      weak: 0,
      inconsistent_casing: [],
      pages: {
        [mug]: { brand: 'Example Ceramics', type: 'Brand', shape: 'entity', issue: null },
        [bowl]: { type: 'Organization', shape: 'entity' },
      },
    });
  });

  it('passes a bare string brand with a note recommending the Brand object', async () => {
    const outcome = await runCheck(
      brandEntity,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withProduct({ brand: 'Example Ceramics' }) }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'all 1 product(s) carry a brand with a consistent name (1 as a bare string; Google recommends brand.name on a Brand object)',
    );
    expect(outcome.evidence).toMatchObject({
      weak: 0,
      bare_strings: 1,
      pages: { [mug]: { brand: 'Example Ceramics', shape: 'string', issue: null } },
    });
  });

  it('warns on a brand object without a name or with another type', async () => {
    const outcome = await runCheck(
      brandEntity,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withProduct({ brand: { '@type': 'Brand', logo: 'https://shop.example/l.png' } }),
        [bowl]: withProduct({ brand: { '@type': 'Thing', name: 'Example Ceramics' } }),
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({
      weak: 2,
      pages: {
        [mug]: { brand: null, issue: 'brand object has no name' },
        [bowl]: { issue: 'brand @type is Thing, expected Brand or Organization' },
      },
    });
  });

  it('warns when the same brand is spelled with different casing across the sample', async () => {
    const outcome = await runCheck(
      brandEntity,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withProduct({ brand: BRAND }),
        [bowl]: withProduct({ brand: { '@type': 'Brand', name: 'EXAMPLE CERAMICS' } }),
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toContain('casing varies');
    expect(outcome.evidence).toMatchObject({
      weak: 0,
      inconsistent_casing: [['Example Ceramics', 'EXAMPLE CERAMICS']],
    });
  });

  it('fails when any product has no brand', async () => {
    const outcome = await runCheck(
      brandEntity,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: withProduct({ brand: BRAND }), [bowl]: withProduct({ brand: '  ' }) }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toMatchObject({
      missing: 1,
      pages: { [bowl]: { shape: 'missing', issue: 'brand is absent' } },
    });
  });
});

describe('B3.4 MPN present when GTIN absent', () => {
  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(mpnWhenGtinAbsent, targetFor(), mapFetcher({}));
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });

  it('does not apply when every sampled product has a GTIN, counting the Store API', async () => {
    const outcome = await runCheck(
      mpnWhenGtinAbsent,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: productPage(VALID_GTIN),
        [bowl]: withProduct({}),
        [STORE_API]: JSON.stringify([
          { id: 2, name: 'Bowl', permalink: bowl, sku: 'BOWL', global_unique_id: VALID_GTIN },
        ]),
      }),
    );
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
    expect(outcome.evidence).toMatchObject({ sampled: 2 });
  });

  it('defers to B2.1 when the products without a GTIN carry no Product JSON-LD', async () => {
    const outcome = await runCheck(
      mpnWhenGtinAbsent,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: productPage(VALID_GTIN), [bowl]: PLAIN }),
    );
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'dependency_failed' });
  });

  it('passes when every product without a GTIN carries mpn and a brand name', async () => {
    const outcome = await runCheck(
      mpnWhenGtinAbsent,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: productPage(VALID_GTIN),
        [bowl]: withProduct({ mpn: 'BWL-28', brand: 'Example Ceramics' }),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      sampled: 2,
      without_gtin: 1,
      considered: 1,
      both: 1,
      pages: { [bowl]: { mpn: 'BWL-28', brand: 'Example Ceramics', status: 'both' } },
    });
    expect(outcome.evidence.pages).not.toHaveProperty(mug);
  });

  it('reads the mpn from the variants of a ProductGroup', async () => {
    const outcome = await runCheck(
      mpnWhenGtinAbsent,
      targetFor({ products: [mug], platform: 'shopify' }),
      mapFetcher({ [mug]: shopifyGroupPage([{ mpn: 'VSL-001' }, { mpn: 'VSL-002' }]) }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pages: { [mug]: { mpn: 'VSL-001', brand: 'Example Athletics', status: 'both' } },
    });
  });

  it('warns when only one of mpn and brand is present', async () => {
    const outcome = await runCheck(
      mpnWhenGtinAbsent,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withProduct({ brand: BRAND }) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({
      one: 1,
      pages: { [mug]: { mpn: null, brand: 'Example Ceramics', status: 'one' } },
    });
  });

  it('fails when a product without a GTIN carries neither', async () => {
    const outcome = await runCheck(
      mpnWhenGtinAbsent,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withProduct({ mpn: 'MUG-350', brand: BRAND }),
        [bowl]: withProduct({ mpn: '' }),
      }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toMatchObject({
      both: 1,
      neither: 1,
      pages: { [bowl]: { mpn: null, brand: null, status: 'neither' } },
    });
  });
});

describe('B3.5 SKU present and unique in sample', () => {
  it('does not apply without sampled product pages', async () => {
    const outcome = await runCheck(skuPresentAndUnique, targetFor(), mapFetcher({}));
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });

  it('passes when every product has a distinct SKU from JSON-LD or the Store API', async () => {
    const outcome = await runCheck(
      skuPresentAndUnique,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({
        [mug]: withProduct({ sku: 'MUG-350' }),
        [bowl]: PLAIN,
        [STORE_API]: JSON.stringify([{ id: 2, name: 'Bowl', permalink: bowl, sku: 'BOWL-280' }]),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      sampled: 2,
      with_sku: 2,
      missing: [],
      duplicates: [],
      pages: {
        [mug]: { sku: 'MUG-350', source: 'jsonld' },
        [bowl]: { sku: 'BOWL-280', source: 'store-api' },
      },
    });
  });

  it('accepts productID as the identifier and records which field supplied it', async () => {
    const outcome = await runCheck(
      skuPresentAndUnique,
      targetFor({ products: [mug, bowl], platform: 'shopify' }),
      mapFetcher({
        [mug]: withProduct({ productID: 'meta:12345' }),
        [bowl]: withProduct({ sku: 'BOWL-280', productID: 'meta:67890' }),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('all 2 sampled product(s) carry a distinct SKU (1 as productID)');
    expect(outcome.evidence).toMatchObject({
      pages: {
        [mug]: { sku: 'meta:12345', source: 'jsonld', field: 'productID' },
        [bowl]: { sku: 'BOWL-280', source: 'jsonld', field: 'sku' },
      },
    });
  });

  it('reads the first variant SKU of a ProductGroup', async () => {
    const outcome = await runCheck(
      skuPresentAndUnique,
      targetFor({ products: [mug], platform: 'shopify' }),
      mapFetcher({
        [mug]: `<html><head><script type="application/ld+json">${JSON.stringify({
          '@type': 'ProductGroup',
          hasVariant: [{ '@type': 'Product', sku: 'MUG-350-BLU' }],
        })}</script></head></html>`,
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ pages: { [mug]: { sku: 'MUG-350-BLU' } } });
  });

  it('warns when two sampled products share a SKU', async () => {
    const outcome = await runCheck(
      skuPresentAndUnique,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: withProduct({ sku: 'SAME' }), [bowl]: withProduct({ sku: 'SAME' }) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({ duplicates: [{ sku: 'SAME', urls: [mug, bowl] }] });
  });

  it('fails when any sampled product has no SKU', async () => {
    const outcome = await runCheck(
      skuPresentAndUnique,
      targetFor({ products: [mug, bowl] }),
      mapFetcher({ [mug]: withProduct({ sku: 'MUG-350' }), [bowl]: withProduct({ sku: ' ' }) }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toMatchObject({
      with_sku: 1,
      missing: [bowl],
      pages: { [bowl]: { sku: null, source: null } },
    });
  });

  it('does not score a page that could not be fetched as missing a SKU', async () => {
    const outcome = await runCheck(
      skuPresentAndUnique,
      targetFor({ products: [mug, bowl], platform: 'shopify' }),
      mapFetcher({ [mug]: withProduct({ sku: 'MUG-350' }), [bowl]: { status: 0 } }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'all 1 sampled product(s) carry a distinct SKU; 1 of 2 sampled page(s) could not be fetched',
    );
    expect(outcome.evidence).toMatchObject({ sampled: 1, unfetched: [bowl] });
  });
});

describe('B3.3 brand on unreadable pages', () => {
  it('skips with reason error when no sampled page could be fetched', async () => {
    const outcome = await runCheck(
      brandEntity,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: { status: 503, body: '' } }),
    );
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'error' });
  });
});
