import {
  llmsTxtLinksToCatalog,
  llmsTxtPresent,
  productUrlsInSitemap,
  robotsTxtExists,
  sitemapReachable,
} from './a1/index.js';
import {
  honestFetchNotBlocked,
  noAnswerExclusionDirectives,
  searchCrawlersAllowed,
  trainingPolicyStated,
  userFetchersAllowed,
} from './a2/index.js';
import {
  accessibleMainContent,
  canonicalAndHreflang,
  pageWeightAndResponseTime,
  serverRenderedProductContent,
} from './a3/index.js';
import {
  sitemapMatchesStoreApi,
  storeApiNotRateLimited,
  storeApiProductComplete,
  storeApiReachable,
  woocommerceDetected,
} from './b1/index.js';
import {
  offerComplete,
  productImageUsable,
  productJsonLd,
  shippingAndReturnsInMarkup,
  variantsModeled,
} from './b2/index.js';
import {
  brandEntity,
  gtinPresent,
  gtinValid,
  mpnWhenGtinAbsent,
  skuPresentAndUnique,
} from './b3/index.js';
import {
  contactChannel,
  merchantIdentity,
  policyPagesAgentReadable,
  privacyAndTermsFound,
  returnPolicyFound,
  securityTxt,
  shippingPolicyFound,
} from './b4/index.js';
import { guestCheckoutAndCartApi } from './b5/index.js';
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
  trainingPolicyStated,
  searchCrawlersAllowed,
  honestFetchNotBlocked,
  userFetchersAllowed,
  noAnswerExclusionDirectives,
  serverRenderedProductContent,
  pageWeightAndResponseTime,
  canonicalAndHreflang,
  accessibleMainContent,
  woocommerceDetected,
  storeApiReachable,
  storeApiNotRateLimited,
  storeApiProductComplete,
  sitemapMatchesStoreApi,
  productJsonLd,
  offerComplete,
  variantsModeled,
  shippingAndReturnsInMarkup,
  productImageUsable,
  gtinPresent,
  gtinValid,
  brandEntity,
  mpnWhenGtinAbsent,
  skuPresentAndUnique,
  returnPolicyFound,
  shippingPolicyFound,
  privacyAndTermsFound,
  merchantIdentity,
  contactChannel,
  policyPagesAgentReadable,
  securityTxt,
  guestCheckoutAndCartApi,
];

export function implementedCheckIds(checks: readonly Check[] = builtInChecks): string[] {
  return checks.map((check) => check.id);
}
