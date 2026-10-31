import { extractJsonLd, offersOf, productNodes, asString } from '../../parsers/jsonld.js';
import { productPages } from '../shared.js';
import { defineCheck, fail, pass, skip, verdictForRatio, warn } from '../types.js';

/**
 * A price in page text: a currency sign or code next to an amount. The amount pattern
 * has bounded repetitions (groups of three digits, at most two decimals) so matching
 * stays linear on pages full of numbers; the text is capped as well.
 */
const CURRENCY = '(?:[$€£¥]|USD|EUR|GBP|CHF|JPY|AUD|CAD|SEK|NOK|DKK|PLN|CZK)';
const AMOUNT = '(?:\\d{1,3}(?:[.,]\\d{3}){1,4}|\\d{1,7})(?:[.,]\\d{1,2})?';
const PRICE_TEXT = new RegExp(`${CURRENCY}\\s?${AMOUNT}|\\b${AMOUNT}\\s?${CURRENCY}`);
/** Characters of page text examined for a price; prices appear early on a product page. */
const PRICE_TEXT_LIMIT = 50_000;

export function hasPriceText(text: string): boolean {
  return PRICE_TEXT.test(text.slice(0, PRICE_TEXT_LIMIT));
}

export const serverRenderedProductContent = defineCheck('A3.2', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<
    string,
    { title: boolean; price: boolean; description: boolean; words: number }
  > = {};
  let complete = 0;
  for (const page of pages) {
    const { nodes } = extractJsonLd(page.doc);
    const products = productNodes(nodes);
    const text = page.doc.text();
    const title =
      Boolean(page.doc.title()) || products.some((product) => asString(product.name) !== null);
    const price =
      products.some((product) =>
        offersOf(product).some((offer) => asString(offer.price) !== null),
      ) ||
      hasPriceText(text) ||
      page.doc.find('*', 'class', /\bprice\b/).length > 0;
    const words = page.doc.wordCount();
    const description =
      Boolean(page.doc.meta('description')) ||
      products.some((product) => asString(product.description) !== null) ||
      words > 80;
    perPage[page.url] = { title, price, description, words };
    if (title && price && description) complete += 1;
  }
  const verdict = verdictForRatio(complete, pages.length, 0);
  const evidence = { pages: perPage, complete, total: pages.length };
  const message = `${complete} of ${pages.length} sampled product page(s) carry title, price and description in raw HTML`;
  if (verdict === 'pass') return pass(message, evidence);
  if (verdict === 'warn') return warn(message, evidence);
  return fail(message, evidence);
});
