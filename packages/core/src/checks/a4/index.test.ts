import { describe, expect, it } from 'vitest';

import type { FixtureResponse } from '../../http/fixture-fetcher.js';
import { HtmlDocument } from '../../parsers/html.js';
import { mapFetcher, runCheck, targetFor, type MapResponse } from '../../testing/index.js';
import type { CheckOutcome } from '../types.js';
import {
  a2aAgentCard,
  apiCatalogPublished,
  mcpEndpointReachable,
  mcpServerDiscoverable,
  oauthDiscoveryForMcp,
  parseServerCard,
  resourceMetadataUrl,
  serverCardUrl,
  summarizeLinkset,
  webMcpSignals,
  webMcpToolDeclarations,
} from './index.js';

const origin = 'https://shop.example';
const endpoint = 'https://shop.example/mcp';
const json = (value: unknown, headers: Record<string, string> = {}): FixtureResponse => ({
  status: 200,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(value),
});
const HTML = '<!doctype html><html><body>Not found</body></html>';
const card = {
  name: 'Shop catalog',
  version: '1.0.0',
  remotes: [{ transport_type: 'streamable-http', url: endpoint }],
};

/** A fake A4.1 outcome whose evidence carries the discovered endpoint. */
function discovered(value: string | null = endpoint): Map<string, CheckOutcome> {
  return new Map<string, CheckOutcome>([
    ['A4.1', { verdict: 'pass', evidence: value === null ? {} : { endpoint: value } }],
  ]);
}

describe('A4.1 MCP server discoverable', () => {
  const catalogUrl = `${origin}/.well-known/ai-catalog.json`;
  const cardUrl = `${origin}/mcp/server-card`;
  const communityUrl = `${origin}/.well-known/mcp/server-card.json`;
  const catalog = (entry: Record<string, unknown>) => ({
    entries: [{ identifier: 'urn:air:shop.example:shop', ...entry }],
  });

  it('passes when ai-catalog.json lists a card that parses, and records the endpoint', async () => {
    const fetcher = mapFetcher({
      [catalogUrl]: json(
        catalog({ type: 'application/mcp-server-card+json', url: '/mcp/server-card' }),
      ),
      [cardUrl]: json(card, { 'content-type': 'application/mcp-server-card+json' }),
    });
    const outcome = await runCheck(mcpServerDiscoverable, targetFor(), fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toContain('listed in ai-catalog.json');
    expect(outcome.evidence).toMatchObject({
      source: 'ai-catalog',
      card_url: cardUrl,
      name: 'Shop catalog',
      endpoint,
      tried: [
        { url: catalogUrl, status: 200 },
        { url: cardUrl, status: 200 },
      ],
    });
    expect(fetcher.requestCount).toBe(2);
  });

  it('passes on a card inlined in the catalog entry as data', async () => {
    const outcome = await runCheck(
      mcpServerDiscoverable,
      targetFor(),
      mapFetcher({
        [catalogUrl]: json(
          catalog({ type: 'application/mcp-server-card+json', data: { name: 'Inline', endpoint } }),
        ),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toContain('inline in ai-catalog.json');
    expect(outcome.evidence).toMatchObject({ source: 'ai-catalog', name: 'Inline', endpoint });
  });

  it('passes on a card at <endpoint>/server-card for an endpoint linked from llms.txt', async () => {
    const fetcher = mapFetcher({
      [catalogUrl]: json(catalog({ type: 'application/other+json', url: '/other' })),
      [`${origin}/llms.txt`]: '# Shop\n\n## Agents\n\n- [MCP server](https://shop.example/mcp/)\n',
      [cardUrl]: json({ serverInfo: { name: 'From llms' }, transports: [{ url: '/mcp' }] }),
    });
    const outcome = await runCheck(mcpServerDiscoverable, targetFor(), fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      source: 'server-card',
      card_url: cardUrl,
      name: 'From llms',
      endpoint,
      hints: ['https://shop.example/mcp/'],
    });
    expect(outcome.evidence.tried).toHaveLength(3);
  });

  it('passes on a card for an endpoint named by a Link rel="mcp-server" header', async () => {
    const target = targetFor();
    target.home.headers.link =
      '</llms.txt>; rel="llms-txt", <https://mcp.shop.example/v1>; rel="mcp-server"';
    const outcome = await runCheck(
      mcpServerDiscoverable,
      target,
      mapFetcher({
        'https://mcp.shop.example/v1/server-card': json({
          name: 'Remote',
          endpoints: [{ url: 'https://mcp.shop.example/v1' }],
        }),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      source: 'server-card',
      endpoint: 'https://mcp.shop.example/v1',
      hints: ['https://mcp.shop.example/v1'],
    });
  });

  it('warns when only the community path answers', async () => {
    const outcome = await runCheck(
      mcpServerDiscoverable,
      targetFor(),
      mapFetcher({ [communityUrl]: json(card) }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toContain('community path');
    expect(outcome.evidence).toMatchObject({
      source: 'community',
      card_url: communityUrl,
      endpoint,
      tried: [
        { url: catalogUrl, status: 404 },
        { url: `${origin}/llms.txt`, status: 404 },
        { url: communityUrl, status: 200 },
      ],
    });
  });

  it('fails when nothing answers, listing every URL tried', async () => {
    const outcome = await runCheck(mcpServerDiscoverable, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toEqual({
      tried: [
        { url: catalogUrl, status: 404 },
        { url: `${origin}/llms.txt`, status: 404 },
        { url: communityUrl, status: 404 },
      ],
      hints: [],
    });
  });

  it('fails when the cards found lack a name or an endpoint, or are HTML', async () => {
    const outcome = await runCheck(
      mcpServerDiscoverable,
      targetFor(),
      mapFetcher({
        [catalogUrl]: json(catalog({ type: 'application/mcp-server-card+json', url: cardUrl })),
        [cardUrl]: json({ name: 'No endpoint', version: '1.0.0' }),
        [communityUrl]: HTML,
      }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence.tried).toHaveLength(4);
  });

  it('never sends more than six requests however many hints there are', async () => {
    const fetcher = mapFetcher({
      [catalogUrl]: json({
        entries: [
          { type: 'application/mcp-server-card+json', url: '/a/server-card' },
          { type: 'application/mcp-server-card+json', url: '/b/server-card' },
          { type: 'application/mcp-server-card+json', url: '/c/server-card' },
        ],
      }),
      [`${origin}/llms.txt`]: '- [one](/mcp-one)\n- [two](/mcp-two)\n- [three](/mcp-three)\n',
    });
    const outcome = await runCheck(mcpServerDiscoverable, targetFor(), fetcher);
    expect(outcome.verdict).toBe('fail');
    expect(fetcher.requestCount).toBeLessThanOrEqual(6);
    expect(outcome.evidence.hints).toEqual([`${origin}/mcp-one`, `${origin}/mcp-two`]);
  });

  it('parses the card shapes seen in the wild and resolves relative endpoints', () => {
    const base = 'https://shop.example/mcp/server-card';
    expect(parseServerCard({ name: 'a', endpoint: '/mcp' }, base)).toEqual({
      name: 'a',
      endpoint: 'https://shop.example/mcp',
    });
    expect(parseServerCard({ name: 'b', url: 'https://x.example/mcp' }, base)?.endpoint).toBe(
      'https://x.example/mcp',
    );
    expect(
      parseServerCard(
        { serverInfo: { name: ' c ' }, remotes: [{ url: 'ws:x' }, { url: '/m' }] },
        base,
      ),
    ).toEqual({
      name: 'c',
      endpoint: 'https://shop.example/m',
    });
    expect(parseServerCard({ name: '', endpoint: '/mcp' }, base)).toBeNull();
    expect(parseServerCard({ name: 'd', remotes: 'nope' }, base)).toBeNull();
    expect(parseServerCard([card], base)).toBeNull();
    expect(serverCardUrl('https://shop.example/mcp/?x=1#f')).toBe(
      'https://shop.example/mcp/server-card',
    );
  });
});

describe('A4.2 API catalog', () => {
  const url = `${origin}/.well-known/api-catalog`;
  const run = (response?: MapResponse) =>
    runCheck(
      apiCatalogPublished,
      targetFor(),
      mapFetcher(response === undefined ? {} : { [url]: response }),
    );
  const linkset = {
    linkset: [
      {
        anchor: `${origin}/.well-known/api-catalog`,
        item: [{ href: `${origin}/wp-json/wc/store/v1/` }, { href: `${origin}/mcp` }],
      },
      {
        anchor: `${origin}/wp-json/wc/store/v1/`,
        'service-desc': [{ href: `${origin}/openapi.json` }],
      },
    ],
  };

  it('passes on an application/linkset+json document with items', async () => {
    const outcome = await run(json(linkset, { 'content-type': 'application/linkset+json' }));
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('api-catalog linkset with 2 link context(s) and 2 item link(s)');
    expect(outcome.evidence).toMatchObject({
      status: 200,
      content_type: 'application/linkset+json',
      entries: 2,
      entries_with_links: 2,
      items: 2,
      relations: ['item', 'service-desc'],
      anchors: [`${origin}/.well-known/api-catalog`, `${origin}/wp-json/wc/store/v1/`],
    });
  });

  it('passes on a JSON linkset served under another content type, and says so', async () => {
    const outcome = await run(
      json({ linkset: [{ anchor: '/', 'service-doc': [{ href: '/docs' }] }] }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toContain('(served as application/json)');
    expect(outcome.evidence).toMatchObject({
      entries_with_links: 1,
      items: 0,
      relations: ['service-doc'],
    });
  });

  it('fails on 404', async () => {
    const outcome = await run();
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('api-catalog returned HTTP 404');
    expect(outcome.evidence).toEqual({ url, status: 404, content_type: '' });
  });

  it('fails on HTML', async () => {
    const outcome = await run({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: HTML,
    });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/HTML/);
  });

  it('fails on JSON without a linkset array and on an empty linkset', async () => {
    const notLinkset = await run(json({ apis: [] }));
    expect(notLinkset.verdict).toBe('fail');
    expect(notLinkset.message).toMatch(/neither application\/linkset\+json nor a JSON linkset/);
    const typedButEmpty = await run(
      json({ linkset: [] }, { 'content-type': 'application/linkset+json' }),
    );
    expect(typedButEmpty.verdict).toBe('fail');
    expect(typedButEmpty.message).toBe('api-catalog linkset lists no links');
    expect(typedButEmpty.evidence).toMatchObject({ entries: 0, entries_with_links: 0 });
    const anchorsOnly = await run(json({ linkset: [{ anchor: '/' }, 'junk'] }));
    expect(anchorsOnly.verdict).toBe('fail');
    const typedNotJson = await run({
      status: 200,
      headers: { 'content-type': 'application/linkset+json' },
      body: 'not json',
    });
    expect(typedNotJson.verdict).toBe('fail');
    expect(typedNotJson.message).toMatch(/carries no linkset array/);
  });

  it('summarizes link contexts, relations and anchors', () => {
    expect(
      summarizeLinkset([{ anchor: 'a', item: [{}, {}], next: 'not-array' }, null, {}]),
    ).toEqual({
      entries: 2,
      entries_with_links: 1,
      items: 2,
      relations: ['item'],
      anchors: ['a'],
    });
  });
});

describe('A4.3 OAuth discovery for the MCP endpoint', () => {
  const pathMetadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const rootMetadata = `${origin}/.well-known/oauth-protected-resource`;
  const serverMetadata = `${origin}/.well-known/oauth-authorization-server`;
  const protectedResource = {
    resource: endpoint,
    authorization_servers: ['https://auth.shop.example'],
  };
  const authorizationServer = {
    issuer: 'https://shop.example',
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
  };
  const run = (responses: Record<string, MapResponse>, outcomes = discovered()) => {
    const fetcher = mapFetcher(responses);
    return runCheck(oauthDiscoveryForMcp, targetFor(), fetcher, outcomes).then((outcome) => ({
      outcome,
      requests: fetcher.requestCount,
    }));
  };

  it('skips with dependency_failed when A4.1 recorded no endpoint', async () => {
    const none = await runCheck(oauthDiscoveryForMcp, targetFor(), mapFetcher({}));
    expect(none.verdict).toBe('skip');
    expect(none.skipReason).toBe('dependency_failed');
    const empty = await runCheck(
      oauthDiscoveryForMcp,
      targetFor(),
      mapFetcher({}),
      discovered(null),
    );
    expect(empty.skipReason).toBe('dependency_failed');
    const bogus = await runCheck(
      oauthDiscoveryForMcp,
      targetFor(),
      mapFetcher({}),
      discovered('not a url'),
    );
    expect(bogus.skipReason).toBe('dependency_failed');
  });

  it('passes on protected resource metadata at the endpoint path, with one request', async () => {
    const { outcome, requests } = await run({ [pathMetadata]: json(protectedResource) });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toContain('1 authorization server(s)');
    expect(outcome.evidence).toMatchObject({
      endpoint,
      resource_metadata_url: pathMetadata,
      authorization_servers: ['https://auth.shop.example'],
      tried: [{ url: pathMetadata, status: 200 }],
    });
    expect(requests).toBe(1);
  });

  it('passes on protected resource metadata at the root well-known path', async () => {
    const { outcome } = await run({ [rootMetadata]: json(protectedResource) });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      resource_metadata_url: rootMetadata,
      tried: [
        { url: pathMetadata, status: 404 },
        { url: rootMetadata, status: 200 },
      ],
    });
  });

  it('passes when the endpoint answers 401 with a resource_metadata challenge', async () => {
    const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="catalog:read"`;
    const { outcome, requests } = await run({
      [endpoint]: { status: 401, headers: { 'www-authenticate': challenge }, body: '' },
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      endpoint_status: 401,
      www_authenticate: challenge,
      resource_metadata_url: `${origin}/.well-known/oauth-protected-resource/api/mcp`,
    });
    expect(requests).toBe(3);
  });

  it('warns when only authorization server metadata exists', async () => {
    const { outcome, requests } = await run({
      [serverMetadata]: json(authorizationServer),
      [endpoint]: { status: 405, headers: { allow: 'POST' }, body: '' },
    });
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toContain('issuer https://shop.example');
    expect(outcome.evidence).toMatchObject({
      issuer: 'https://shop.example',
      endpoint_status: 405,
      www_authenticate: null,
    });
    expect(requests).toBe(4);
  });

  it('fails when nothing is found, including a 401 without resource_metadata, within four requests', async () => {
    const { outcome, requests } = await run({
      [endpoint]: { status: 401, headers: { 'www-authenticate': 'Bearer realm="shop"' }, body: '' },
      [rootMetadata]: json({ resource: endpoint, authorization_servers: [] }),
      [serverMetadata]: json({ issuer: 'https://shop.example' }),
    });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evidence).toMatchObject({ endpoint_status: 401 });
    expect(outcome.evidence.tried).toHaveLength(4);
    expect(requests).toBe(4);
  });

  it('looks up metadata on the endpoint host and skips the path form for a root endpoint', async () => {
    const remote = 'https://mcp.shop.example/';
    const fetcher = mapFetcher({
      'https://mcp.shop.example/.well-known/oauth-protected-resource': json(protectedResource),
    });
    const outcome = await runCheck(oauthDiscoveryForMcp, targetFor(), fetcher, discovered(remote));
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence.tried).toEqual([
      { url: 'https://mcp.shop.example/.well-known/oauth-protected-resource', status: 200 },
    ]);
  });

  it('reads the resource_metadata parameter quoted or bare', () => {
    expect(resourceMetadataUrl('Bearer resource_metadata="https://a.example/x", scope="s"')).toBe(
      'https://a.example/x',
    );
    expect(resourceMetadataUrl('Bearer realm=x, resource_metadata=https://a.example/y')).toBe(
      'https://a.example/y',
    );
    expect(resourceMetadataUrl('Bearer realm="x"')).toBeNull();
    expect(resourceMetadataUrl(undefined)).toBeNull();
  });
});

describe('A4.4 MCP endpoint reachable', () => {
  it('passes on 406 from the reference transport', async () => {
    const outcome = await runCheck(
      mcpEndpointReachable,
      targetFor(),
      mapFetcher({ 'https://shop.example/mcp': { status: 406, body: 'Not Acceptable' } }),
      new Map([
        ['A4.1', { verdict: 'pass' as const, evidence: { endpoint: 'https://shop.example/mcp' } }],
      ]),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(/406/);
  });

  const run = (response?: FixtureResponse, outcomes = discovered()) =>
    runCheck(
      mcpEndpointReachable,
      targetFor(),
      mapFetcher(response === undefined ? {} : { [endpoint]: response }),
      outcomes,
    );

  it('skips with dependency_failed when A4.1 recorded no endpoint', async () => {
    const outcome = await run({ status: 405 }, new Map());
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('dependency_failed');
  });

  it('passes on 405 and reports the Allow header', async () => {
    const outcome = await run({
      status: 405,
      headers: { allow: 'POST', 'content-type': 'text/plain' },
      body: 'Method Not Allowed',
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toContain('405');
    expect(outcome.evidence).toEqual({
      endpoint,
      status: 405,
      content_type: 'text/plain',
      www_authenticate: false,
      allow: 'POST',
    });
  });

  it('passes on 401 with WWW-Authenticate and fails on 401 without it', async () => {
    const authorized = await run({
      status: 401,
      headers: { 'www-authenticate': 'Bearer realm="mcp"' },
    });
    expect(authorized.verdict).toBe('pass');
    expect(authorized.evidence).toMatchObject({ status: 401, www_authenticate: true, allow: null });
    const bare = await run({ status: 401 });
    expect(bare.verdict).toBe('fail');
    expect(bare.message).toContain('without a WWW-Authenticate header');
  });

  it('passes on 200 with text/event-stream or application/json', async () => {
    const stream = await run({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: 'event: endpoint\n',
    });
    expect(stream.verdict).toBe('pass');
    expect(stream.evidence).toMatchObject({ content_type: 'text/event-stream' });
    const jsonBody = await run(json({ jsonrpc: '2.0' }));
    expect(jsonBody.verdict).toBe('pass');
  });

  it('fails on 404, 5xx and no response', async () => {
    const gone = await run();
    expect(gone.verdict).toBe('fail');
    expect(gone.message).toContain('404');
    const down = await run({ status: 503, body: 'down' });
    expect(down.verdict).toBe('fail');
    expect(down.message).toBe('the endpoint answers HTTP 503');
    const unreachable = await run({ status: 0 });
    expect(unreachable.verdict).toBe('fail');
    expect(unreachable.message).toMatch(/could not be fetched/);
    expect(unreachable.evidence).toMatchObject({ status: 0 });
  });

  it('fails on an HTML page and on other non-transport answers', async () => {
    const page = await run({ status: 200, headers: { 'content-type': 'text/html' }, body: HTML });
    expect(page.verdict).toBe('fail');
    expect(page.message).toMatch(/HTML page/);
    const untyped = await run({ status: 200, body: HTML });
    expect(untyped.verdict).toBe('fail');
    expect(untyped.message).toMatch(/HTML page/);
    const plain = await run({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' });
    expect(plain.verdict).toBe('fail');
    expect(plain.message).toContain('HTTP 200 with text/plain');
  });
});

describe('A4.5 A2A agent card', () => {
  const current = `${origin}/.well-known/agent-card.json`;
  const legacy = `${origin}/.well-known/agent.json`;
  const complete = {
    name: 'Shop agent',
    description: 'Answers product questions.',
    version: '1.0.0',
    supportedInterfaces: [
      { url: `${origin}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
    ],
    capabilities: { streaming: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [{ id: 'search', name: 'Search', description: 'Finds products.', tags: ['catalog'] }],
  };
  const run = (responses: Record<string, MapResponse>) =>
    runCheck(a2aAgentCard, targetFor(), mapFetcher(responses));

  it('passes on a card with every required field', async () => {
    const outcome = await run({ [current]: json(complete) });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('A2A agent card "Shop agent" with every required field');
    expect(outcome.evidence).toMatchObject({
      path: '/.well-known/agent-card.json',
      status: 200,
      name: 'Shop agent',
      missing: [],
    });
    expect(outcome.evidence.present).toHaveLength(8);
  });

  it('warns when the card lacks some fields, naming them', async () => {
    const partial = Object.fromEntries(
      Object.entries(complete).filter(([field]) => field !== 'skills' && field !== 'capabilities'),
    );
    const outcome = await run({ [current]: json(partial) });
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe('A2A agent card lacks capabilities, skills');
    expect(outcome.evidence).toMatchObject({
      path: '/.well-known/agent-card.json',
      missing: ['capabilities', 'skills'],
    });
  });

  it('warns when a card is found only at the pre-0.3 path', async () => {
    const outcome = await run({ [legacy]: json({ ...complete, url: `${origin}/a2a` }) });
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toContain('/.well-known/agent.json');
    expect(outcome.evidence).toMatchObject({
      status: 404,
      legacy_status: 200,
      path: '/.well-known/agent.json',
      missing: [],
    });
  });

  it('fails when neither path answers JSON, and does not probe the legacy path after a 200', async () => {
    const none = await run({});
    expect(none.verdict).toBe('fail');
    expect(none.evidence).toMatchObject({ status: 404, legacy_status: 404, path: null });
    const legacyHtml = await run({ [legacy]: HTML });
    expect(legacyHtml.verdict).toBe('fail');
    const fetcher = mapFetcher({ [current]: HTML, [legacy]: json(complete) });
    const soft = await runCheck(a2aAgentCard, targetFor(), fetcher);
    expect(soft.verdict).toBe('fail');
    expect(soft.message).toMatch(/not a JSON object/);
    expect(fetcher.requestCount).toBe(1);
  });
});

describe('A4.6 WebMCP tool declarations', () => {
  const product = `${origin}/product/mug/`;
  const declarative = `<!doctype html><html><body>
    <form toolname="search_products" tooldescription="Search the catalog">
      <input name="q" toolparamdescription="Search terms">
    </form>
    <button toolname="add_to_cart" tooldescription="Add this product">Add</button>
    <form toolname="  ">ignored</form>
  </body></html>`;
  const imperative = `<!doctype html><html><body>
    <script src="/app.js"></script>
    <script>if (navigator.modelContext) { navigator.modelContext.registerTool({ name: 'checkout' }); }</script>
    <script>document.modelContextMenu = 1;</script>
  </body></html>`;

  it('passes naming the declarative tools and scripts found across home and product pages', async () => {
    const outcome = await runCheck(
      webMcpToolDeclarations,
      targetFor({ homeHtml: declarative, products: [product] }),
      mapFetcher({ [product]: imperative }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      'WebMCP declarations found: 2 declarative tool(s): search_products, add_to_cart; 1 inline script(s) using modelContext',
    );
    expect(outcome.evidence).toEqual({
      pages_scanned: 2,
      declarative_tools: 2,
      tool_names: ['search_products', 'add_to_cart'],
      tool_param_descriptions: 1,
      scripts_with_model_context: 1,
      pages_with_declarations: [`${origin}/`, product],
    });
  });

  it('passes with an informational message when nothing is declared', async () => {
    const outcome = await runCheck(webMcpToolDeclarations, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('no WebMCP declarations (informational)');
    expect(outcome.evidence).toMatchObject({
      pages_scanned: 1,
      declarative_tools: 0,
      scripts_with_model_context: 0,
      pages_with_declarations: [],
    });
  });

  it('ignores external scripts and unrelated modelContext look-alikes', () => {
    expect(webMcpSignals(new HtmlDocument(imperative))).toEqual({
      tools: [],
      parameters: 0,
      scripts: 1,
    });
    expect(webMcpSignals(new HtmlDocument(declarative)).tools).toEqual([
      'search_products',
      'add_to_cart',
    ]);
  });
});
