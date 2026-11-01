import { isOk } from '../../http/types.js';
import { elementText } from '../../parsers/html.js';
import {
  allOffersOf,
  asString,
  extractJsonLd,
  hasType,
  imageOf,
  type JsonLdNode,
  nodesOf,
  offersOf,
  organizationNodes,
  productNodes,
  variantNodes,
} from '../../parsers/jsonld.js';
import { amountVisible, parseAmount, PRICE_TEXT_LIMIT, pricesInText } from '../../parsers/price.js';
import { isAllowed } from '../../parsers/robots.js';
import type { Target } from '../../target/types.js';
import {
  ADD_TO_CART,
  describeFailure,
  fetchNote,
  permalinkKey,
  readableProductPages,
  storeApiProductsByPermalink,
  unfetched,
} from '../shared.js';
import {
  type CheckOutcome,
  defineCheck,
  fail,
  outcomeForRatio,
  pass,
  skip,
  warn,
} from '../types.js';

/** Google's required Product properties for any rich result: name, image and offers. */
function missingRequiredProductProperties(products: JsonLdNode[]): string[] {
  const nodes = [...products, ...products.flatMap(variantNodes)];
  const missing: string[] = [];
  if (!nodes.some((node) => asString(node.name) !== null)) missing.push('name');
  if (!nodes.some((node) => imageOf(node) !== null)) missing.push('image');
  return missing;
}

export const productJsonLd = defineCheck('B2.1', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const perPage: Record<
    string,
    { product_nodes: number; types: string[]; parse_errors: string[]; missing_required: string[] }
  > = {};
  let withProduct = 0;
  const incomplete: string[] = [];
  for (const page of pages) {
    const { nodes, errors } = extractJsonLd(page.doc);
    const products = productNodes(nodes);
    const missing = products.length > 0 ? missingRequiredProductProperties(products) : [];
    perPage[page.url] = {
      product_nodes: products.length,
      types: products.map((node) => String(node['@type'])),
      parse_errors: errors,
      missing_required: missing,
    };
    if (products.length > 0) withProduct += 1;
    if (missing.length > 0) incomplete.push(`${missing.join(' and ')} on ${page.url}`);
  }
  const evidence = {
    pages: perPage,
    with_product: withProduct,
    total: pages.length,
    incomplete: incomplete.length,
    unfetched: unfetched(target, pages),
  };
  const outcome = outcomeForRatio(
    withProduct,
    pages.length,
    `${withProduct} of ${pages.length} sampled product page(s) carry Product JSON-LD${fetchNote(target, pages)}`,
    evidence,
    0,
  );
  if (incomplete.length === 0) return outcome;
  const note = `; ${incomplete.length} lack Google's required Product properties: ${incomplete.join(', ')}`;
  return {
    ...outcome,
    verdict: outcome.verdict === 'pass' ? 'warn' : outcome.verdict,
    message: `${outcome.message ?? ''}${note}`,
  };
});

const AVAILABILITY =
  /^https?:\/\/schema\.org\/(InStock|OutOfStock|PreOrder|BackOrder|Discontinued|InStoreOnly|LimitedAvailability|OnlineOnly|PreSale|SoldOut)$/;

const hasPrice = (offer: JsonLdNode): boolean =>
  asString(offer.price) !== null || asString(offer.lowPrice) !== null;
const hasCurrency = (offer: JsonLdNode): boolean => asString(offer.priceCurrency) !== null;
const hasAvailability = (offer: JsonLdNode): boolean =>
  AVAILABILITY.test(asString(offer.availability) ?? '');
const isCompleteOffer = (offer: JsonLdNode): boolean =>
  hasPrice(offer) && hasCurrency(offer) && hasAvailability(offer);

/** The offer's price (or lowPrice) as a number, null when absent or not a number. */
function offerAmount(offer: JsonLdNode): number | null {
  return parseAmount(asString(offer.price) ?? asString(offer.lowPrice));
}

/** True when priceValidUntil parses to a date before the page was served. */
function priceValidUntilExpired(offer: JsonLdNode, servedAt: number): boolean {
  const value = asString(offer.priceValidUntil);
  if (value === null) return false;
  const until = Date.parse(value);
  // A bare date names a whole day; it is past once that day has ended.
  const end = /^\d{4}-\d{2}-\d{2}$/.test(value) ? until + 86_400_000 : until;
  return Number.isFinite(end) && end < servedAt;
}

interface OfferEvidence {
  /** Offers on the product plus offers on its variants. */
  offers: number;
  own_offers: number;
  variant_offers: number;
  complete_offers: number;
  /** True when every offer carries the field; false when any lacks it or there is no offer. */
  price: boolean;
  currency: boolean;
  availability: boolean;
  /** True when any offer is an AggregateOffer. */
  aggregate_offer: boolean;
  /** Offers whose price is 0 or below. */
  non_positive_price: number;
  /** priceValidUntil values that were already in the past when the page was served. */
  expired_price_valid_until: string[];
}

export const offerComplete = defineCheck('B2.2', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const perPage: Record<string, OfferEvidence> = {};
  let products = 0;
  let completeProducts = 0;
  let offers = 0;
  let completeOffers = 0;
  let aggregateProducts = 0;
  let nonPositive = 0;
  const expired: string[] = [];
  const missing = { price: 0, currency: 0, availability: 0 };
  for (const page of pages) {
    const nodes = productNodes(extractJsonLd(page.doc).nodes);
    if (nodes.length === 0) continue;
    products += 1;
    // Shopify's ProductGroup carries no offers itself; each hasVariant Product does.
    const own = nodes.flatMap(offersOf);
    const variant = nodes.flatMap((node) => variantNodes(node).flatMap(offersOf));
    const all = [...own, ...variant];
    const complete = all.filter(isCompleteOffer).length;
    missing.price += all.filter((offer) => !hasPrice(offer)).length;
    missing.currency += all.filter((offer) => !hasCurrency(offer)).length;
    missing.availability += all.filter((offer) => !hasAvailability(offer)).length;
    const aggregate = all.some((offer) => hasType(offer, 'AggregateOffer'));
    const zero = all.filter((offer) => {
      const amount = offerAmount(offer);
      return amount !== null && amount <= 0;
    }).length;
    const pastDates = all
      .filter((offer) => priceValidUntilExpired(offer, page.fetchedAt))
      .map((offer) => asString(offer.priceValidUntil) ?? '');
    perPage[page.url] = {
      offers: all.length,
      own_offers: own.length,
      variant_offers: variant.length,
      complete_offers: complete,
      price: all.length > 0 && all.every(hasPrice),
      currency: all.length > 0 && all.every(hasCurrency),
      availability: all.length > 0 && all.every(hasAvailability),
      aggregate_offer: aggregate,
      non_positive_price: zero,
      expired_price_valid_until: pastDates,
    };
    offers += all.length;
    completeOffers += complete;
    if (aggregate) aggregateProducts += 1;
    nonPositive += zero;
    expired.push(...pastDates);
    if (all.length > 0 && complete === all.length) completeProducts += 1;
  }
  // Pages exist but none carries Product JSON-LD: that is B2.1's failure, not a missing target.
  if (products === 0) {
    return skip('dependency_failed', 'no Product JSON-LD to inspect');
  }
  const evidence = {
    pages: perPage,
    products,
    complete_products: completeProducts,
    offers,
    complete_offers: completeOffers,
    missing,
    aggregate_offer_products: aggregateProducts,
    non_positive_price: nonPositive,
    expired_price_valid_until: [...new Set(expired)],
    unfetched: unfetched(target, pages),
  };
  const note = fetchNote(target, pages);
  if (offers === 0) {
    return fail(`no Offer on any of ${products} product(s) with Product JSON-LD${note}`, evidence);
  }
  const gaps = (Object.entries(missing) as [keyof typeof missing, number][])
    .filter(([, count]) => count > 0)
    .map(
      ([field, count]) =>
        `${field === 'availability' ? 'schema.org availability' : field} on ${count}`,
    )
    .join(', ');
  const variantOffers = Object.values(perPage).reduce((sum, page) => sum + page.variant_offers, 0);
  const where = variantOffers > 0 ? ` (${variantOffers} on variants)` : '';
  // Google's merchant-listing rules on top of completeness: these demote a pass to a warn.
  const concerns: string[] = [];
  if (nonPositive > 0)
    concerns.push(
      `${nonPositive} offer(s) have a price of 0 or below: merchant listing experiences require a price greater than zero`,
    );
  if (expired.length > 0)
    concerns.push(
      `priceValidUntil ${[...new Set(expired)].join(', ')} is in the past on ${expired.length} offer(s): Google says your listing may not display if the priceValidUntil property indicates a past date`,
    );
  const remarks = [
    ...concerns,
    ...(aggregateProducts > 0
      ? [
          `${aggregateProducts} product(s) use an AggregateOffer: eligible for product snippets, not for Google merchant listings, which require an Offer`,
        ]
      : []),
  ];
  const remarkText = remarks.length > 0 ? `; ${remarks.join('; ')}` : '';
  if (completeProducts === products) {
    const message = `all ${offers} offer(s) on ${products} product(s) carry price, currency and schema.org availability${where}${remarkText}${note}`;
    return concerns.length > 0 ? warn(message, evidence) : pass(message, evidence);
  }
  const message = `${completeOffers} of ${offers} offer(s) on ${products} product(s) carry price, currency and schema.org availability${where}; missing: ${gaps}${remarkText}${note}`;
  return completeOffers > 0 ? warn(message, evidence) : fail(message, evidence);
});

/** Variants must be told apart by a sku or gtin of their own (Google's variant structured data). */
function variantIdentityIssues(group: JsonLdNode): string[] {
  const variants = variantNodes(group);
  const issues: string[] = [];
  if (variants.length > 0) {
    const ids = variants.map(
      (variant) =>
        asString(variant.sku) ??
        asString(variant.gtin13) ??
        asString(variant.gtin12) ??
        asString(variant.gtin14) ??
        asString(variant.gtin8) ??
        asString(variant.gtin),
    );
    if (ids.some((id) => id === null) || new Set(ids).size !== ids.length)
      issues.push('variants under hasVariant lack a unique sku or gtin');
  }
  if (asString(group.name) === null) issues.push('ProductGroup lacks name');
  if (asString(group.productGroupID) === null) issues.push('ProductGroup lacks productGroupID');
  return issues;
}

export const variantsModeled = defineCheck('B2.3', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const api = await storeApiProductsByPermalink(target, fetcher);
  const perPage: Record<
    string,
    {
      appears_variable: boolean;
      signals: string[];
      product_group: boolean;
      is_variant_of: boolean;
      jsonld_variants: number;
      store_api_variations: number;
      issues: string[];
    }
  > = {};
  let variable = 0;
  let modeled = 0;
  const issues: string[] = [];
  for (const page of pages) {
    const apiProduct = api.get(permalinkKey(page.url));
    const signals = page.doc.variationFormSignals();
    if (apiProduct?.type === 'variable') signals.push('store-api:type=variable');
    const products = productNodes(extractJsonLd(page.doc).nodes);
    const groups = products.filter((node) => hasType(node, 'ProductGroup'));
    // The multi-page form: each variant page is a Product whose isVariantOf names the group.
    const parentGroups = products
      .filter((node) => hasType(node, 'Product'))
      .flatMap((node) => nodesOf(node, 'isVariantOf'))
      .filter((node) => hasType(node, 'ProductGroup'));
    const jsonLdVariants = groups.reduce((sum, group) => sum + variantNodes(group).length, 0);
    // A ProductGroup with variants is itself evidence of a variable product, whatever the
    // theme renders: Shopify's native markup carries it with no WooCommerce-style form.
    if (jsonLdVariants > 0) signals.push('jsonld:ProductGroup.hasVariant');
    if (parentGroups.length > 0) signals.push('jsonld:Product.isVariantOf');
    const apiVariations = Array.isArray(apiProduct?.variations) ? apiProduct.variations.length : 0;
    const appearsVariable = signals.length > 0;
    const pageIssues = [...new Set([...groups, ...parentGroups].flatMap(variantIdentityIssues))];
    perPage[page.url] = {
      appears_variable: appearsVariable,
      signals,
      product_group: groups.length > 0,
      is_variant_of: parentGroups.length > 0,
      jsonld_variants: jsonLdVariants,
      store_api_variations: apiVariations,
      issues: pageIssues,
    };
    if (!appearsVariable) continue;
    variable += 1;
    if (jsonLdVariants > 0 || parentGroups.length > 0 || apiVariations > 0) modeled += 1;
    if (pageIssues.length > 0) issues.push(`${pageIssues.join(', ')} on ${page.url}`);
  }
  const evidence = { pages: perPage, modeled, variable, unfetched: unfetched(target, pages) };
  if (variable === 0) {
    return skip(
      'not_applicable',
      `no sampled product appears variable${fetchNote(target, pages)}`,
      evidence,
    );
  }
  const outcome = outcomeForRatio(
    modeled,
    variable,
    `${modeled} of ${variable} variable product(s) expose variants as a ProductGroup with hasVariant, a Product with isVariantOf, or Store API variations${fetchNote(target, pages)}`,
    evidence,
    0,
  );
  if (issues.length === 0) return outcome;
  return {
    ...outcome,
    verdict: outcome.verdict === 'pass' ? 'warn' : outcome.verdict,
    message: `${outcome.message ?? ''}; ${issues.join('; ')}`,
  };
});

/** The nodes of `type` found under `key` on any of the carriers. */
function valuesOf(nodes: JsonLdNode[], key: string, type: string): JsonLdNode[] {
  return nodes.flatMap((node) => nodesOf(node, key).filter((value) => hasType(value, type)));
}

/** Google's required MerchantReturnPolicy fields: a link, or country plus category (plus days for a finite window). */
function returnPolicyGaps(policy: JsonLdNode): string[] {
  if (asString(policy.merchantReturnLink) !== null) return [];
  const gaps: string[] = [];
  if (
    asString(policy.applicableCountry) === null &&
    nodesOf(policy, 'applicableCountry').length === 0
  )
    gaps.push('applicableCountry');
  const category = asString(policy.returnPolicyCategory);
  if (category === null) gaps.push('returnPolicyCategory');
  else if (
    category.endsWith('MerchantReturnFiniteReturnWindow') &&
    asString(policy.merchantReturnDays) === null
  )
    gaps.push('merchantReturnDays');
  return gaps;
}

/** Google's required OfferShippingDetails fields. */
function shippingDetailsGaps(details: JsonLdNode): string[] {
  const gaps: string[] = [];
  const destinations = nodesOf(details, 'shippingDestination');
  if (
    !destinations.some(
      (place) =>
        asString(place.addressCountry) !== null || nodesOf(place, 'addressCountry').length > 0,
    )
  )
    gaps.push('shippingDestination.addressCountry');
  if (asString(details.shippingRate) === null && nodesOf(details, 'shippingRate').length === 0)
    gaps.push('shippingRate');
  if (nodesOf(details, 'deliveryTime').length === 0) gaps.push('deliveryTime');
  return gaps;
}

/** The Organization-level ShippingService needs its conditions. */
function shippingServiceGaps(service: JsonLdNode): string[] {
  return nodesOf(service, 'shippingConditions').length === 0 ? ['shippingConditions'] : [];
}

function describeGaps(
  type: string,
  nodes: JsonLdNode[],
  gapsOf: (node: JsonLdNode) => string[],
): string[] {
  const gaps = [...new Set(nodes.flatMap(gapsOf))];
  return gaps.length > 0 ? [`${type} lacks ${gaps.join(', ')}`] : [];
}

type PolicySource = 'offer' | 'organization' | null;

export const shippingAndReturnsInMarkup = defineCheck('B2.4', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  // Google documents the standard policies at Organization level (home page or product
  // page JSON-LD), with Offer-level details as the override.
  const homeOrganizations = organizationNodes(extractJsonLd(target.homeDoc).nodes);
  const perPage: Record<
    string,
    {
      offers: number;
      shipping: boolean;
      returns: boolean;
      shipping_source: PolicySource;
      returns_source: PolicySource;
      incomplete: string[];
    }
  > = {};
  let withProduct = 0;
  let considered = 0;
  let both = 0;
  let partial = 0;
  const incomplete: string[] = [];
  for (const page of pages) {
    const nodes = extractJsonLd(page.doc).nodes;
    const products = productNodes(nodes);
    if (products.length === 0) continue;
    withProduct += 1;
    const offers = products.flatMap(allOffersOf);
    // Google accepts both properties on the Offer and on the Product itself; on a
    // ProductGroup page the variants are Products too.
    const carriers = [...offers, ...products, ...products.flatMap(variantNodes)];
    const organizations = [...organizationNodes(nodes), ...homeOrganizations];
    const offerShipping = valuesOf(carriers, 'shippingDetails', 'OfferShippingDetails');
    const offerReturns = valuesOf(carriers, 'hasMerchantReturnPolicy', 'MerchantReturnPolicy');
    const orgShipping = valuesOf(organizations, 'hasShippingService', 'ShippingService');
    const orgReturns = valuesOf(organizations, 'hasMerchantReturnPolicy', 'MerchantReturnPolicy');
    const shippingSource: PolicySource =
      offerShipping.length > 0 ? 'offer' : orgShipping.length > 0 ? 'organization' : null;
    const returnsSource: PolicySource =
      offerReturns.length > 0 ? 'offer' : orgReturns.length > 0 ? 'organization' : null;
    const pageIncomplete = [
      ...describeGaps('OfferShippingDetails', offerShipping, shippingDetailsGaps),
      ...describeGaps('ShippingService', orgShipping, shippingServiceGaps),
      ...describeGaps('MerchantReturnPolicy', [...offerReturns, ...orgReturns], returnPolicyGaps),
    ];
    perPage[page.url] = {
      offers: offers.length,
      shipping: shippingSource !== null,
      returns: returnsSource !== null,
      shipping_source: shippingSource,
      returns_source: returnsSource,
      incomplete: pageIncomplete,
    };
    if (offers.length === 0) continue;
    considered += 1;
    if (shippingSource && returnsSource) both += 1;
    else if (shippingSource || returnsSource) partial += 1;
    for (const gap of pageIncomplete) if (!incomplete.includes(gap)) incomplete.push(gap);
  }
  if (withProduct === 0) {
    return skip('dependency_failed', 'no Product JSON-LD to inspect');
  }
  if (considered === 0) {
    return skip('dependency_failed', 'no Offer to inspect', { pages: perPage });
  }
  const organizationLevel = Object.values(perPage).some(
    (page) => page.shipping_source === 'organization' || page.returns_source === 'organization',
  );
  const evidence = {
    pages: perPage,
    complete: both,
    partial,
    total: considered,
    organization_level: organizationLevel,
    incomplete,
    unfetched: unfetched(target, pages),
  };
  const where = organizationLevel ? ' (partly at Organization level)' : '';
  const gaps = incomplete.length > 0 ? `; required fields missing: ${incomplete.join('; ')}` : '';
  const message = `${both} of ${considered} product(s) carry both shipping details (OfferShippingDetails or ShippingService) and a MerchantReturnPolicy${where}${gaps}${fetchNote(target, pages)}`;
  if (both === considered)
    return incomplete.length > 0 ? warn(message, evidence) : pass(message, evidence);
  if (both + partial > 0) return warn(message, evidence);
  return fail(message, evidence);
});

/**
 * Google Merchant Center's image minimum for every product from 2027-01-31 is 500 x 500 px;
 * 1500 x 1500 px is the recommendation.
 */
const MIN_LONGEST_SIDE = 500;
const RECOMMENDED_LONGEST_SIDE = 1500;
/** The Google crawlers Merchant Center fetches images with; a block on either drops the product from free listings. */
const IMAGE_CRAWLERS = ['Googlebot', 'Googlebot-Image'] as const;

interface ImageEvidence {
  image_url: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  longest_side: number | null;
  size_source: 'jsonld' | 'html' | null;
  head_status: number | null;
  /** The fetcher's own reason when the HEAD request ended with status 0. */
  head_error: string | null;
  /** The Google crawlers the store's robots.txt keeps from the image (same-origin images only). */
  robots_blocked_for: string[];
  issues: string[];
  /** Remarks that do not change the verdict, such as a size under the recommendation. */
  notes: string[];
  /** `inconclusive`: the image could not be checked (the HEAD request got no response). */
  verdict: 'pass' | 'warn' | 'fail' | 'inconclusive';
}

/** The Google crawlers the store's own robots.txt disallows from a same-origin image URL. */
function crawlersBlockedFrom(target: Target, url: string): string[] {
  if (!target.robots) return [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (parsed.origin !== target.origin) return [];
  const robots = target.robots;
  const path = parsed.pathname + parsed.search;
  return IMAGE_CRAWLERS.filter((token) => !isAllowed(robots, token, path));
}

export const productImageUsable = defineCheck('B2.5', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const perPage: Record<string, ImageEvidence> = {};
  const counts = { pass: 0, warn: 0, fail: 0, inconclusive: 0 };
  let belowRecommended = 0;
  for (const page of pages) {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    if (products.length === 0) continue;
    const image = products.map(imageOf).find((value) => value !== null) ?? null;
    const issues: string[] = [];
    const notes: string[] = [];
    const url =
      image?.url !== null && image?.url !== undefined && /^https?:\/\//i.test(image.url)
        ? image.url
        : null;
    if (url === null) {
      issues.push(image ? 'Product image is not an absolute http(s) URL' : 'Product has no image');
      perPage[page.url] = {
        image_url: image?.url ?? null,
        alt: null,
        width: null,
        height: null,
        longest_side: null,
        size_source: null,
        head_status: null,
        head_error: null,
        robots_blocked_for: [],
        issues,
        notes,
        verdict: 'fail',
      };
      counts.fail += 1;
      continue;
    }
    const tag = page.doc.productImage(page.url, url);
    const alt = tag?.alt ?? null;
    if (tag === null) issues.push('not rendered as an img on the page');
    else if (!alt) issues.push('no alt text on the rendered img');
    let width = image?.width ?? null;
    let height = image?.height ?? null;
    let sizeSource: ImageEvidence['size_source'] = (width ?? height) ? 'jsonld' : null;
    if (sizeSource === null && tag && (tag.width ?? tag.height)) {
      width = tag.fullWidth ?? tag.width;
      height = tag.fullHeight ?? tag.height;
      sizeSource = 'html';
    }
    const longest = Math.max(width ?? 0, height ?? 0) || null;
    let headStatus: number | null = null;
    let headError: string | null = null;
    let resolves: boolean | null = true;
    // One HEAD per product at most, and only when no attribute told us the size already.
    if (longest === null) {
      const response = await fetcher.fetch(url, { method: 'HEAD' });
      headStatus = response.status;
      if (response.status === 0) {
        // The scanner got no answer: a transport failure or a URL it would not fetch. That
        // says nothing about the image, so it is recorded, not scored.
        headError = describeFailure(response);
        resolves = null;
        issues.push(`could not be checked (${headError})`);
      } else {
        resolves = isOk(response);
        if (!resolves) issues.push(`did not resolve (${describeFailure(response)})`);
      }
    }
    if (longest !== null && longest < MIN_LONGEST_SIDE)
      issues.push(`longest side is ${longest} px, below ${MIN_LONGEST_SIDE} px`);
    else if (longest !== null && longest < RECOMMENDED_LONGEST_SIDE) {
      notes.push(`longest side is ${longest} px; Google recommends ${RECOMMENDED_LONGEST_SIDE} px`);
      belowRecommended += 1;
    }
    const blockedFor = crawlersBlockedFrom(target, url);
    if (blockedFor.length > 0)
      issues.push(
        `robots.txt blocks ${blockedFor.join(' and ')} from the image (products whose images are blocked stop showing in free listings)`,
      );
    const verdict: ImageEvidence['verdict'] =
      resolves === false
        ? 'fail'
        : resolves === null && issues.length === 1
          ? 'inconclusive'
          : issues.length > 0
            ? 'warn'
            : 'pass';
    counts[verdict] += 1;
    perPage[page.url] = {
      image_url: url,
      alt,
      width,
      height,
      longest_side: longest,
      size_source: sizeSource,
      head_status: headStatus,
      head_error: headError,
      robots_blocked_for: blockedFor,
      issues,
      notes,
      verdict,
    };
  }
  const scored = counts.pass + counts.warn + counts.fail;
  const considered = scored + counts.inconclusive;
  if (considered === 0) {
    return skip('dependency_failed', 'no Product JSON-LD to inspect');
  }
  const evidence = {
    pages: perPage,
    ...counts,
    total: considered,
    below_recommended: belowRecommended,
    min_longest_side: MIN_LONGEST_SIDE,
    recommended_longest_side: RECOMMENDED_LONGEST_SIDE,
    unfetched: unfetched(target, pages),
  };
  const describe = (verdicts: ImageEvidence['verdict'][]): string =>
    Object.values(perPage)
      .filter((page) => verdicts.includes(page.verdict))
      .map((page) => `${page.image_url ?? 'no image'}: ${page.issues.join(', ')}`)
      .join('; ');
  if (scored === 0) {
    return skip(
      'error',
      `no product image could be checked: ${describe(['inconclusive'])}`,
      evidence,
    );
  }
  const note = fetchNote(target, pages);
  const unchecked = counts.inconclusive > 0 ? `; ${counts.inconclusive} could not be checked` : '';
  const recommendation =
    belowRecommended > 0
      ? `; ${belowRecommended} below the recommended ${RECOMMENDED_LONGEST_SIDE} px (Google recommends 1500 px)`
      : '';
  const outcome = (verdict: 'pass' | 'warn' | 'fail', message: string): CheckOutcome => ({
    verdict,
    message,
    evidence,
  });
  if (counts.fail > 0)
    return outcome(
      'fail',
      `${counts.fail} of ${scored} product image(s) unusable: ${describe(['fail'])}${unchecked}${recommendation}${note}`,
    );
  if (counts.warn > 0)
    return outcome(
      'warn',
      `${counts.warn} of ${scored} product image(s) need attention: ${describe(['warn'])}${unchecked}${recommendation}${note}`,
    );
  return outcome(
    'pass',
    `all ${scored} product image(s) resolve with alt text${unchecked}${recommendation}${note}`,
  );
});

const OUT_OF_STOCK_TEXT = /out of stock|sold out|ausverkauft|nicht vorrätig|épuisé|agotado/i;
const IN_STOCK_VALUES = new Set(['instock', 'limitedavailability', 'onlineonly', 'instoreonly']);
const OUT_OF_STOCK_VALUES = new Set(['outofstock', 'soldout', 'discontinued']);
const VISIBLE_PRICES_IN_EVIDENCE = 10;
/** Elements whose class names a price block: `price`, `product-price`, `price__sale`, `compare-at-price`. */
const PRICE_CLASS = /(?:^|[\s_-])price(?:$|[\s_-])/i;
const PRICE_ELEMENT_LIMIT = 50;

type Stock = 'in_stock' | 'out_of_stock' | 'unknown';

function availabilityName(value: unknown): string | null {
  const text = asString(value);
  return text ? text.replace(/^https?:\/\/schema\.org\//i, '') : null;
}

/** What the markup claims: in stock when any offer is purchasable, out when every offer is out. */
function markupStock(availability: string[]): Stock {
  const names = availability.map((name) => name.toLowerCase());
  if (names.some((name) => IN_STOCK_VALUES.has(name))) return 'in_stock';
  if (names.length > 0 && names.every((name) => OUT_OF_STOCK_VALUES.has(name)))
    return 'out_of_stock';
  return 'unknown';
}

/** What the page shows: an add-to-cart control wins over out-of-stock wording elsewhere. */
function visibleStock(addToCart: boolean, outOfStockText: boolean): Stock {
  if (addToCart) return 'in_stock';
  if (outOfStockText) return 'out_of_stock';
  return 'unknown';
}

/**
 * `visible`: a markup price appears in the page text. `contradicted`: it does not, and the
 * page's price blocks show other amounts. `not_found`: it does not, and no price block
 * shows an amount the scanner can read (an unknown currency marker, a price rendered by
 * script), so nothing can be said either way.
 */
type PriceStatus = 'visible' | 'contradicted' | 'not_found';

interface MarkupPageComparison {
  markup_prices: number[];
  /** The first amounts next to a currency marker in the page text (header and footer included). */
  visible_prices: number[];
  visible_price_count: number;
  /** Amounts inside elements whose class names a price block. */
  price_element_prices: number[];
  /** The markup price found in the page text, or null. */
  matched_price: number | null;
  price_visible: boolean;
  price_status: PriceStatus;
  availability: string[];
  add_to_cart: boolean;
  out_of_stock_text: boolean;
  /** Null when either side gives no verdict (no control and no wording, or no known availability). */
  availability_match: boolean | null;
}

export const markupMatchesPage = defineCheck('B2.6', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const perPage: Record<string, MarkupPageComparison> = {};
  let compared = 0;
  const contradicted: string[] = [];
  const notFound: string[] = [];
  const availabilityMismatches: string[] = [];
  let availabilityCompared = 0;
  for (const page of pages) {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    // A ProductGroup carries its offers on the variants; compare every variant offer.
    const offers = products.flatMap(allOffersOf);
    const markupPrices = [
      ...new Set(
        offers
          .flatMap((offer) => [offer.price, offer.lowPrice, offer.highPrice])
          .map((value) => parseAmount(asString(value)))
          .filter((value): value is number => value !== null),
      ),
    ];
    if (markupPrices.length === 0) continue;
    compared += 1;
    const text = page.doc.text().slice(0, PRICE_TEXT_LIMIT);
    const visiblePrices = pricesInText(text);
    const matched = markupPrices.find((price) => amountVisible(price, visiblePrices)) ?? null;
    const priceElementPrices = [
      ...new Set(
        page.doc
          .find('*', 'class', PRICE_CLASS)
          .slice(0, PRICE_ELEMENT_LIMIT)
          .flatMap((element) => pricesInText(elementText(element))),
      ),
    ];
    const priceStatus: PriceStatus =
      matched !== null ? 'visible' : priceElementPrices.length > 0 ? 'contradicted' : 'not_found';
    const availability = offers
      .map((offer) => availabilityName(offer.availability))
      .filter((value): value is string => value !== null);
    const addToCart = page.doc
      .controls()
      .some((control) =>
        ADD_TO_CART.test(
          `${control.name ?? ''} ${control.className ?? ''} ${control.id ?? ''} ${control.value ?? ''} ${control.text}`,
        ),
      );
    const outOfStockText = OUT_OF_STOCK_TEXT.test(text);
    const claimed = markupStock(availability);
    const shown = visibleStock(addToCart, outOfStockText);
    const availabilityMatch =
      claimed === 'unknown' || shown === 'unknown' ? null : claimed === shown;
    // Keep the matched amount in the evidence even when it sits past the first ten prices
    // (site chrome often lists promotions before the product's own price).
    const shownPrices = visiblePrices.slice(0, VISIBLE_PRICES_IN_EVIDENCE);
    if (matched !== null && !amountVisible(matched, shownPrices)) {
      shownPrices.push(visiblePrices.find((price) => amountVisible(matched, [price])) ?? matched);
    }
    perPage[page.url] = {
      markup_prices: markupPrices,
      visible_prices: shownPrices,
      visible_price_count: visiblePrices.length,
      price_element_prices: priceElementPrices.slice(0, VISIBLE_PRICES_IN_EVIDENCE),
      matched_price: matched,
      price_visible: matched !== null,
      price_status: priceStatus,
      availability,
      add_to_cart: addToCart,
      out_of_stock_text: outOfStockText,
      availability_match: availabilityMatch,
    };
    if (priceStatus === 'contradicted') contradicted.push(page.url);
    if (priceStatus === 'not_found') notFound.push(page.url);
    if (availabilityMatch !== null) availabilityCompared += 1;
    if (availabilityMatch === false) availabilityMismatches.push(page.url);
  }
  if (compared === 0) {
    return skip('dependency_failed', 'no Offer with a price to compare against the page');
  }
  const evidence = {
    pages: perPage,
    compared,
    price_contradictions: contradicted,
    price_not_found: notFound,
    availability_compared: availabilityCompared,
    availability_mismatches: availabilityMismatches,
    unfetched: unfetched(target, pages),
  };
  const note = fetchNote(target, pages);
  const availabilitySummary =
    availabilityCompared === compared
      ? `availability matches on ${availabilityCompared}`
      : availabilityCompared === 0
        ? `availability could not be compared on ${compared}`
        : `availability matches on ${availabilityCompared} and could not be compared on ${compared - availabilityCompared}`;
  if (contradicted.length > 0) {
    const detail = contradicted
      .map((url) => {
        const page = perPage[url];
        return `${url} shows ${page?.price_element_prices.join(', ') ?? '?'} while the markup says ${page?.markup_prices.join(', ') ?? '?'}`;
      })
      .join('; ');
    return fail(
      `the visible price contradicts the JSON-LD price on ${contradicted.length} of ${compared} product page(s): ${detail}${note}`,
      evidence,
    );
  }
  if (notFound.length > 0) {
    return warn(
      `the JSON-LD price is not among the prices visible on ${notFound.length} of ${compared} product page(s) (no readable price block contradicts it either); price matches on ${compared - notFound.length}${note}`,
      evidence,
    );
  }
  if (availabilityMismatches.length > 0) {
    return warn(
      `price matches on ${compared} product page(s), but the JSON-LD availability contradicts the add-to-cart state on ${availabilityMismatches.length}${note}`,
      evidence,
    );
  }
  return pass(
    `price matches on ${compared} product page(s); ${availabilitySummary}${note}`,
    evidence,
  );
});
