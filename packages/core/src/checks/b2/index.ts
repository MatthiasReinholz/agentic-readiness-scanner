import { isOk } from '../../http/types.js';
import {
  asString,
  extractJsonLd,
  hasType,
  imageOf,
  type JsonLdNode,
  nodesOf,
  offersOf,
  productNodes,
  variantNodes,
  variantsOf,
} from '../../parsers/jsonld.js';
import { permalinkKey, productPages, storeApiProductsByPermalink } from '../shared.js';
import {
  type CheckOutcome,
  defineCheck,
  fail,
  outcomeForRatio,
  pass,
  skip,
  warn,
} from '../types.js';
import { amountVisible, parseAmount, PRICE_TEXT_LIMIT, pricesInText } from '../../parsers/price.js';

export const productJsonLd = defineCheck('B2.1', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<
    string,
    { product_nodes: number; types: string[]; parse_errors: string[] }
  > = {};
  let withProduct = 0;
  for (const page of pages) {
    const { nodes, errors } = extractJsonLd(page.doc);
    const products = productNodes(nodes);
    perPage[page.url] = {
      product_nodes: products.length,
      types: products.map((node) => String(node['@type'])),
      parse_errors: errors,
    };
    if (products.length > 0) withProduct += 1;
  }
  return outcomeForRatio(
    withProduct,
    pages.length,
    `${withProduct} of ${pages.length} sampled product page(s) carry Product JSON-LD`,
    { pages: perPage, with_product: withProduct, total: pages.length },
    0,
  );
});

const AVAILABILITY =
  /^https?:\/\/schema\.org\/(InStock|OutOfStock|PreOrder|BackOrder|Discontinued|InStoreOnly|LimitedAvailability|OnlineOnly|PreSale|SoldOut)$/;

export const offerComplete = defineCheck('B2.2', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<
    string,
    { offers: number; price: boolean; currency: boolean; availability: boolean }
  > = {};
  let complete = 0;
  let considered = 0;
  for (const page of pages) {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    if (products.length === 0) continue;
    considered += 1;
    const offers = products.flatMap(offersOf);
    const price = offers.some(
      (offer) => asString(offer.price) !== null || asString(offer.lowPrice) !== null,
    );
    const currency = offers.some((offer) => asString(offer.priceCurrency) !== null);
    const availability = offers.some((offer) =>
      AVAILABILITY.test(asString(offer.availability) ?? ''),
    );
    perPage[page.url] = { offers: offers.length, price, currency, availability };
    if (price && currency && availability) complete += 1;
  }
  // Pages exist but none carries Product JSON-LD: that is B2.1's failure, not a missing target.
  if (considered === 0) {
    return skip('dependency_failed', 'no Product JSON-LD to inspect');
  }
  return outcomeForRatio(
    complete,
    considered,
    `${complete} of ${considered} product(s) have an Offer with price, currency and schema.org availability`,
    { pages: perPage, complete, total: considered },
    0,
  );
});

export const variantsModeled = defineCheck('B2.3', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const api = await storeApiProductsByPermalink(target, fetcher);
  const perPage: Record<
    string,
    {
      appears_variable: boolean;
      signals: string[];
      product_group: boolean;
      jsonld_variants: number;
      store_api_variations: number;
    }
  > = {};
  let variable = 0;
  let modeled = 0;
  for (const page of pages) {
    const apiProduct = api.get(permalinkKey(page.url));
    const signals = page.doc.variationFormSignals();
    if (apiProduct?.type === 'variable') signals.push('store-api:type=variable');
    const groups = productNodes(extractJsonLd(page.doc).nodes).filter((node) =>
      hasType(node, 'ProductGroup'),
    );
    const jsonLdVariants = groups.reduce((sum, group) => sum + variantsOf(group).length, 0);
    const apiVariations = Array.isArray(apiProduct?.variations) ? apiProduct.variations.length : 0;
    const appearsVariable = signals.length > 0;
    perPage[page.url] = {
      appears_variable: appearsVariable,
      signals,
      product_group: groups.length > 0,
      jsonld_variants: jsonLdVariants,
      store_api_variations: apiVariations,
    };
    if (!appearsVariable) continue;
    variable += 1;
    if (jsonLdVariants > 0 || apiVariations > 0) modeled += 1;
  }
  if (variable === 0) {
    return skip('not_applicable', 'no sampled product appears variable', { pages: perPage });
  }
  return outcomeForRatio(
    modeled,
    variable,
    `${modeled} of ${variable} variable product(s) expose variants as a ProductGroup with hasVariant or Store API variations`,
    { pages: perPage, modeled, variable },
    0,
  );
});

/** True when any node carries `key` with a value of the given schema.org type. */
function carries(nodes: JsonLdNode[], key: string, type: string): boolean {
  return nodes.some((node) => nodesOf(node, key).some((value) => hasType(value, type)));
}

export const shippingAndReturnsInMarkup = defineCheck('B2.4', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<string, { offers: number; shipping: boolean; returns: boolean }> = {};
  let withProduct = 0;
  let considered = 0;
  let both = 0;
  let partial = 0;
  for (const page of pages) {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    if (products.length === 0) continue;
    withProduct += 1;
    const offers = products.flatMap(offersOf);
    // Google accepts both properties on the Offer and, more recently, on the Product itself.
    const carriers = [...offers, ...products];
    const shipping = carries(carriers, 'shippingDetails', 'OfferShippingDetails');
    const returns = carries(carriers, 'hasMerchantReturnPolicy', 'MerchantReturnPolicy');
    perPage[page.url] = { offers: offers.length, shipping, returns };
    if (offers.length === 0) continue;
    considered += 1;
    if (shipping && returns) both += 1;
    else if (shipping || returns) partial += 1;
  }
  if (withProduct === 0) {
    return skip('dependency_failed', 'no Product JSON-LD to inspect');
  }
  if (considered === 0) {
    return skip('dependency_failed', 'no Offer to inspect', { pages: perPage });
  }
  const evidence = { pages: perPage, complete: both, partial, total: considered };
  const message = `${both} of ${considered} product(s) carry both OfferShippingDetails and MerchantReturnPolicy`;
  if (both === considered) return pass(message, evidence);
  if (both + partial > 0) return warn(message, evidence);
  return fail(message, evidence);
});

/** Google Merchant Center asks for at least 800 px on the longest side for apparel; 100 px otherwise. */
const MIN_LONGEST_SIDE = 800;

interface ImageEvidence {
  image_url: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  longest_side: number | null;
  size_source: 'jsonld' | 'html' | null;
  head_status: number | null;
  issues: string[];
  verdict: 'pass' | 'warn' | 'fail';
}

export const productImageUsable = defineCheck('B2.5', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<string, ImageEvidence> = {};
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const page of pages) {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    if (products.length === 0) continue;
    const image = products.map(imageOf).find((value) => value !== null) ?? null;
    const issues: string[] = [];
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
        issues,
        verdict: 'fail',
      };
      counts.fail += 1;
      continue;
    }
    const tag = page.doc.productImage(page.url, url);
    const alt = tag?.alt ?? null;
    if (tag === null) issues.push('no rendered img matches the Product image');
    else if (!alt) issues.push('rendered img has no alt text');
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
    let resolves = true;
    // One HEAD per product at most, and only when no attribute told us the size already.
    if (longest === null) {
      const response = await fetcher.fetch(url, { method: 'HEAD' });
      headStatus = response.status;
      resolves = isOk(response);
      if (!resolves) issues.push(`image does not resolve (HEAD ${response.status})`);
    }
    if (longest !== null && longest < MIN_LONGEST_SIDE)
      issues.push(`longest side is ${longest} px, below ${MIN_LONGEST_SIDE} px`);
    const verdict: ImageEvidence['verdict'] = !resolves
      ? 'fail'
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
      issues,
      verdict,
    };
  }
  const considered = counts.pass + counts.warn + counts.fail;
  if (considered === 0) {
    return skip('dependency_failed', 'no Product JSON-LD to inspect');
  }
  const evidence = {
    pages: perPage,
    ...counts,
    total: considered,
    min_longest_side: MIN_LONGEST_SIDE,
  };
  const outcome = (verdict: 'pass' | 'warn' | 'fail', message: string): CheckOutcome => ({
    verdict,
    message,
    evidence,
  });
  if (counts.fail > 0)
    return outcome('fail', `${counts.fail} of ${considered} product(s) have no usable image`);
  if (counts.warn > 0)
    return outcome(
      'warn',
      `${counts.warn} of ${considered} product image(s) lack alt text or ${MIN_LONGEST_SIDE} px resolution`,
    );
  return outcome('pass', `all ${considered} product image(s) resolve with alt text`);
});

const ADD_TO_CART = /add[-_ ]?to[-_ ]?cart|single_add_to_cart_button|buy now/i;
const OUT_OF_STOCK_TEXT = /out of stock|sold out|ausverkauft|nicht vorrätig|épuisé|agotado/i;
const IN_STOCK_VALUES = new Set(['instock', 'limitedavailability', 'onlineonly', 'instoreonly']);
const OUT_OF_STOCK_VALUES = new Set(['outofstock', 'soldout', 'discontinued']);
const VISIBLE_PRICES_IN_EVIDENCE = 10;

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

interface MarkupPageComparison {
  markup_prices: number[];
  visible_prices: number[];
  price_visible: boolean;
  availability: string[];
  add_to_cart: boolean;
  out_of_stock_text: boolean;
  availability_match: boolean | null;
}

export const markupMatchesPage = defineCheck('B2.6', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<string, MarkupPageComparison> = {};
  let compared = 0;
  const priceMismatches: string[] = [];
  const availabilityMismatches: string[] = [];
  for (const page of pages) {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    // A ProductGroup carries its offers on the variants; compare every variant offer.
    const offers = products.flatMap((product) => [
      ...offersOf(product),
      ...variantNodes(product).flatMap(offersOf),
    ]);
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
    const priceVisible = markupPrices.some((price) => amountVisible(price, visiblePrices));
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
    perPage[page.url] = {
      markup_prices: markupPrices,
      visible_prices: visiblePrices.slice(0, VISIBLE_PRICES_IN_EVIDENCE),
      price_visible: priceVisible,
      availability,
      add_to_cart: addToCart,
      out_of_stock_text: outOfStockText,
      availability_match: availabilityMatch,
    };
    if (!priceVisible) priceMismatches.push(page.url);
    if (availabilityMatch === false) availabilityMismatches.push(page.url);
  }
  if (compared === 0) {
    return skip('dependency_failed', 'no Offer with a price to compare against the page');
  }
  const evidence = {
    pages: perPage,
    compared,
    price_mismatches: priceMismatches,
    availability_mismatches: availabilityMismatches,
  };
  if (priceMismatches.length > 0) {
    return fail(
      `JSON-LD price is not visible on ${priceMismatches.length} of ${compared} product page(s)`,
      evidence,
    );
  }
  if (availabilityMismatches.length > 0) {
    return warn(
      `JSON-LD availability contradicts the add-to-cart state on ${availabilityMismatches.length} of ${compared} product page(s)`,
      evidence,
    );
  }
  return pass(
    `JSON-LD price and availability match the visible page on ${compared} product page(s)`,
    evidence,
  );
});
