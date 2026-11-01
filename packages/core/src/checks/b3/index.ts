import { isValidGtin, normalizeGtin } from '../../parsers/gtin.js';
import {
  asString,
  brandOf,
  extractJsonLd,
  gtinOf,
  productNodes,
  variantsOf,
  type JsonLdNode,
} from '../../parsers/jsonld.js';
import {
  permalinkKey,
  productPages,
  storeApiProducts,
  storeApiProductsByPermalink,
} from '../shared.js';
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

const BRAND_TYPES = new Set(['brand', 'organization']);

interface BrandEvidence {
  brand: string | null;
  type: string | null;
  shape: 'entity' | 'string' | 'missing';
  issue: string | null;
}

export const brandEntity = defineCheck('B3.3', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<string, BrandEvidence> = {};
  const spellings = new Map<string, Set<string>>();
  let considered = 0;
  let missing = 0;
  let weak = 0;
  for (const page of pages) {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    if (products.length === 0) continue;
    considered += 1;
    const brand = products.map(brandOf).find((value) => value !== null) ?? null;
    if (brand === null) {
      missing += 1;
      perPage[page.url] = { brand: null, type: null, shape: 'missing', issue: 'brand is absent' };
      continue;
    }
    if (brand.name !== null) {
      const key = brand.name.toLowerCase();
      spellings.set(key, (spellings.get(key) ?? new Set<string>()).add(brand.name));
    }
    let issue: string | null = null;
    if (brand.kind === 'string') issue = 'brand is a bare string, not a Brand object';
    else if (brand.name === null) issue = 'brand object has no name';
    else if (brand.type === null || !BRAND_TYPES.has(brand.type.toLowerCase()))
      issue = `brand @type is ${brand.type ?? 'missing'}, expected Brand or Organization`;
    if (issue !== null) weak += 1;
    perPage[page.url] = { brand: brand.name, type: brand.type, shape: brand.kind, issue };
  }
  if (considered === 0) {
    return skip('dependency_failed', 'no Product JSON-LD to inspect');
  }
  const inconsistent = [...spellings.values()]
    .filter((variants) => variants.size > 1)
    .map((variants) => [...variants]);
  const evidence = { pages: perPage, considered, missing, weak, inconsistent_casing: inconsistent };
  if (missing > 0) return fail(`${missing} of ${considered} product(s) have no brand`, evidence);
  if (weak > 0)
    return warn(
      `${weak} of ${considered} product(s) carry the brand as a string or an incomplete object`,
      evidence,
    );
  if (inconsistent.length > 0)
    return warn(
      `brand name casing varies across the sample: ${inconsistent.map((v) => v.join(' / ')).join('; ')}`,
      evidence,
    );
  return pass(`all ${considered} product(s) carry a Brand object with a consistent name`, evidence);
});

/** The brand name however it is written: the entity's name or the bare string. */
function brandNameOf(products: JsonLdNode[]): string | null {
  return products.map(brandOf).find((value) => value !== null)?.name ?? null;
}

export const mpnWhenGtinAbsent = defineCheck('B3.4', async (context) => {
  const samples = await collectGtins(context);
  if (samples.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const withoutGtin = samples.filter((sample) => sample.gtin === null);
  if (withoutGtin.length === 0) {
    return skip('not_applicable', 'every sampled product carries a GTIN', {
      sampled: samples.length,
    });
  }
  const pages = await productPages(context.target, context.fetcher);
  const perPage: Record<
    string,
    { mpn: string | null; brand: string | null; status: 'both' | 'one' | 'neither' }
  > = {};
  const counts = { both: 0, one: 0, neither: 0 };
  for (const sample of withoutGtin) {
    const page = pages.find((candidate) => candidate.url === sample.url);
    const products = page ? productNodes(extractJsonLd(page.doc).nodes) : [];
    // A page without Product JSON-LD is B2.1's failure; it cannot carry an mpn here.
    if (products.length === 0) continue;
    const mpn = products.map((product) => asString(product.mpn)).find((v) => v !== null) ?? null;
    const brand = brandNameOf(products);
    const status = mpn && brand ? 'both' : mpn || brand ? 'one' : 'neither';
    counts[status] += 1;
    perPage[sample.url] = { mpn, brand, status };
  }
  const considered = counts.both + counts.one + counts.neither;
  if (considered === 0) {
    return skip('dependency_failed', 'no Product JSON-LD on the products without a GTIN');
  }
  const evidence = {
    pages: perPage,
    sampled: samples.length,
    without_gtin: withoutGtin.length,
    considered,
    ...counts,
  };
  if (counts.neither > 0)
    return fail(
      `${counts.neither} of ${considered} product(s) without a GTIN carry neither mpn nor brand`,
      evidence,
    );
  if (counts.one > 0) {
    const entries = Object.values(perPage).filter((page) => page.status === 'one');
    const missingMpn = entries.filter((page) => page.mpn === null).length;
    const missingBrand = entries.length - missingMpn;
    const missing = [
      missingMpn > 0 ? `${missingMpn} carry a brand but no mpn` : '',
      missingBrand > 0 ? `${missingBrand} carry an mpn but no brand` : '',
    ]
      .filter(Boolean)
      .join(' and ');
    return warn(
      `${counts.one} of ${considered} product(s) without a GTIN are only half identified: ${missing}`,
      evidence,
    );
  }
  return pass(`all ${considered} product(s) without a GTIN carry mpn and brand`, evidence);
});

export const skuPresentAndUnique = defineCheck('B3.5', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const api = await storeApiProductsByPermalink(target, fetcher);
  const perPage: Record<string, { sku: string | null; source: 'jsonld' | 'store-api' | null }> = {};
  const owners = new Map<string, string[]>();
  const missing: string[] = [];
  for (const page of pages) {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    // A ProductGroup rarely carries a sku itself; its first variant does.
    const candidates = [...products, ...products.flatMap(variantsOf)];
    const fromJsonLd =
      candidates.map((node) => asString(node.sku)).find((value) => value !== null) ?? null;
    const fromApi = asString(api.get(permalinkKey(page.url))?.sku);
    const sku = fromJsonLd ?? fromApi;
    const source = fromJsonLd !== null ? 'jsonld' : fromApi !== null ? 'store-api' : null;
    perPage[page.url] = { sku, source };
    if (sku === null) missing.push(page.url);
    else owners.set(sku, [...(owners.get(sku) ?? []), page.url]);
  }
  const duplicates = [...owners.entries()]
    .filter(([, urls]) => urls.length > 1)
    .map(([sku, urls]) => ({ sku, urls }));
  const evidence = {
    pages: perPage,
    sampled: pages.length,
    with_sku: pages.length - missing.length,
    missing,
    duplicates,
  };
  if (missing.length > 0)
    return fail(`${missing.length} of ${pages.length} sampled product(s) have no SKU`, evidence);
  if (duplicates.length > 0)
    return warn(
      `SKU ${duplicates.map((d) => d.sku).join(', ')} is shared by more than one sampled product`,
      evidence,
    );
  return pass(`all ${pages.length} sampled product(s) carry a distinct SKU`, evidence);
});
