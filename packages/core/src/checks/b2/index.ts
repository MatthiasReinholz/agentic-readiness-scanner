import { asString, extractJsonLd, offersOf, productNodes } from '../../parsers/jsonld.js';
import { productPages } from '../shared.js';
import { defineCheck, fail, pass, skip, verdictForRatio, warn } from '../types.js';

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
  const verdict = verdictForRatio(withProduct, pages.length, 0);
  const evidence = { pages: perPage, with_product: withProduct, total: pages.length };
  const message = `${withProduct} of ${pages.length} sampled product page(s) carry Product JSON-LD`;
  if (verdict === 'pass') return pass(message, evidence);
  if (verdict === 'warn') return warn(message, evidence);
  return fail(message, evidence);
});

const AVAILABILITY =
  /^https?:\/\/schema\.org\/(InStock|OutOfStock|PreOrder|BackOrder|Discontinued|InStoreOnly|LimitedAvailability|OnlineOnly|PreSale|SoldOut)$/;

export const offerComplete = defineCheck('B2.2', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
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
  if (considered === 0) {
    return skip('dependency_failed', 'no Product JSON-LD to inspect');
  }
  const verdict = verdictForRatio(complete, considered, 0);
  const evidence = { pages: perPage, complete, total: considered };
  const message = `${complete} of ${considered} product(s) have an Offer with price, currency and schema.org availability`;
  if (verdict === 'pass') return pass(message, evidence);
  if (verdict === 'warn') return warn(message, evidence);
  return fail(message, evidence);
});
