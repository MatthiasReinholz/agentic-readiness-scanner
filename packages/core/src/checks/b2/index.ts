import {
  asString,
  extractJsonLd,
  offersOf,
  productNodes,
  variantNodes,
} from '../../parsers/jsonld.js';
import { amountVisible, parseAmount, pricesInText, PRICE_TEXT_LIMIT } from '../../parsers/price.js';
import { productPages } from '../shared.js';
import { defineCheck, fail, outcomeForRatio, pass, skip, warn } from '../types.js';

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
