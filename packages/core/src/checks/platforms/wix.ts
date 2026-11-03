import { defineCheck, fail, pass, skip, warn } from '../types.js';
import { probePlatformMcp } from './mcp-probe.js';

/** Wix documents a site MCP server at this path on every site, without authentication. */
export const WIX_SITE_MCP_PATH = '/_api/mcp';

export const wixSiteMcp = defineCheck('A4.8', async ({ target, fetcher }) => {
  const endpoint = `${target.origin}${WIX_SITE_MCP_PATH}`;
  const { probe, state } = await probePlatformMcp(fetcher, endpoint);
  const evidence = { ...probe };
  switch (state) {
    case 'live':
      return pass(
        `the Wix site MCP server answers at ${WIX_SITE_MCP_PATH} (${probe.detail})`,
        evidence,
      );
    case 'robots':
      return warn(
        `the site MCP server was not called because robots.txt disallows ${WIX_SITE_MCP_PATH} for the scanner; agents that honour robots.txt are kept out too`,
        evidence,
      );
    case 'unreachable':
      return skip('error', `the site MCP request failed (${probe.detail})`, evidence);
    default:
      return fail(
        `no MCP server answers at ${WIX_SITE_MCP_PATH} (${probe.detail}), where Wix serves one for every site`,
        evidence,
      );
  }
});
