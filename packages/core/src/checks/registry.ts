import {
  llmsTxtLinksToCatalog,
  llmsTxtPresent,
  productUrlsInSitemap,
  robotsTxtExists,
  sitemapReachable,
} from './a1/index.js';
import {
  aiCrawlerRulesExplicit,
  noIndexingRestrictionsOnProducts,
  shoppingAgentsAllowed,
} from './a2/index.js';
import { serverRenderedProductContent } from './a3/index.js';
import { storeApiReachable, woocommerceDetected } from './b1/index.js';
import { offerComplete, productJsonLd } from './b2/index.js';
import { gtinPresent, gtinValid } from './b3/index.js';
import {
  privacyAndTermsFound,
  returnPolicyFound,
  securityTxt,
  shippingPolicyFound,
} from './b4/index.js';
import type { Check } from './types.js';

/**
 * Every implemented check. Catalog entries without an implementation here are reported
 * as skipped with reason `not_implemented`, so a report never claims more than it tested.
 */
export const builtInChecks: readonly Check[] = [
  robotsTxtExists,
  sitemapReachable,
  productUrlsInSitemap,
  llmsTxtPresent,
  llmsTxtLinksToCatalog,
  aiCrawlerRulesExplicit,
  shoppingAgentsAllowed,
  noIndexingRestrictionsOnProducts,
  serverRenderedProductContent,
  woocommerceDetected,
  storeApiReachable,
  productJsonLd,
  offerComplete,
  gtinPresent,
  gtinValid,
  returnPolicyFound,
  shippingPolicyFound,
  privacyAndTermsFound,
  securityTxt,
];

export function implementedCheckIds(checks: readonly Check[] = builtInChecks): string[] {
  return checks.map((check) => check.id);
}
