import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import { bigcommerceStorefrontMcp } from './bigcommerce.js';
import { ecwidCleanUrls } from './ecwid.js';
import {
  SQUARESPACE_AI_CRAWLERS,
  squarespaceAiCrawlerSetting,
  WEBFLOW_AI_BOTS,
  webflowTrafficControl,
} from './crawler-settings.js';
import { magentoGraphqlCatalog, MAGENTO_PRODUCT_QUERY } from './magento.js';
import { prestashopFriendlyUrls } from './prestashop.js';
import { salesforceRobotsPreset } from './salesforce.js';
import { SHOPWARE_AI_CATALOG, shopwareAgenticFiles } from './shopware.js';
import { squareSearchVisibility } from './square.js';
import { wixSiteMcp } from './wix.js';
import { restRoute, wordpressRestApiReadable, wordpressSearchVisibility } from './wordpress.js';

const ORIGIN = 'https://shop.example';
const RPC = {
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: '{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"store"}}}',
};
const block = (agents: readonly string[]) =>
  agents.map((agent) => `User-agent: ${agent}\nDisallow: /\n`).join('\n');

describe('WordPress', () => {
  it('builds routes for both REST root forms', () => {
    expect(restRoute(`${ORIGIN}/wp-json/`, 'wp/v2/pages', { per_page: '1' })).toBe(
      `${ORIGIN}/wp-json/wp/v2/pages?per_page=1`,
    );
    expect(restRoute(`${ORIGIN}/?rest_route=/`, 'wp/v2/pages', { per_page: '1' })).toBe(
      `${ORIGIN}/?rest_route=%2Fwp%2Fv2%2Fpages&per_page=1`,
    );
  });

  it('passes when the advertised REST API lists pages anonymously', async () => {
    const target = targetFor({
      platform: 'wordpress',
      homeHtml: `<html><head><link rel="https://api.w.org/" href="${ORIGIN}/api/"></head></html>`,
    });
    const fetcher = mapFetcher({
      [`${ORIGIN}/api/wp/v2/pages?per_page=1&_fields=id%2Clink`]: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '[{"id":2,"link":"https://shop.example/about/"}]',
      },
    });
    const outcome = await runCheck(wordpressRestApiReadable, target, fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ advertised: true });
  });

  it('fails when a security plugin refuses anonymous reads', async () => {
    const target = targetFor({ platform: 'wordpress' });
    const fetcher = mapFetcher({
      [`${ORIGIN}/wp-json/wp/v2/pages?per_page=1&_fields=id%2Clink`]: {
        status: 401,
        headers: { 'content-type': 'application/json' },
        body: '{"code":"rest_not_logged_in","message":"You are not currently logged in."}',
      },
    });
    const outcome = await runCheck(wordpressRestApiReadable, target, fetcher);
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('rest_not_logged_in');
  });

  it('names the Reading setting when core discourages search engines', async () => {
    const target = targetFor({
      platform: 'woocommerce',
      homeHtml: "<html><head><meta name='robots' content='noindex, nofollow' /></head></html>",
    });
    const outcome = await runCheck(wordpressSearchVisibility, target, mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('Settings > Reading > Search engine visibility');
    expect(outcome.evidence).toMatchObject({ core_setting: true });
  });

  it('ignores a noindex aimed at one crawler', async () => {
    const target = targetFor({ platform: 'wordpress' });
    target.home.headers['x-robots-tag'] = 'bingbot: noindex';
    const outcome = await runCheck(wordpressSearchVisibility, target, mapFetcher({}));
    expect(outcome.verdict).toBe('pass');
  });
});

describe('BigCommerce Storefront MCP', () => {
  const bridge = `<html><head><script src="/.webmcp/bridge.js" data-mcp-url="/api/mcp"></script></head></html>`;

  it('passes when the advertised server answers', async () => {
    const target = targetFor({ platform: 'bigcommerce', homeHtml: bridge });
    const fetcher = mapFetcher({ [`${ORIGIN}/api/mcp`]: RPC });
    const outcome = await runCheck(bigcommerceStorefrontMcp, target, fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(fetcher.log[0]?.options.method).toBe('POST');
  });

  it('falls back to the initialize handshake when the server needs a session', async () => {
    const target = targetFor({ platform: 'bigcommerce', homeHtml: bridge });
    const fetcher = mapFetcher({
      [`${ORIGIN}/api/mcp`]: [
        {
          status: 400,
          headers: { 'content-type': 'text/plain' },
          body: 'Session ID required for non-initialize methods',
          when: { method: 'POST', headers: { 'mcp-method': 'server/discover' } },
        },
        { ...RPC, when: { method: 'POST' } },
      ],
    });
    const outcome = await runCheck(bigcommerceStorefrontMcp, target, fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ method: 'POST initialize' });
    expect(fetcher.log).toHaveLength(2);
  });

  it('warns when the bridge points at a server that is off', async () => {
    const target = targetFor({ platform: 'bigcommerce', homeHtml: bridge });
    const outcome = await runCheck(bigcommerceStorefrontMcp, target, mapFetcher({}));
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toContain('Storefront MCP is switched off');
  });

  it('warns without a request when no server is advertised', async () => {
    const target = targetFor({ platform: 'bigcommerce' });
    const fetcher = mapFetcher({});
    const outcome = await runCheck(bigcommerceStorefrontMcp, target, fetcher);
    expect(outcome.verdict).toBe('warn');
    expect(fetcher.log).toHaveLength(0);
  });
});

describe('Wix site MCP', () => {
  it('passes on a JSON-RPC answer and fails when nothing answers', async () => {
    const target = targetFor({ platform: 'wix' });
    expect(
      (await runCheck(wixSiteMcp, target, mapFetcher({ [`${ORIGIN}/_api/mcp`]: RPC }))).verdict,
    ).toBe('pass');
    expect((await runCheck(wixSiteMcp, target, mapFetcher({}))).verdict).toBe('fail');
  });
});

describe('crawler settings of site builders', () => {
  it('warns when Squarespace blocks answer agents along with training crawlers', async () => {
    const target = targetFor({ platform: 'squarespace', robots: block(SQUARESPACE_AI_CRAWLERS) });
    const outcome = await runCheck(squarespaceAiCrawlerSetting, target, mapFetcher({}));
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toContain('DuckAssistBot');
  });

  it('passes when the Squarespace box is off', async () => {
    const target = targetFor({ platform: 'squarespace', robots: block(['GPTBot', 'CCBot']) });
    expect((await runCheck(squarespaceAiCrawlerSetting, target, mapFetcher({}))).verdict).toBe(
      'pass',
    );
  });

  it('fails when Webflow has AI bots switched off', async () => {
    const target = targetFor({ platform: 'webflow', robots: block(WEBFLOW_AI_BOTS) });
    const outcome = await runCheck(webflowTrafficControl, target, mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('ChatGPT-User');
  });

  it('passes on Webflow defaults', async () => {
    const target = targetFor({ platform: 'webflow', robots: 'User-agent: *\nDisallow:\n' });
    expect((await runCheck(webflowTrafficControl, target, mapFetcher({}))).verdict).toBe('pass');
  });
});

describe('Square Online search visibility', () => {
  it('fails when robots.txt shuts search engines out', async () => {
    const target = targetFor({ platform: 'square', robots: 'User-agent: *\nDisallow: /\n' });
    const outcome = await runCheck(squareSearchVisibility, target, mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('Hidden from search engine results');
  });
});

describe('Adobe Commerce GraphQL', () => {
  const url = `${ORIGIN}/graphql?query=${encodeURIComponent(MAGENTO_PRODUCT_QUERY)}`;

  it('passes when the catalog answers over GET', async () => {
    const target = targetFor({ platform: 'magento' });
    const fetcher = mapFetcher({
      [url]: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"data":{"products":{"total_count":42,"items":[{"name":"Mug","sku":"M1","url_key":"mug"}]}}}',
      },
    });
    const outcome = await runCheck(magentoGraphqlCatalog, target, fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ total_count: 42, first_item: 'Mug' });
  });

  it('fails when a firewall answers with HTML', async () => {
    const target = targetFor({ platform: 'magento' });
    const fetcher = mapFetcher({
      [url]: {
        status: 403,
        headers: { 'content-type': 'text/html' },
        body: '<!doctype html><html></html>',
      },
    });
    const outcome = await runCheck(magentoGraphqlCatalog, target, fetcher);
    expect(outcome.verdict).toBe('fail');
  });
});

describe('Shopware agentic files', () => {
  it('passes when ai-catalog.json is published and warns on 404', async () => {
    const target = targetFor({ platform: 'shopware' });
    const live = mapFetcher({
      [`${ORIGIN}${SHOPWARE_AI_CATALOG}`]: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"name":"Shop","resources":[]}',
      },
    });
    expect((await runCheck(shopwareAgenticFiles, target, live)).verdict).toBe('pass');
    expect((await runCheck(shopwareAgenticFiles, target, mapFetcher({}))).verdict).toBe('warn');
  });
});

describe('PrestaShop friendly URLs', () => {
  it('warns on query-string product URLs', async () => {
    const target = targetFor({
      platform: 'prestashop',
      products: [
        `${ORIGIN}/12-blue-mug.html`,
        `${ORIGIN}/index.php?id_product=7&controller=product`,
      ],
    });
    const outcome = await runCheck(prestashopFriendlyUrls, target, mapFetcher({}));
    expect(outcome.verdict).toBe('warn');
    expect(outcome.evidence).toMatchObject({
      unfriendly: [`${ORIGIN}/index.php?id_product=7&controller=product`],
    });
  });
});

describe('Salesforce robots.txt preset', () => {
  it('fails on the staging preset and on a blocked static path, passes otherwise', async () => {
    const staging = targetFor({ platform: 'salesforce', robots: 'User-agent: *\nDisallow: /\n' });
    const outcome = await runCheck(salesforceRobotsPreset, staging, mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('All Spiders Disallowed');
    const statics = targetFor({
      platform: 'salesforce',
      robots: 'User-agent: *\nDisallow: /on/demandware.static/\n',
    });
    expect((await runCheck(salesforceRobotsPreset, statics, mapFetcher({}))).verdict).toBe('fail');
    const open = targetFor({ platform: 'salesforce', robots: 'User-agent: *\nDisallow: /cart\n' });
    expect((await runCheck(salesforceRobotsPreset, open, mapFetcher({}))).verdict).toBe('pass');
  });
});

describe('Ecwid clean URLs', () => {
  const script = '<script src="https://app.ecwid.com/script.js?1003"></script>';

  it('warns on hashbang store links', async () => {
    const target = targetFor({
      platform: 'ecwid',
      homeHtml: `<html><body><a href="/store/#!/blue-mug/p/123456">Mug</a>${script}</body></html>`,
    });
    const outcome = await runCheck(ecwidCleanUrls, target, mapFetcher({}));
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toContain('#!');
  });

  it('passes on Instant Site and when the integration switches clean URLs on', async () => {
    const instant = targetFor({
      platform: 'ecwid',
      homeHtml: '<html><head><meta name="generator" content="ec-instant-site"></head></html>',
    });
    expect((await runCheck(ecwidCleanUrls, instant, mapFetcher({}))).verdict).toBe('pass');
    const custom = targetFor({
      platform: 'ecwid',
      homeHtml: `<html><body><script>window.ec.config.storefrontUrls.cleanUrls = true;</script>${script}</body></html>`,
    });
    expect((await runCheck(ecwidCleanUrls, custom, mapFetcher({}))).verdict).toBe('pass');
  });

  it('warns on a custom site without clean URLs', async () => {
    const target = targetFor({
      platform: 'ecwid',
      homeHtml: `<html><body>${script}</body></html>`,
    });
    expect((await runCheck(ecwidCleanUrls, target, mapFetcher({}))).verdict).toBe('warn');
  });
});
