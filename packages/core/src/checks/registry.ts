import {
  linkResponseHeaders,
  llmsTxtLinksToCatalog,
  llmsTxtPresent,
  productUrlsInSitemap,
  robotsTxtExists,
  sitemapLastmodPlausible,
  sitemapReachable,
  listingLinksProductsAndPages,
} from './a1/index.js';
import {
  honestFetchNotBlocked,
  noAnswerExclusionDirectives,
  searchCrawlersAllowed,
  trainingPolicyStated,
  usagePreferenceSignalsParse,
  userFetchersAllowed,
  renderResourcesNotBlocked,
} from './a2/index.js';
import {
  accessibleMainContent,
  canonicalAndHreflang,
  markdownCopyOfProductPages,
  pageWeightAndResponseTime,
  serverRenderedProductContent,
  unknownUrlsAnswer404,
  productUrlsAnswerDirectly,
  titleAndDescriptionPresent,
  conditionalRequestsSupported,
  mobileViewportDeclared,
} from './a3/index.js';
import { documentHeadWellFormed } from './a3/head.js';
import {
  a2aAgentCard,
  apiCatalogPublished,
  mcpEndpointReachable,
  mcpServerDiscoverable,
  oauthDiscoveryForMcp,
  webMcpToolDeclarations,
} from './a4/index.js';
import {
  feedFreshness,
  productFeedDiscoverable,
  sitemapMatchesStoreApi,
  storeApiNotRateLimited,
  storeApiProductComplete,
  storeApiReachable,
  woocommerceDetected,
} from './b1/index.js';
import { shopifyProductsJsonReadable } from './b1/shopify.js';
import {
  markupMatchesPage,
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
import {
  acpDiscoveryDocument,
  acpFeedFields,
  guestCheckoutAndCartApi,
  shopifyAgenticStorefront,
  ucpBusinessProfile,
  ucpCheckoutDeclared,
} from './b5/index.js';
import type { Check } from './types.js';

/**
 * Every implemented check. Catalog entries without an implementation here are reported
 * as skipped with reason `not_implemented`, so a report never claims more than it tested.
 */
export const builtInChecks: readonly Check[] = [
  robotsTxtExists,
  sitemapReachable,
  productUrlsInSitemap,
  linkResponseHeaders,
  llmsTxtPresent,
  llmsTxtLinksToCatalog,
  sitemapLastmodPlausible,
  listingLinksProductsAndPages,
  trainingPolicyStated,
  searchCrawlersAllowed,
  usagePreferenceSignalsParse,
  honestFetchNotBlocked,
  userFetchersAllowed,
  noAnswerExclusionDirectives,
  renderResourcesNotBlocked,
  markdownCopyOfProductPages,
  serverRenderedProductContent,
  pageWeightAndResponseTime,
  canonicalAndHreflang,
  accessibleMainContent,
  unknownUrlsAnswer404,
  productUrlsAnswerDirectly,
  titleAndDescriptionPresent,
  conditionalRequestsSupported,
  mobileViewportDeclared,
  documentHeadWellFormed,
  mcpServerDiscoverable,
  apiCatalogPublished,
  oauthDiscoveryForMcp,
  mcpEndpointReachable,
  a2aAgentCard,
  webMcpToolDeclarations,
  woocommerceDetected,
  storeApiReachable,
  storeApiNotRateLimited,
  storeApiProductComplete,
  productFeedDiscoverable,
  feedFreshness,
  sitemapMatchesStoreApi,
  shopifyProductsJsonReadable,
  productJsonLd,
  offerComplete,
  variantsModeled,
  shippingAndReturnsInMarkup,
  productImageUsable,
  markupMatchesPage,
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
  ucpBusinessProfile,
  ucpCheckoutDeclared,
  acpDiscoveryDocument,
  acpFeedFields,
  guestCheckoutAndCartApi,
  shopifyAgenticStorefront,
];

export function implementedCheckIds(checks: readonly Check[] = builtInChecks): string[] {
  return checks.map((check) => check.id);
}
