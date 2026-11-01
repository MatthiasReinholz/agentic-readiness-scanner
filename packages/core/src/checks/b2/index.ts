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
  productNodes,
  variantNodes,
} from '../../parsers/jsonld.js';
import { amountVisible, parseAmount, PRICE_TEXT_LIMIT, pricesInText } from '../../parsers/price.js';
import type { Target } from '../../target/types.js';
import {
  ADD_TO_CART,
  describeFailure,
  permalinkKey,
  type ProductPage,
  readableProductPages,
  storeApiProductsByPermalink,
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

/** The sampled product URLs that answered with no readable page (status 0, 4xx or 5xx). */
function unfetched(target: Target, pages: ProductPage[]): string[] {
  const read = new Set(pages.map((page) => page.url));
  return target.sampled.products.filter((url) => !read.has(url));
}

/** "; 1 of 2 sampled page(s) could not be fetched" when some pages failed, else empty. */
function fetchNote(target: Target, pages: ProductPage[]): string {
  const failed = unfetched(target, pages).length;
  if (failed === 0) return '';
  return `; ${failed} of ${target.sampled.products.length} sampled page(s) could not be fetched`;
}

export const productJsonLd = defineCheck('B2.1', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
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
    `${withProduct} of ${pages.length} sampled product page(s) carry Product JSON-LD${fetchNote(target, pages)}`,
    {
      pages: perPage,
      with_product: withProduct,
      total: pages.length,
      unfetched: unfetched(target, pages),
    },
    0,
  );
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
}

export const offerComplete = defineCheck('B2.2', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const perPage: Record<string, OfferEvidence> = {};
  let products = 0;
  let completeProducts = 0;
  let offers = 0;
  let completeOffers = 0;
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
    perPage[page.url] = {
      offers: all.length,
      own_offers: own.length,
      variant_offers: variant.length,
      complete_offers: complete,
      price: all.length > 0 && all.every(hasPrice),
      currency: all.length > 0 && all.every(hasCurrency),
      availability: all.length > 0 && all.every(hasAvailability),
    };
    offers += all.length;
    completeOffers += complete;
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
  if (completeProducts === products) {
    return pass(
      `all ${offers} offer(s) on ${products} product(s) carry price, currency and schema.org availability${where}${note}`,
      evidence,
    );
  }
  const message = `${completeOffers} of ${offers} offer(s) on ${products} product(s) carry price, currency and schema.org availability${where}; missing: ${gaps}${note}`;
  return completeOffers > 0 ? warn(message, evidence) : fail(message, evidence);
});

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
    const jsonLdVariants = groups.reduce((sum, group) => sum + variantNodes(group).length, 0);
    // A ProductGroup with variants is itself evidence of a variable product, whatever the
    // theme renders: Shopify's native markup carries it with no WooCommerce-style form.
    if (jsonLdVariants > 0) signals.push('jsonld:ProductGroup.hasVariant');
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
  const evidence = { pages: perPage, modeled, variable, unfetched: unfetched(target, pages) };
  if (variable === 0) {
    return skip(
      'not_applicable',
      `no sampled product appears variable${fetchNote(target, pages)}`,
      evidence,
    );
  }
  return outcomeForRatio(
    modeled,
    variable,
    `${modeled} of ${variable} variable product(s) expose variants as a ProductGroup with hasVariant or Store API variations${fetchNote(target, pages)}`,
    evidence,
    0,
  );
});

/** True when any node carries `key` with a value of the given schema.org type. */
function carries(nodes: JsonLdNode[], key: string, type: string): boolean {
  return nodes.some((node) => nodesOf(node, key).some((value) => hasType(value, type)));
}

export const shippingAndReturnsInMarkup = defineCheck('B2.4', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const perPage: Record<string, { offers: number; shipping: boolean; returns: boolean }> = {};
  let withProduct = 0;
  let considered = 0;
  let both = 0;
  let partial = 0;
  for (const page of pages) {
    const products = productNodes(extractJsonLd(page.doc).nodes);
    if (products.length === 0) continue;
    withProduct += 1;
    const offers = products.flatMap(allOffersOf);
    // Google accepts both properties on the Offer and, more recently, on the Product itself;
    // on a ProductGroup page the variants are Products too.
    const carriers = [...offers, ...products, ...products.flatMap(variantNodes)];
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
  const evidence = {
    pages: perPage,
    complete: both,
    partial,
    total: considered,
    unfetched: unfetched(target, pages),
  };
  const message = `${both} of ${considered} product(s) carry both OfferShippingDetails and MerchantReturnPolicy${fetchNote(target, pages)}`;
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
  /** The fetcher's own reason when the HEAD request ended with status 0. */
  head_error: string | null;
  issues: string[];
  /** `inconclusive`: the image could not be checked (the HEAD request got no response). */
  verdict: 'pass' | 'warn' | 'fail' | 'inconclusive';
}

export const productImageUsable = defineCheck('B2.5', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const perPage: Record<string, ImageEvidence> = {};
  const counts = { pass: 0, warn: 0, fail: 0, inconclusive: 0 };
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
        head_error: null,
        issues,
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
      issues,
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
    min_longest_side: MIN_LONGEST_SIDE,
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
  const outcome = (verdict: 'pass' | 'warn' | 'fail', message: string): CheckOutcome => ({
    verdict,
    message,
    evidence,
  });
  if (counts.fail > 0)
    return outcome(
      'fail',
      `${counts.fail} of ${scored} product image(s) unusable: ${describe(['fail'])}${unchecked}${note}`,
    );
  if (counts.warn > 0)
    return outcome(
      'warn',
      `${counts.warn} of ${scored} product image(s) need attention: ${describe(['warn'])}${unchecked}${note}`,
    );
  return outcome('pass', `all ${scored} product image(s) resolve with alt text${unchecked}${note}`);
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
