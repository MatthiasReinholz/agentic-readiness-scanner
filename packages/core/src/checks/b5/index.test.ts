import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCheck, type CheckDefinition } from '@agentic-readiness/catalog';
import { describe, expect, it } from 'vitest';

import type { FetchOptions, Fetcher } from '../../http/types.js';
import { resolveTarget } from '../../target/resolver.js';
import type { Target } from '../../target/types.js';
import { fixtureFetcher, mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import { shopifyProductsJsonReadable } from '../b1/shopify.js';
import type { Check, CheckOutcome } from '../types.js';
import {
  acpDiscoveryDocument,
  acpFeedFields,
  allowsSharedCaching,
  hasUcpLinkRelation,
  sampleFeedItems,
  shopifyAgenticStorefront,
  ucpBusinessProfile,
  ucpCheckoutDeclared,
} from './index.js';

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'stores',
);

/**
 * Like runCheck, but tolerant of a check whose catalog entry has not landed yet: the
 * implementation never reads its definition, so a stand-in with the same id will do.
 */
function runAny(
  check: Check,
  target: Target,
  fetcher: Fetcher,
  outcomes: ReadonlyMap<string, CheckOutcome> = new Map(),
): Promise<CheckOutcome> {
  const definition: CheckDefinition = getCheck(check.id) ?? {
    id: check.id,
    group: check.id.slice(0, 2),
    title: check.id,
    question: check.id,
    method: check.id,
    weight: 2,
    requires: [],
    depends_on: [],
    spec: [{ title: 'placeholder', url: 'https://example.com/spec' }],
    fix: { summary: 'placeholder', agent_prompt: 'placeholder', auto_fix: false },
  };
  return check.run({ target, fetcher, definition, outcomes });
}

function outcomesWith(id: string, evidence: Record<string, unknown>): Map<string, CheckOutcome> {
  return new Map([[id, { verdict: 'pass' as const, evidence }]]);
}

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' };

const profile = {
  ucp: {
    version: '2026-08-25',
    services: {
      'dev.ucp.shopping': [
        {
          version: '2026-08-25',
          spec: 'https://ucp.dev/2026-08-25/specification/overview',
          transport: 'rest',
          endpoint: 'https://shop.example/ucp/v1',
          schema: 'https://ucp.dev/2026-08-25/services/shopping/rest.openapi.json',
        },
      ],
    },
    capabilities: {
      'dev.ucp.shopping.checkout': [
        { version: '2026-08-25', spec: 'https://ucp.dev/checkout', schema: 'https://ucp.dev/c' },
      ],
    },
    payment_handlers: {
      'com.google.pay': [
        {
          id: 'gpay-1',
          version: '2026-01-23',
          spec: 'https://pay.google.com/gp/p/ucp/2026-01-23/',
          schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json',
        },
      ],
    },
  },
  signing_keys: [{ kid: 'k1', kty: 'EC', crv: 'P-256', x: 'x', y: 'y', use: 'sig', alg: 'ES256' }],
};

describe('B5.1 UCP business profile', () => {
  const url = 'https://shop.example/.well-known/ucp';
  const run = (fetcher: Fetcher) => runCheck(ucpBusinessProfile, targetFor(), fetcher);

  it('fails on 404', async () => {
    const outcome = await run(mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('no UCP business profile at /.well-known/ucp (HTTP 404)');
    expect(outcome.evidence).toMatchObject({ url, status: 404, redirects: 0 });
  });

  it('fails on an HTML body, a non-JSON body and other statuses', async () => {
    const html = await run(mapFetcher({ [url]: '<!doctype html><html><body>Shop</body></html>' }));
    expect(html.verdict).toBe('fail');
    expect(html.message).toMatch(/HTML page/);
    const text = await run(mapFetcher({ [url]: 'ucp: yes' }));
    expect(text.verdict).toBe('fail');
    expect(text.message).toBe('/.well-known/ucp is not valid JSON');
    const broken = await run(mapFetcher({ [url]: { status: 503, body: '' } }));
    expect(broken.verdict).toBe('fail');
    expect(broken.message).toBe('/.well-known/ucp returned HTTP 503');
  });

  it('fails when the JSON lacks the required shape and names the missing part', async () => {
    const cases: [unknown, string][] = [
      [[], 'a top-level JSON object'],
      [{ version: '2026-08-25' }, 'the ucp object'],
      [
        { ucp: { version: 'v1', services: {}, payment_handlers: {} } },
        'a ucp.version in YYYY-MM-DD form',
      ],
      [{ ucp: { version: '2026-08-25', payment_handlers: {} } }, 'a ucp.services object'],
      [
        { ucp: { version: '2026-08-25', services: {}, payment_handlers: [] } },
        'a ucp.payment_handlers object',
      ],
    ];
    for (const [body, missing] of cases) {
      const outcome = await run(
        mapFetcher({ [url]: { status: 200, headers: JSON_HEADERS, body: JSON.stringify(body) } }),
      );
      expect(outcome.verdict).toBe('fail');
      expect(outcome.message).toBe(`UCP profile is missing ${missing}`);
    }
  });

  it('passes a well-served profile and records ids, keys and the profile itself', async () => {
    const outcome = await run(
      mapFetcher({ [url]: { status: 200, headers: JSON_HEADERS, body: JSON.stringify(profile) } }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'UCP profile version 2026-08-25 with 1 service(s), 1 capability set(s) and 1 payment handler(s)',
    );
    expect(outcome.evidence).toMatchObject({
      status: 200,
      content_type: 'application/json',
      cache_control: 'public, max-age=300',
      version: '2026-08-25',
      services: ['dev.ucp.shopping'],
      capabilities: ['dev.ucp.shopping.checkout'],
      payment_handlers: ['com.google.pay'],
      keys_present: true,
      profile: profile.ucp,
    });
  });

  it('accepts empty registries and reports absent keys', async () => {
    const minimal = { ucp: { version: '2026-08-25', services: {}, payment_handlers: {} } };
    const outcome = await run(
      mapFetcher({ [url]: { status: 200, headers: JSON_HEADERS, body: JSON.stringify(minimal) } }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ capabilities: [], keys_present: false });
  });

  it('warns, and combines the reasons, when the profile is served through a redirect, as text or without shared caching', async () => {
    const inner = mapFetcher({
      [url]: {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify(profile),
      },
    });
    const redirecting: Fetcher = {
      budget: inner.budget,
      get requestCount() {
        return inner.requestCount;
      },
      fetch: async (target: string, options?: FetchOptions) => ({
        ...(await inner.fetch(target, options)),
        redirects: 1,
      }),
    };
    const outcome = await run(redirecting);
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      'UCP profile version 2026-08-25 with 1 service(s), 1 capability set(s) and 1 payment handler(s), but it was served through 1 redirect(s); the content type is text/plain, not application/json; Cache-Control lacks public with a max-age of at least 60',
    );
    expect(outcome.evidence).toMatchObject({
      redirects: 1,
      cache_control: null,
      profile: profile.ucp,
    });
  });

  it('warns on a private or short cache lifetime alone', async () => {
    const outcome = await run(
      mapFetcher({
        [url]: {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' },
          body: JSON.stringify(profile),
        },
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(
      /, but Cache-Control lacks public with a max-age of at least 60$/,
    );
  });

  it('reads Cache-Control the way the spec requires', () => {
    expect(allowsSharedCaching('public, max-age=60')).toBe(true);
    expect(allowsSharedCaching('max-age=3600, public')).toBe(true);
    expect(allowsSharedCaching('public, max-age=59')).toBe(false);
    expect(allowsSharedCaching('public, no-cache, max-age=600')).toBe(false);
    expect(allowsSharedCaching('private, max-age=600')).toBe(false);
    expect(allowsSharedCaching('max-age=600')).toBe(false);
    expect(allowsSharedCaching(null)).toBe(false);
  });
});

describe('B5.2 UCP checkout capability and payment handler', () => {
  const endpoint = 'https://shop.example/ucp/v1';
  const run = (ucp: unknown, fetcher: Fetcher = mapFetcher({})) =>
    runCheck(ucpCheckoutDeclared, targetFor(), fetcher, outcomesWith('B5.1', { profile: ucp }));

  it('skips with reason error when B5.1 recorded no profile', async () => {
    const outcome = await runCheck(ucpCheckoutDeclared, targetFor(), mapFetcher({}), new Map());
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('error');
  });

  it('passes when checkout and a payment handler are declared, probing the REST endpoint', async () => {
    const fetcher = mapFetcher({ [endpoint]: { status: 401, body: '{"error":"unauthorized"}' } });
    const outcome = await run(profile.ucp, fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('UCP profile declares checkout and 1 payment handler(s): gpay-1');
    expect(outcome.evidence).toEqual({
      checkout: true,
      checkout_capability: true,
      shopping_transports: ['rest'],
      handlers: ['gpay-1'],
      endpoint,
      endpoint_status: 401,
    });
    expect(fetcher.log.map((entry) => entry.url)).toEqual([endpoint]);
  });

  it('turns the pass into a warn when the REST endpoint answers 404 or 5xx', async () => {
    const gone = await run(profile.ucp, mapFetcher({}));
    expect(gone.verdict).toBe('warn');
    expect(gone.message).toMatch(/ \(endpoint answered HTTP 404\)$/);
    expect(gone.evidence).toMatchObject({ endpoint_status: 404 });
    const down = await run(profile.ucp, mapFetcher({ [endpoint]: { status: 502, body: '' } }));
    expect(down.verdict).toBe('warn');
    expect(down.message).toMatch(/ \(endpoint answered HTTP 502\)$/);
  });

  it('counts an MCP shopping service as a checkout declaration and skips the endpoint probe', async () => {
    const fetcher = mapFetcher({});
    const outcome = await run(
      {
        version: '2026-08-25',
        services: {
          'dev.ucp.shopping': { transport: 'mcp', endpoint: 'https://shop.example/api/ucp/mcp' },
        },
        payment_handlers: {
          'com.example.pay': { id: 'p1', version: '2026-01-01', spec: 'https://x' },
        },
      },
      fetcher,
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      checkout: true,
      checkout_capability: false,
      shopping_transports: ['mcp'],
      handlers: ['p1'],
      endpoint: null,
      endpoint_status: null,
    });
    expect(fetcher.log).toHaveLength(0);
  });

  it('warns when only checkout is declared', async () => {
    const outcome = await run({
      version: '2026-08-25',
      services: {},
      capabilities: { 'dev.ucp.shopping.checkout': [{ version: '2026-08-25' }] },
      payment_handlers: { 'com.google.pay': [{ version: '2026-01-23' }] },
    });
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      'UCP profile declares checkout but no payment handler with id, version and spec',
    );
    expect(outcome.evidence).toMatchObject({ checkout: true, handlers: [] });
  });

  it('warns when only a payment handler is declared', async () => {
    const outcome = await run({
      version: '2026-08-25',
      services: { 'dev.ucp.catalog': [{ transport: 'rest' }] },
      capabilities: { 'dev.ucp.shopping.checkout': [] },
      payment_handlers: profile.ucp.payment_handlers,
    });
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      'UCP profile declares 1 payment handler(s) but no checkout capability or shopping service',
    );
    expect(outcome.evidence).toMatchObject({ checkout: false, handlers: ['gpay-1'] });
  });

  it('fails when neither is declared', async () => {
    const outcome = await run({ version: '2026-08-25', services: {}, payment_handlers: {} });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('UCP profile declares neither checkout nor a payment handler');
  });
});

describe('B5.3 ACP discovery document', () => {
  const url = 'https://shop.example/.well-known/acp.json';
  const run = (body?: string | { status: number; body: string }) =>
    runCheck(
      acpDiscoveryDocument,
      targetFor(),
      mapFetcher(body === undefined ? {} : { [url]: body }),
    );
  const document = {
    protocol: { name: 'acp', version: '2026-04-17' },
    api_base_url: 'https://shop.example/acp',
    transports: ['rest'],
    capabilities: { services: ['checkout'] },
  };

  it('fails on 404, other statuses, HTML and non-object JSON', async () => {
    const missing = await run();
    expect(missing.verdict).toBe('fail');
    expect(missing.message).toBe('no ACP discovery document at /.well-known/acp.json (HTTP 404)');
    const down = await run({ status: 500, body: '' });
    expect(down.message).toBe('/.well-known/acp.json returned HTTP 500');
    const html = await run('<html><body>nope</body></html>');
    expect(html.verdict).toBe('fail');
    expect(html.message).toMatch(/HTML page/);
    const list = await run('[1,2]');
    expect(list.verdict).toBe('fail');
    expect(list.message).toBe('/.well-known/acp.json is not a JSON object');
  });

  it('fails and names every missing part', async () => {
    const outcome = await run(
      JSON.stringify({
        protocol: { name: 'acp-ish' },
        api_base_url: 'http://shop.example/acp',
        transports: ['mcp'],
      }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      'ACP discovery document is missing protocol.name "acp", a protocol.version string, an https api_base_url, a transports array containing "rest"',
    );
    expect(outcome.evidence).toMatchObject({
      protocol: { name: 'acp-ish', version: null },
      transports: ['mcp'],
      services: null,
    });
  });

  it('passes a complete document', async () => {
    const outcome = await run(JSON.stringify(document));
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'ACP 2026-04-17 discovery document with a REST API at https://shop.example/acp',
    );
    expect(outcome.evidence).toMatchObject({
      status: 200,
      protocol: { name: 'acp', version: '2026-04-17' },
      api_base_url: 'https://shop.example/acp',
      transports: ['rest'],
      services: ['checkout'],
    });
  });
});

describe('B5.4 ACP feed fields', () => {
  const feedUrl = 'https://shop.example/feeds/products.json';
  const complete = {
    id: '1',
    title: 'Mug',
    seller_name: 'Example Ceramics',
    seller_url: 'https://shop.example/',
    return_policy: 'https://shop.example/returns/',
    return_window: '30',
  };
  const policiesOnly = {
    id: '2',
    seller_name: 'Example Ceramics',
    seller_privacy_policy: 'https://shop.example/privacy/',
    seller_tos: 'https://shop.example/terms/',
  };
  const sellerOnly = { id: '3', seller_name: 'Example Ceramics' };
  const bare = { id: '4', title: 'Bowl' };
  const run = (evidence: Record<string, unknown>, fetcher: Fetcher = mapFetcher({})) =>
    runCheck(acpFeedFields, targetFor(), fetcher, outcomesWith('B1.5', evidence));

  it('skips as not applicable without a feed URL', async () => {
    const outcome = await run({});
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
    expect(outcome.message).toBe('no product feed was found to inspect');
  });

  it('skips as not applicable for a Google XML feed', async () => {
    const outcome = await run({ feed_url: 'https://shop.example/feed.xml', format: 'google-xml' });
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
    expect(outcome.evidence).toMatchObject({ format: 'google-xml' });
  });

  it('passes when every sampled item carries seller_name with return or policy fields', async () => {
    const outcome = await run({
      feed_url: feedUrl,
      format: 'json',
      items: [complete, policiesOnly],
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      feed_url: feedUrl,
      items_sampled: 2,
      fields: [
        { seller_name: true, seller_url: true, return_policy: true, return_window: true },
        { seller_name: true, seller_privacy_policy: true, seller_tos: true, return_policy: false },
      ],
    });
  });

  it('warns when items carry seller_name but not the return or policy fields', async () => {
    const outcome = await run({ feed_url: feedUrl, format: 'json', items: [complete, sellerOnly] });
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      '2 of 2 sampled feed item(s) carry seller_name, but only 1 carry the return or seller policy fields',
    );
  });

  it('fails when no sampled item carries seller_name', async () => {
    const outcome = await run({ feed_url: feedUrl, format: 'json', items: [bare, bare] });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/none of 2 sampled feed item\(s\)/);
  });

  it('samples at most five items', async () => {
    const items = Array.from({ length: 8 }, () => complete);
    const outcome = await run({ feed_url: feedUrl, format: 'json', items });
    expect(outcome.evidence).toMatchObject({ items_sampled: 5 });
  });

  it('re-fetches and parses the feed when B1.5 recorded no items', async () => {
    const json = await run(
      { feed_url: feedUrl, format: 'json' },
      mapFetcher({ [feedUrl]: JSON.stringify({ items: [complete] }) }),
    );
    expect(json.verdict).toBe('pass');
    expect(json.evidence).toMatchObject({ feed_status: 200, items_sampled: 1 });
    const jsonl = await run(
      { feed_url: feedUrl, format: 'jsonl' },
      mapFetcher({ [feedUrl]: `${JSON.stringify(complete)}\n${JSON.stringify(sellerOnly)}\n` }),
    );
    expect(jsonl.verdict).toBe('warn');
    const csvUrl = 'https://shop.example/feeds/products.csv';
    const csv = await run(
      { feed_url: csvUrl, format: 'csv' },
      mapFetcher({
        [csvUrl]:
          'id,title,seller_name,return_policy,return_deadline_in_days\n1,"Mug, large",Example Ceramics,https://shop.example/returns/,30\n2,Bowl,,,\n',
      }),
    );
    expect(csv.verdict).toBe('warn');
    expect(csv.evidence).toMatchObject({
      fields: [
        { seller_name: true, return_policy: true, return_deadline_in_days: true },
        { seller_name: false },
      ],
    });
  });

  it('skips with reason error when the feed cannot be fetched, parsed or has no items', async () => {
    const gone = await run({ feed_url: feedUrl, format: 'json' });
    expect(gone.verdict).toBe('skip');
    expect(gone.skipReason).toBe('error');
    expect(gone.message).toBe(`the feed at ${feedUrl} answered HTTP 404`);
    const garbage = await run(
      { feed_url: feedUrl, format: 'json' },
      mapFetcher({ [feedUrl]: 'x' }),
    );
    expect(garbage.skipReason).toBe('error');
    expect(garbage.message).toMatch(/could not be parsed/);
    const empty = await run({ feed_url: feedUrl, format: 'json' }, mapFetcher({ [feedUrl]: '[]' }));
    expect(empty.skipReason).toBe('error');
    expect(empty.message).toMatch(/has no items to sample/);
  });

  it('skips as not applicable when the re-fetched feed turns out to be XML', async () => {
    const outcome = await run(
      { feed_url: feedUrl, format: 'unknown' },
      mapFetcher({ [feedUrl]: '<?xml version="1.0"?><rss></rss>' }),
    );
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
  });

  it('parses JSON objects, JSON Lines and CSV minimally', () => {
    expect(sampleFeedItems('{"products":[{"a":"1"}]}')).toEqual([{ a: '1' }]);
    expect(sampleFeedItems('{"a":"1"}\n{"a":"2"}')).toEqual([{ a: '1' }, { a: '2' }]);
    expect(sampleFeedItems('A;B\n1;"x;y"\n')).toEqual([{ a: '1', b: 'x;y' }]);
    expect(sampleFeedItems('<feed/>')).toBeNull();
    expect(sampleFeedItems('just one column')).toBeNull();
    expect(sampleFeedItems('{"a":')).toBeNull();
  });
});

describe('B5.8 Shopify agentic storefront active', () => {
  const endpoint = 'https://shop.example/api/ucp/mcp';
  const link = '</.well-known/ucp>; rel="ucp"';
  const shopifyTarget = (linkHeader?: string): Target => {
    const base = targetFor({ platform: 'shopify' });
    return {
      ...base,
      home: {
        ...base.home,
        headers: { ...base.home.headers, ...(linkHeader ? { link: linkHeader } : {}) },
      },
    };
  };

  it('skips as not applicable when the platform is not Shopify', async () => {
    const outcome = await runAny(shopifyAgenticStorefront, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
    expect(outcome.evidence).toEqual({ platform: 'woocommerce' });
  });

  it('passes when the Link relation is present and the MCP endpoint answers', async () => {
    const outcome = await runAny(
      shopifyAgenticStorefront,
      shopifyTarget(`</llms.txt>; rel="llms-txt", ${link}`),
      mapFetcher({ [endpoint]: { status: 405, headers: { allow: 'POST' }, body: '' } }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toEqual({
      link_header: `</llms.txt>; rel="llms-txt", ${link}`,
      link_declared: true,
      endpoint,
      endpoint_status: 405,
      endpoint_answers: true,
      body_snippet: '',
    });
  });

  it('warns when only the Link relation is present', async () => {
    const outcome = await runAny(shopifyAgenticStorefront, shopifyTarget(link), mapFetcher({}));
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      'the homepage links /.well-known/ucp but /api/ucp/mcp returned HTTP 404',
    );
  });

  it('warns when only the endpoint answers, including a JSON-RPC error on 400', async () => {
    const body = '{"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request"},"id":null}';
    const outcome = await runAny(
      shopifyAgenticStorefront,
      shopifyTarget(),
      mapFetcher({ [endpoint]: { status: 400, body } }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      '/api/ucp/mcp answers (HTTP 400) but the homepage sends no Link rel="ucp" header',
    );
    expect(outcome.evidence).toMatchObject({ link_header: null, body_snippet: body });
  });

  it('fails when neither signal is present, treating a plain 400 as no answer', async () => {
    const outcome = await runAny(
      shopifyAgenticStorefront,
      shopifyTarget('</llms.txt>; rel="llms-txt"'),
      mapFetcher({ [endpoint]: { status: 400, body: 'Bad Request' } }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      'no Link rel="ucp" header on the homepage and /api/ucp/mcp returned HTTP 400',
    );
    expect(outcome.evidence).toMatchObject({ link_declared: false, endpoint_answers: false });
  });

  it('reads the Link header strictly', () => {
    expect(hasUcpLinkRelation('</.well-known/ucp>; rel="ucp"')).toBe(true);
    expect(hasUcpLinkRelation('<https://shop.example/.well-known/ucp>; rel=ucp')).toBe(true);
    expect(hasUcpLinkRelation('</.well-known/ucp>; rel="alternate ucp"')).toBe(true);
    expect(hasUcpLinkRelation('</.well-known/ucp>; rel="alternate"')).toBe(false);
    expect(hasUcpLinkRelation('</llms.txt>; rel="ucp"')).toBe(false);
    expect(hasUcpLinkRelation('')).toBe(false);
  });
});

describe('recorded stores', () => {
  it('passes B5.1, B5.2 and B5.3 on the good WooCommerce fixture', async () => {
    const fetcher = fixtureFetcher(join(fixtures, 'good-woocommerce'));
    const target = await resolveTarget('ceramics.example', fetcher);
    const outcomes = new Map<string, CheckOutcome>();
    outcomes.set('B5.1', await runCheck(ucpBusinessProfile, target, fetcher));
    expect(outcomes.get('B5.1')?.verdict).toBe('pass');
    const checkout = await runCheck(ucpCheckoutDeclared, target, fetcher, outcomes);
    expect(checkout.verdict).toBe('pass');
    expect(checkout.evidence).toMatchObject({
      endpoint: 'https://ceramics.example/ucp/v1',
      endpoint_status: 401,
    });
    expect((await runCheck(acpDiscoveryDocument, target, fetcher)).verdict).toBe('pass');
  });

  it('detects the Shopify fixture and passes B5.8 and B1.8 on it', async () => {
    const fetcher = fixtureFetcher(join(fixtures, 'shopify-store'));
    const target = await resolveTarget('boots.example', fetcher);
    expect(target.platform).toBe('shopify');
    expect(target.sampled.products).toHaveLength(2);
    const storefront = await runAny(shopifyAgenticStorefront, target, fetcher);
    expect(storefront.verdict).toBe('pass');
    expect(storefront.evidence).toMatchObject({ link_declared: true, endpoint_status: 405 });
    const products = await runAny(shopifyProductsJsonReadable, target, fetcher);
    expect(products.verdict).toBe('pass');
    expect(products.evidence).toMatchObject({
      count: 2,
      handles: ['trail-boot', 'canvas-sneaker'],
    });
    const ucp = await runCheck(ucpBusinessProfile, target, fetcher);
    expect(ucp.verdict).toBe('pass');
    const checkout = await runCheck(ucpCheckoutDeclared, target, fetcher, new Map([['B5.1', ucp]]));
    expect(checkout.verdict).toBe('pass');
  });
});
