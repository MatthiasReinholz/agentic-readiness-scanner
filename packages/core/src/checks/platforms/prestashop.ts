import { defineCheck, pass, skip, warn } from '../types.js';

/** A product URL PrestaShop builds when Friendly URL is off: index.php?id_product=… */
const UNFRIENDLY = /(?:[?&](?:id_product|controller)=|\/index\.php(?:$|[?/]))/i;

export const prestashopFriendlyUrls = defineCheck('A3.12', ({ target }) => {
  const products = target.sampled.products;
  if (products.length === 0) {
    return skip('not_applicable', 'no product pages were found to sample', {});
  }
  const unfriendly = products.filter((url) => UNFRIENDLY.test(url));
  const evidence = { sampled: products, unfriendly };
  if (unfriendly.length === 0) {
    return pass(`all ${products.length} sampled product URLs are readable paths`, evidence);
  }
  return warn(
    `${unfriendly.length} of ${products.length} sampled product URLs are query strings such as ${unfriendly[0] ?? ''}: Friendly URL is off`,
    evidence,
  );
});
