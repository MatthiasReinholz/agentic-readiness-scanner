/**
 * Checks bound to one platform. Each runs only when the scan recognised that platform
 * (its catalog entry requires it) and rendered reports never list it elsewhere.
 */
import type { Check } from '../types.js';
import { bigcommerceStorefrontMcp } from './bigcommerce.js';
import { squarespaceAiCrawlerSetting, webflowTrafficControl } from './crawler-settings.js';
import { ecwidCleanUrls } from './ecwid.js';
import { magentoGraphqlCatalog } from './magento.js';
import { prestashopFriendlyUrls } from './prestashop.js';
import { salesforceRobotsPreset } from './salesforce.js';
import { shopwareAgenticFiles } from './shopware.js';
import { squareSearchVisibility } from './square.js';
import {
  bigcommerceStorefrontType,
  magentoStorefrontType,
  salesforceStorefrontType,
  shopifyStorefrontType,
  wordpressThemeType,
} from './technology.js';
import { wixSiteMcp } from './wix.js';
import { woocommerceCartAndCheckout } from './woocommerce-pages.js';
import { wordpressRestApiReadable, wordpressSearchVisibility } from './wordpress.js';

export const platformChecks: readonly Check[] = [
  wordpressSearchVisibility,
  squarespaceAiCrawlerSetting,
  webflowTrafficControl,
  squareSearchVisibility,
  salesforceRobotsPreset,
  prestashopFriendlyUrls,
  ecwidCleanUrls,
  wordpressRestApiReadable,
  wixSiteMcp,
  shopwareAgenticFiles,
  magentoGraphqlCatalog,
  bigcommerceStorefrontMcp,
  wordpressThemeType,
  woocommerceCartAndCheckout,
  shopifyStorefrontType,
  bigcommerceStorefrontType,
  magentoStorefrontType,
  salesforceStorefrontType,
];
