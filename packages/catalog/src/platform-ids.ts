/**
 * The platforms the scanner recognises, in the order reports and docs list them: the five
 * most asked about, then eight more chosen by live stores in the United States and Europe
 * and by what they document for agents (decision 0019). Kept apart from the schema files so both the catalog schema and
 * the result contract can read it without importing each other.
 */
export const KNOWN_PLATFORMS = [
  'wordpress',
  'woocommerce',
  'shopify',
  'bigcommerce',
  'wix',
  'magento',
  'squarespace',
  'square',
  'prestashop',
  'salesforce',
  'shopware',
  'ecwid',
  'webflow',
] as const;
export type KnownPlatform = (typeof KNOWN_PLATFORMS)[number];
