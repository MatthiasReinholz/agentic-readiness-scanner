import { isValidGtin, normalizeGtin } from '../../parsers/gtin.js';
import {
  asString,
  brandOf,
  extractJsonLd,
  gtinsOf,
  type JsonLdNode,
  looksLikeGtin,
  mpnOf,
  productNodes,
  variantNodes,
} from '../../parsers/jsonld.js';
import {
  fetchNote,
  permalinkKey,
  readableProductPages,
  storeApiProducts,
  storeApiProductsByPermalink,
  unfetched,
} from '../shared.js';
import {
  type CheckContext,
  type CheckOutcome,
  defineCheck,
  fail,
  pass,
  skip,
  warn,
} from '../types.js';

interface IdentitySample {
  url: string;
  /** The first value shaped like a GTIN (8, 12, 13 or 14 digits), or null. */
  gtin: string | null;
  /** Every value shaped like a GTIN on the product and its variants. */
  gtins: string[];
  /** Values in a gtin field that are not shaped like a GTIN; they do not count as present. */
  invalid_format: string[];
  variants_with_gtin: number;
  source: 'jsonld' | 'store-api' | null;
  /** True when the JSON-LD carries brand and mpn, Google's documented alternative to a GTIN. */
  brand_and_mpn: boolean;
}

interface IdentitySamples {
  samples: IdentitySample[];
  /** The outcome to return when no sampled page could be read. */
  unavailable: CheckOutcome | null;
  unfetched: string[];
  note: string;
}

/**
 * GTINs per readable sampled product: from the Product JSON-LD and its variants, falling
 * back to the Store API global_unique_id. A value counts only when it is shaped like a
 * GTIN; "FG006780" in a gtin field is recorded as invalid_format instead.
 */
export async function collectGtins(context: CheckContext): Promise<IdentitySamples> {
  const { target, fetcher } = context;
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  const apiProducts = await storeApiProducts(target, fetcher);
  const byPermalink = new Map<string, string>();
  for (const product of apiProducts ?? []) {
    if (product.global_unique_id)
      byPermalink.set(permalinkKey(product.permalink), product.global_unique_id);
  }
  const samples = pages.map((page): IdentitySample => {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    const gtins = new Set<string>();
    const invalid = new Set<string>();
    let variantsWithGtin = 0;
    for (const product of products) {
      const found = gtinsOf(product);
      found.gtins.forEach((value) => gtins.add(value));
      found.invalid_format.forEach((value) => invalid.add(value));
      variantsWithGtin += found.variants_with_gtin;
    }
    const base = {
      url: page.url,
      gtins: [...gtins],
      invalid_format: [...invalid],
      variants_with_gtin: variantsWithGtin,
      brand_and_mpn:
        brandNameOf(products) !== null && products.map(mpnOf).some((value) => value !== null),
    };
    const fromJsonLd = base.gtins[0] ?? null;
    if (fromJsonLd !== null) return { ...base, gtin: fromJsonLd, source: 'jsonld' };
    const fromApi = byPermalink.get(permalinkKey(page.url)) ?? null;
    if (fromApi !== null && looksLikeGtin(fromApi))
      return { ...base, gtin: fromApi, gtins: [fromApi], source: 'store-api' };
    if (fromApi !== null) base.invalid_format.push(fromApi);
    return { ...base, gtin: null, source: null };
  });
  return {
    samples,
    unavailable,
    unfetched: unfetched(target, pages),
    note: fetchNote(target, pages),
  };
}

export const gtinPresent = defineCheck('B3.1', async (context) => {
  const { samples, unavailable, unfetched: failed, note } = await collectGtins(context);
  if (unavailable) return unavailable;
  const withGtin = samples.filter((sample) => sample.gtin !== null).length;
  const fromVariants = samples.filter(
    (sample) => sample.source === 'jsonld' && sample.variants_with_gtin > 0,
  ).length;
  const invalid = [...new Set(samples.flatMap((sample) => sample.invalid_format))];
  const ratio = withGtin / samples.length;
  const withoutGtin = samples.filter((sample) => sample.gtin === null);
  const alternative = withoutGtin.filter((sample) => sample.brand_and_mpn).length;
  const evidence = {
    sampled: samples.length,
    with_gtin: withGtin,
    from_variants: fromVariants,
    without_gtin_with_brand_and_mpn: alternative,
    invalid_format: invalid,
    products: samples,
    unfetched: failed,
  };
  const variantNote = fromVariants > 0 ? ` (${fromVariants} on variants)` : '';
  const invalidNote =
    invalid.length > 0
      ? `; ${invalid.length} gtin value(s) not counted because they are not 8, 12, 13 or 14 digits: ${invalid.slice(0, 5).join(', ')}`
      : '';
  const message = `${withGtin} of ${samples.length} sampled product(s) carry a GTIN${variantNote}${invalidNote}`;
  // Channel rules ask for identifiers on most of the catalog, not all of it, hence 80 percent.
  if (ratio >= 0.8) return pass(`${message}${note}`, evidence);
  if (ratio > 0.5) return warn(`${message}${note}`, evidence);
  // Google accepts brand plus MPN where no GTIN exists; a product identified that way is
  // weak, not unidentified.
  if (withoutGtin.length > 0 && alternative === withoutGtin.length)
    return warn(
      `${message}; the ${withoutGtin.length} without one carry brand and mpn, Google's documented alternative to a GTIN${note}`,
      evidence,
    );
  return fail(
    `${message}; ${withoutGtin.length - alternative} of the ${withoutGtin.length} without one also lack brand plus mpn, Google's documented alternative${note}`,
    evidence,
  );
});

export const gtinValid = defineCheck('B3.2', async (context) => {
  const { samples: all, unavailable, note } = await collectGtins(context);
  if (unavailable) return unavailable;
  const samples = all.filter((sample) => sample.gtin !== null);
  if (samples.length === 0) {
    return skip('dependency_failed', 'no GTINs to validate');
  }
  // Every well-formed GTIN on the product and its variants is checked, not only the first.
  const results = samples.map((sample) => {
    const values = sample.gtins.map((value) => ({
      value,
      normalized: normalizeGtin(value),
      valid: isValidGtin(value),
    }));
    return {
      url: sample.url,
      gtin: sample.gtin,
      normalized: normalizeGtin(sample.gtin ?? ''),
      gtins: values,
      valid: values.every((entry) => entry.valid),
    };
  });
  const checked = results.reduce((sum, result) => sum + result.gtins.length, 0);
  const invalidValues = results.flatMap((result) =>
    result.gtins.filter((entry) => !entry.valid).map((entry) => entry.value),
  );
  const evidence = {
    checked,
    invalid: invalidValues.length,
    products: results,
    invalid_values: invalidValues,
  };
  if (invalidValues.length === 0)
    return pass(`all ${checked} GTIN(s) pass the GS1 check digit${note}`, evidence);
  return fail(
    `${invalidValues.length} of ${checked} GTIN(s) fail the GS1 check digit: ${invalidValues.slice(0, 5).join(', ')}${note}`,
    evidence,
  );
});

const BRAND_TYPES = new Set(['brand', 'organization']);

interface BrandEvidence {
  brand: string | null;
  type: string | null;
  shape: 'entity' | 'string' | 'missing';
  issue: string | null;
}

export const brandEntity = defineCheck('B3.3', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const perPage: Record<string, BrandEvidence> = {};
  const spellings = new Map<string, Set<string>>();
  let considered = 0;
  let missing = 0;
  let weak = 0;
  let strings = 0;
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
    // Google reads a bare string as the brand name too; the Brand object is a recommendation.
    if (brand.kind === 'string') strings += 1;
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
  const evidence = {
    pages: perPage,
    considered,
    missing,
    weak,
    bare_strings: strings,
    inconsistent_casing: inconsistent,
    unfetched: unfetched(target, pages),
  };
  const note = fetchNote(target, pages);
  const stringNote =
    strings > 0
      ? ` (${strings} as a bare string; Google recommends brand.name on a Brand object)`
      : '';
  if (missing > 0)
    return fail(`${missing} of ${considered} product(s) have no brand${note}`, evidence);
  if (weak > 0)
    return warn(
      `${weak} of ${considered} product(s) carry the brand as an incomplete object${stringNote}${note}`,
      evidence,
    );
  if (inconsistent.length > 0)
    return warn(
      `brand name casing varies across the sample: ${inconsistent.map((v) => v.join(' / ')).join('; ')}${stringNote}${note}`,
      evidence,
    );
  return pass(
    `all ${considered} product(s) carry a brand with a consistent name${stringNote}${note}`,
    evidence,
  );
});

/** The brand name however it is written: the entity's name or the bare string. */
function brandNameOf(products: JsonLdNode[]): string | null {
  return products.map(brandOf).find((value) => value !== null)?.name ?? null;
}

export const mpnWhenGtinAbsent = defineCheck('B3.4', async (context) => {
  const { samples, unavailable, unfetched: failed, note } = await collectGtins(context);
  if (unavailable) return unavailable;
  const withoutGtin = samples.filter((sample) => sample.gtin === null);
  if (withoutGtin.length === 0) {
    return skip('not_applicable', `every sampled product carries a GTIN${note}`, {
      sampled: samples.length,
      unfetched: failed,
    });
  }
  const { pages } = await readableProductPages(context.target, context.fetcher);
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
    // The mpn sits on the Product, or on the variants of a ProductGroup.
    const mpn = products.map(mpnOf).find((value) => value !== null) ?? null;
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
    unfetched: failed,
  };
  if (counts.neither > 0)
    return fail(
      `${counts.neither} of ${considered} product(s) without a GTIN carry neither mpn nor brand${note}`,
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
      `${counts.one} of ${considered} product(s) without a GTIN are only half identified: ${missing}${note}`,
      evidence,
    );
  }
  return pass(`all ${considered} product(s) without a GTIN carry mpn and brand${note}`, evidence);
});

export const skuPresentAndUnique = defineCheck('B3.5', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const api = await storeApiProductsByPermalink(target, fetcher);
  const perPage: Record<
    string,
    {
      sku: string | null;
      source: 'jsonld' | 'store-api' | null;
      /** The JSON-LD property that supplied the identifier: sku, or productID (Meta's on-page markup). */
      field: 'sku' | 'productID' | null;
    }
  > = {};
  const owners = new Map<string, string[]>();
  const missing: string[] = [];
  for (const page of pages) {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    // A ProductGroup rarely carries a sku itself; its first variant does.
    const candidates = [...products, ...products.flatMap(variantNodes)];
    const fromSku =
      candidates.map((node) => asString(node.sku)).find((value) => value !== null) ?? null;
    const fromProductId =
      candidates.map((node) => asString(node.productID)).find((value) => value !== null) ?? null;
    const fromJsonLd = fromSku ?? fromProductId;
    const fromApi = asString(api.get(permalinkKey(page.url))?.sku);
    const sku = fromJsonLd ?? fromApi;
    const source = fromJsonLd !== null ? 'jsonld' : fromApi !== null ? 'store-api' : null;
    const field = fromSku !== null ? 'sku' : fromProductId !== null ? 'productID' : null;
    perPage[page.url] = { sku, source, field };
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
    unfetched: unfetched(target, pages),
  };
  const note = fetchNote(target, pages);
  const viaProductId = Object.values(perPage).filter((page) => page.field === 'productID').length;
  const fieldNote = viaProductId > 0 ? ` (${viaProductId} as productID)` : '';
  if (missing.length > 0)
    return fail(
      `${missing.length} of ${pages.length} sampled product(s) have no sku or productID${note}`,
      evidence,
    );
  if (duplicates.length > 0)
    return warn(
      `SKU ${duplicates.map((d) => d.sku).join(', ')} is shared by more than one sampled product${fieldNote}${note}`,
      evidence,
    );
  return pass(
    `all ${pages.length} sampled product(s) carry a distinct SKU${fieldNote}${note}`,
    evidence,
  );
});
