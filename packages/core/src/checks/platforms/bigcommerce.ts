import { attribute } from '../../parsers/html.js';
import type { Target } from '../../target/types.js';
import { defineCheck, pass, skip, warn } from '../types.js';
import { probePlatformMcp } from './mcp-probe.js';

/**
 * The Storefront MCP URL the page advertises: BigCommerce's WebMCP bridge script, which
 * Cloudflare injects into eligible storefronts, names it in data-mcp-url.
 */
export function advertisedStorefrontMcp(target: Target): string | null {
  for (const script of target.homeDoc.find('script', 'src', /\/\.webmcp\/bridge\.js/)) {
    const href = attribute(script, 'data-mcp-url');
    if (!href) continue;
    try {
      const url = new URL(href, target.origin);
      if (url.origin === target.origin) return url.href;
    } catch {
      // not a URL
    }
  }
  return null;
}

export const bigcommerceStorefrontMcp = defineCheck('B5.9', async ({ target, fetcher }) => {
  const endpoint = advertisedStorefrontMcp(target);
  if (!endpoint) {
    return warn(
      'the storefront advertises no Storefront MCP server (no WebMCP bridge in the home page), so agents have no MCP endpoint to find',
      { endpoint: null },
    );
  }
  const { probe, state } = await probePlatformMcp(fetcher, endpoint);
  const evidence = { ...probe };
  switch (state) {
    case 'live':
      return pass(
        `the Storefront MCP server the page advertises answers (${probe.detail}); agents can search, fill a cart and hand off to checkout`,
        evidence,
      );
    case 'robots':
      return warn(
        `the Storefront MCP server was not called because robots.txt disallows ${new URL(endpoint).pathname} for the scanner`,
        evidence,
      );
    case 'unreachable':
      return skip('error', `the Storefront MCP request failed (${probe.detail})`, evidence);
    default:
      return warn(
        `the page's WebMCP bridge points at ${new URL(endpoint).pathname}, but no MCP server answers there (${probe.detail}): Storefront MCP is switched off, so browser agents get the bridge without its shopping tools`,
        evidence,
      );
  }
});
