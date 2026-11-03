/**
 * Platform scoping. Some checks read an interface only one platform has (the WooCommerce
 * Store API, Shopify's agent surface); some fixes carry advice that holds only on one
 * platform. Both apply only when the scan detected that platform.
 */
import type { Platform } from './result.js';
import type { CatalogFix, CheckDefinition, Fix, FixPlatform, PlatformNote } from './schema.js';

export const PLATFORM_LABEL: Record<FixPlatform, string> = {
  wordpress: 'WordPress',
  woocommerce: 'WooCommerce',
  shopify: 'Shopify',
};

/** True when a note for `note` holds on `platform`: WooCommerce runs on WordPress. */
function noteHolds(note: FixPlatform, platform: Platform | undefined): boolean {
  if (note === platform) return true;
  return note === 'wordpress' && platform === 'woocommerce';
}

/** The platform notes of a fix that hold on the detected platform, in catalog order. */
export function notesFor(fix: CatalogFix, platform: Platform | undefined): PlatformNote[] {
  return fix.platform_notes.filter((note) => noteHolds(note.platform, platform));
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
export function requiredPlatform(
  check: Pick<CheckDefinition, 'requires'>,
): 'woocommerce' | 'shopify' | null {
  return check.requires.find((req) => req === 'woocommerce' || req === 'shopify') ?? null;
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
  return required !== null && required !== platform;
}
