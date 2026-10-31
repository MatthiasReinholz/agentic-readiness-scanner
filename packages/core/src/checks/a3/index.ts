import { extractJsonLd, offersOf, productNodes, asString } from '../../parsers/jsonld.js';
import { hasPriceText } from '../../parsers/price.js';
import { productPages } from '../shared.js';
import { defineCheck, outcomeForRatio, skip } from '../types.js';

/** The price-text pattern lives in parsers/price.ts; re-exported for the pattern tests. */
export { hasPriceText };

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
  return outcomeForRatio(
    complete,
    pages.length,
    `${complete} of ${pages.length} sampled product page(s) carry title, price and description in raw HTML`,
    { pages: perPage, complete, total: pages.length },
    0,
  );
});
