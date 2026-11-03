/**
 * Platform scoping. Some checks read an interface only one platform has (the WooCommerce
 * Store API, Shopify's agent surface, Magento's GraphQL endpoint); some fixes carry advice
 * that holds only on one platform. Both apply only when the scan recognised that platform.
 */
import type { KnownPlatform } from './platform-ids.js';
import type { Platform } from './result.js';
import type { CatalogFix, CheckDefinition, Fix, PlatformNote } from './schema.js';

export const PLATFORM_LABEL: Record<KnownPlatform, string> = {
  wordpress: 'WordPress',
  woocommerce: 'WooCommerce',
  shopify: 'Shopify',
  bigcommerce: 'BigCommerce',
  wix: 'Wix',
  magento: 'Adobe Commerce (Magento)',
  squarespace: 'Squarespace',
  square: 'Square Online',
  prestashop: 'PrestaShop',
  salesforce: 'Salesforce Commerce Cloud',
  shopware: 'Shopware',
  ecwid: 'Ecwid',
  webflow: 'Webflow',
};

/** Platforms another platform runs on: WooCommerce is a WordPress plugin. */
const RUNS_ON: Partial<Record<KnownPlatform, KnownPlatform>> = { woocommerce: 'wordpress' };

/** The platform's name for a person, or null when the scan recognised none. */
export function platformLabel(platform: Platform | undefined): string | null {
  return platform === undefined || platform === 'unknown' ? null : PLATFORM_LABEL[platform];
}

/**
 * True when something meant for `required` holds on a target running `platform`: the
 * same platform, or the platform it runs on (a WordPress check runs on a WooCommerce store).
 */
export function platformMatches(required: KnownPlatform, platform: Platform | undefined): boolean {
  if (platform === undefined || platform === 'unknown') return false;
  return required === platform || RUNS_ON[platform] === required;
}

/** The detected platforms on which something meant for `required` holds. */
export function platformsMatching(required: KnownPlatform): KnownPlatform[] {
  return (Object.keys(PLATFORM_LABEL) as KnownPlatform[]).filter((platform) =>
    platformMatches(required, platform),
  );
}

/** The platform notes of a fix that hold on the detected platform, in catalog order. */
export function notesFor(fix: CatalogFix, platform: Platform | undefined): PlatformNote[] {
  return fix.platform_notes.filter((note) => platformMatches(note.platform, platform));
}

/**
 * The fix as a result carries it: platform-neutral text, with the advice for the detected
 * platform appended to the agent prompt. An unknown platform gets the neutral text only.
 */
export function fixForPlatform(fix: CatalogFix | Fix, platform: Platform | undefined): Fix {
  const notes = 'platform_notes' in fix ? notesFor(fix, platform) : [];
  const resolved: Fix = {
    summary: fix.summary,
    ...(fix.snippet !== undefined ? { snippet: fix.snippet } : {}),
    ...(fix.snippet_language !== undefined ? { snippet_language: fix.snippet_language } : {}),
    agent_prompt: [
      fix.agent_prompt,
      ...notes.map((note) => `On ${PLATFORM_LABEL[note.platform]}: ${note.text}`),
    ].join(' '),
    auto_fix: fix.auto_fix,
  };
  return resolved;
}

/** The platform a check is bound to, or null for a check that runs on any platform. */
export function requiredPlatform(check: Pick<CheckDefinition, 'requires'>): KnownPlatform | null {
  return (
    check.requires.find(
      (req): req is KnownPlatform => req !== 'products' && req in PLATFORM_LABEL,
    ) ?? null
  );
}

/**
 * True for a check bound to a platform the target does not run, such as a Shopify check
 * on a WooCommerce store. It never runs there and rendered reports leave it out.
 */
export function forOtherPlatform(
  check: Pick<CheckDefinition, 'requires'>,
  platform: Platform,
): boolean {
  const required = requiredPlatform(check);
  return required !== null && !platformMatches(required, platform);
}
