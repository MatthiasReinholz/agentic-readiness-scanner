/**
 * A2.14: rules for AI clients at the edge. A CDN or bot manager can refuse GPTBot,
 * ChatGPT-User or Claude-SearchBot by user agent while robots.txt allows them. The scanner
 * identifies itself and never sends another product's user agent (decision 0010), so it
 * cannot see such a rule. What it can see is who runs the edge, and Cloudflare's managed
 * block in robots.txt, which marks a site that uses Cloudflare's AI crawler policies. The
 * check tells the owner where to look; it is reported, never scored.
 */
import { listForProse, platformLabel, type KnownPlatform } from '@agentic-readiness/catalog';

import { cloudflareManagedRobots, edgeSignals } from '../../http/bot-management.js';
import { parseRobotsTxt } from '../../parsers/robots.js';
import { BOT_MANAGERS } from '../crawlers.js';
import { defineCheck, pass, warn } from '../types.js';

/**
 * Hosted platforms that run the CDN in front of every site they serve. Their merchants set
 * crawler rules through the platform's own settings, never in the CDN underneath.
 */
const PLATFORM_EDGES: ReadonlySet<KnownPlatform> = new Set([
  'shopify',
  'wix',
  'squarespace',
  'webflow',
  'bigcommerce',
  'square',
]);

/** The user agents Cloudflare's managed block disallows at the root. */
function managedDisallowed(block: string): string[] {
  return parseRobotsTxt(block)
    .groups.filter((group) =>
      group.rules.some((rule) => rule.type === 'disallow' && rule.pattern === '/'),
    )
    .flatMap((group) => group.agents)
    .filter((agent) => agent !== '*');
}

export const edgeAiCrawlerRules = defineCheck('A2.14', ({ target }) => {
  const signals = edgeSignals(target.home);
  const vendors = BOT_MANAGERS.filter((manager) =>
    signals.some((signal) => signal.id === manager.id),
  );
  const block =
    target.robotsResponse.status === 200
      ? cloudflareManagedRobots(target.robotsResponse.body)
      : null;
  const platform =
    target.platform !== 'unknown' && PLATFORM_EDGES.has(target.platform) ? target.platform : null;
  const settings = vendors.map((vendor) => ({
    vendor: vendor.name,
    setting: vendor.ai_setting,
    docs: vendor.docs,
  }));
  const evidence = {
    vendors: vendors.map((vendor) => vendor.id),
    signals: Object.fromEntries(signals.map((signal) => [signal.id, signal.header])),
    platform_edge: platform,
    cloudflare_managed_robots: block === null ? null : { disallowed: managedDisallowed(block) },
    settings,
  };
  const where = (list: typeof settings): string =>
    list.map((entry) => `${entry.vendor}: ${entry.setting}`).join('; ');

  if (block !== null) {
    const disallowed = evidence.cloudflare_managed_robots?.disallowed ?? [];
    const cloudflare = BOT_MANAGERS.find((manager) => manager.id === 'cloudflare');
    return warn(
      `robots.txt carries Cloudflare's managed block${disallowed.length > 0 ? `, which disallows ${listForProse(disallowed)}` : ''}, so the site uses Cloudflare's AI crawler policies. They can also refuse search crawlers and assistants' fetchers at the edge, which robots.txt does not show. Check Cloudflare: ${cloudflare?.ai_setting ?? 'its AI crawler settings'}`,
      evidence,
    );
  }
  if (platform !== null) {
    return pass(
      `${platformLabel(platform) ?? platform} runs the edge for this site. Rules for AI crawlers beyond robots.txt are the platform's, and robots.txt is what the site owner controls`,
      evidence,
    );
  }
  if (vendors.length > 0) {
    return pass(
      `served through ${listForProse(vendors.map((vendor) => vendor.name))}. Edge rules there can refuse GPTBot, ChatGPT-User and other AI clients that robots.txt allows, and no outside scan can see them. Check ${where(settings)}`,
      evidence,
    );
  }
  return pass(
    'no CDN or bot manager recognised from the response headers. One can sit in front of the site without a visible sign',
    evidence,
  );
});
