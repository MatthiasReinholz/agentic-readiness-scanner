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
      expect(outcome.message).toBe(`${withGtin} of ${total} sampled product(s) carry a GTIN`);
    }
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
});

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
    expect(invalid.evidence).toMatchObject({
      checked: 1,
      invalid: 1,
      products: [{ url, gtin: '4006381333932', valid: false }],
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

  it('warns on a bare string brand', async () => {
    const outcome = await runCheck(
      brandEntity,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: withProduct({ brand: 'Example Ceramics' }) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({
      weak: 1,
      pages: {
        [mug]: {
          brand: 'Example Ceramics',
          shape: 'string',
          issue: 'brand is a bare string, not a Brand object',
        },
      },
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
});
