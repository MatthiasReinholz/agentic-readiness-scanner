import { isValidGtin, normalizeGtin } from '../../parsers/gtin.js';
import { extractJsonLd, gtinOf, productNodes } from '../../parsers/jsonld.js';
import { productPages, storeApiProducts } from '../shared.js';
import { defineCheck, fail, pass, skip, warn, type CheckContext } from '../types.js';

interface IdentitySample {
  url: string;
  gtin: string | null;
  source: 'jsonld' | 'store-api' | null;
}

/** GTIN per sampled product from JSON-LD, falling back to the Store API global_unique_id. */
export async function collectGtins(context: CheckContext): Promise<IdentitySample[]> {
  const { target, fetcher } = context;
  const pages = await productPages(target, fetcher);
  const apiProducts = await storeApiProducts(target, fetcher);
  const byPermalink = new Map<string, string>();
  for (const product of apiProducts ?? []) {
    if (product.global_unique_id)
      byPermalink.set(product.permalink.replace(/\/$/, ''), product.global_unique_id);
  }
  return pages.map((page) => {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    const fromJsonLd = products.map(gtinOf).find((value) => value !== null) ?? null;
    if (fromJsonLd) return { url: page.url, gtin: fromJsonLd, source: 'jsonld' };
    const fromApi = byPermalink.get(page.url.replace(/\/$/, '')) ?? null;
    if (fromApi) return { url: page.url, gtin: fromApi, source: 'store-api' };
    return { url: page.url, gtin: null, source: null };
  });
}

export const gtinPresent = defineCheck('B3.1', async (context) => {
  const samples = await collectGtins(context);
  if (samples.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const withGtin = samples.filter((sample) => sample.gtin !== null).length;
  const ratio = withGtin / samples.length;
  const evidence = { sampled: samples.length, with_gtin: withGtin, products: samples };
  const message = `${withGtin} of ${samples.length} sampled product(s) carry a GTIN`;
  // Channel rules ask for identifiers on most of the catalog, not all of it, hence 80 percent.
  if (ratio >= 0.8) return pass(message, evidence);
  if (ratio > 0.5) return warn(message, evidence);
  return fail(message, evidence);
});

export const gtinValid = defineCheck('B3.2', async (context) => {
  const all = await collectGtins(context);
  if (all.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const samples = all.filter((sample) => sample.gtin !== null);
  if (samples.length === 0) {
    return skip('dependency_failed', 'no GTINs to validate');
  }
  const results = samples.map((sample) => ({
    url: sample.url,
    gtin: sample.gtin,
    normalized: normalizeGtin(sample.gtin ?? ''),
    valid: isValidGtin(sample.gtin ?? ''),
  }));
  const invalid = results.filter((result) => !result.valid);
  const evidence = { checked: results.length, invalid: invalid.length, products: results };
  if (invalid.length === 0)
    return pass(`all ${results.length} GTIN(s) pass the GS1 check digit`, evidence);
  return fail(`${invalid.length} of ${results.length} GTIN(s) are invalid`, evidence);
});
