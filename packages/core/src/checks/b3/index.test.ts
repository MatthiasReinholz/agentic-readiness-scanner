import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor, type MapResponse } from '../../testing/index.js';
import { gtinPresent, gtinValid } from './index.js';

const STORE_API = 'https://shop.example/wp-json/wc/store/v1/products?per_page=20';
const VALID_GTIN = '4006381333931';

function productPage(gtin?: string): string {
  const node = { '@type': 'Product', name: 'P', ...(gtin ? { gtin13: gtin } : {}) };
  return `<!doctype html><html><head><title>P</title><script type="application/ld+json">${JSON.stringify(node)}</script></head><body></body></html>`;
}

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
