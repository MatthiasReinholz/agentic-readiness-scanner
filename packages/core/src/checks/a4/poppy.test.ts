import { describe, expect, it } from 'vitest';

import type { Fetcher } from '../../http/types.js';
import { authorizationServerMetadataUrl, readPoppyDocument } from '../../parsers/poppy.js';
import { mapFetcher, runCheck, targetFor, type MapResponse } from '../../testing/index.js';
import { poppyDiscovery } from './poppy.js';

const ORIGIN = 'https://shop.example';
const POPPY = `${ORIGIN}/.well-known/poppy.json`;
const PRM = `${ORIGIN}/.well-known/oauth-protected-resource`;
const ISSUER = 'https://auth.shop.example';
const AS = `${ISSUER}/.well-known/oauth-authorization-server`;
const JSON_HEADERS = { 'content-type': 'application/json' };

const json = (body: unknown, status = 200): MapResponse => ({
  status,
  headers: JSON_HEADERS,
  body: JSON.stringify(body),
});

const DOCUMENT = {
  protocol_version: '0.4',
  organization: { name: 'Shop', domain: 'shop.example', logo_uri: `${ORIGIN}/logo.png` },
  auth: {
    scopes: { 'orders:read': 'See your orders' },
    scope_hints: { 'orders:read': { changes: 'none', personal_data: true } },
  },
  agent: {
    protocols: [{ type: 'poppy', endpoint: 'https://api.shop.example/poppy/conversations' }],
  },
  web: { browser_session_endpoint: `${ORIGIN}/poppy/browser-session` },
  apis: [{ type: 'mcp', url: `${ORIGIN}/mcp`, description: 'Product search' }],
  extensions: { operations: [{ version: '3' }] },
};

const SERVER_METADATA = {
  issuer: ISSUER,
  token_endpoint: `${ISSUER}/oauth/token`,
  revocation_endpoint: `${ISSUER}/oauth/revoke`,
  authorization_endpoint: `${ISSUER}/oauth/authorize`,
  grant_types_supported: ['refresh_token', 'authorization_code'],
  protected_resources: ['https://SHOP.example', 'https://shop.example/mcp'],
};

function run(responses: Record<string, MapResponse>, fetcher?: Fetcher) {
  return runCheck(
    poppyDiscovery,
    targetFor({ platform: 'unknown' }),
    fetcher ?? mapFetcher(responses),
  );
}

describe('A4.10 Poppy discovery document', () => {
  it('passes a valid document whose issuer confirms the domain', async () => {
    const outcome = await run({
      [POPPY]: json(DOCUMENT),
      [PRM]: json({ resource: ORIGIN, authorization_servers: [ISSUER] }),
      [AS]: json(SERVER_METADATA),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      `Poppy 0.4 discovery document for Shop: offers a company agent (poppy), APIs (mcp), the website; issuer ${ISSUER} verified (Direct Sign-In)`,
    );
    expect(outcome.evidence).toMatchObject({
      protocol_version: '0.4',
      apis: ['mcp'],
      extensions: ['operations'],
      issuer: ISSUER,
    });
  });

  it('passes a signed-out document when the domain has no issuer', async () => {
    const outcome = await run({
      [POPPY]: json({
        protocol_version: '0.4',
        organization: { name: 'Shop', domain: 'shop.example' },
        web: {},
      }),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toContain('no issuer, so agents use signed-out sessions only');
  });

  it('is not applicable when there is no document', async () => {
    const outcome = await run({});
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
  });

  it('is inconclusive when the request is throttled', async () => {
    const outcome = await run({ [POPPY]: { status: 429, body: '' } });
    expect(outcome.skipReason).toBe('error');
  });

  it('fails a document that speaks for another domain', async () => {
    const outcome = await run({
      [POPPY]: json({ ...DOCUMENT, organization: { name: 'Shop', domain: 'other.example' } }),
    });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain(
      'organization.domain other.example is not the host that served it (shop.example)',
    );
  });

  it('fails a document without any channel or with plain HTTP URLs', async () => {
    const outcome = await run({
      [POPPY]: json({
        protocol_version: '1',
        organization: {
          name: 'Shop',
          domain: 'shop.example',
          logo_uri: 'http://shop.example/l.png',
        },
      }),
    });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('protocol_version is missing or not major.minor');
    expect(outcome.message).toContain('organization.logo_uri is not an HTTPS URL');
    expect(outcome.message).toContain('none of agent, apis or web is declared');
  });

  it('fails an HTML page served at the well-known path', async () => {
    const outcome = await run({
      [POPPY]: {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: '<!doctype html><p>Not found</p>',
      },
    });
    expect(outcome.message).toContain('HTML page');
  });

  it('fails a document reached by a redirect to another path', async () => {
    const outcome = await run(
      {},
      {
        requestCount: 0,
        budget: 40,
        fetch: () =>
          Promise.resolve({
            url: POPPY,
            finalUrl: `${ORIGIN}/uploads/poppy.json`,
            hops: [POPPY],
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(DOCUMENT),
            bytes: 10,
            truncated: false,
            redirects: 1,
            durationMs: 1,
            fromCache: false,
          }),
      },
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('redirects to /uploads/poppy.json');
  });

  it('fails when the document declares sign-in but the domain names no issuer', async () => {
    const outcome = await run({
      [POPPY]: json({ ...DOCUMENT, auth: { issuer: ISSUER } }),
      [PRM]: { status: 404, body: '' },
    });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('publishes no authorization server');
  });

  it('fails protected resource metadata for another resource', async () => {
    const outcome = await run({
      [POPPY]: json(DOCUMENT),
      [PRM]: json({ resource: `${ORIGIN}/mcp`, authorization_servers: [ISSUER] }),
    });
    expect(outcome.message).toContain(`instead of ${ORIGIN}`);
  });

  it('requires auth.issuer to choose among several authorization servers', async () => {
    const outcome = await run({
      [POPPY]: json(DOCUMENT),
      [PRM]: json({
        resource: ORIGIN,
        authorization_servers: [ISSUER, 'https://staff.shop.example'],
      }),
    });
    expect(outcome.message).toContain('auth.issuer must name one of them, and it is missing');
  });

  it('fails an issuer whose metadata does not list the domain', async () => {
    const outcome = await run({
      [POPPY]: json(DOCUMENT),
      [PRM]: json({ resource: ORIGIN, authorization_servers: [ISSUER] }),
      [AS]: json({ ...SERVER_METADATA, protected_resources: ['https://shop.example/'] }),
    });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain(`protected_resources does not list ${ORIGIN}`);
  });

  it('fails when the protected resource metadata answers an error other than 404', async () => {
    const outcome = await run({
      [POPPY]: json(DOCUMENT),
      [PRM]: { status: 403, body: '' },
    });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('may only assume no issuer after a 404');
  });
});

describe('readPoppyDocument', () => {
  // The cases of the protocol's own validator (kit/company/validate/test/schema.test.ts).
  const official = {
    protocol_version: '0.4',
    organization: { name: 'Alpine Retail', domain: 'alpine-retail.example' },
    auth: {
      issuer: 'https://auth.alpine-retail.example',
      scopes: { 'orders:read': 'See your orders and returns' },
    },
    agent: {
      protocols: [
        { type: 'poppy', endpoint: 'https://api.alpine-retail.example/poppy/conversations' },
      ],
    },
  };

  it("accepts the protocol validator's valid document and needs its issuer", () => {
    const reading = readPoppyDocument(official, 'alpine-retail.example');
    expect(reading.problems).toEqual([]);
    expect(reading.summary).toMatchObject({
      issuer: 'https://auth.alpine-retail.example',
      needsIssuer: true,
      agentProtocols: ['poppy'],
    });
  });

  it('rejects what the protocol validator rejects', () => {
    expect(
      readPoppyDocument(
        {
          ...official,
          protocol_version: 1,
          organization: { name: 'A', domain: 'https://a.example/' },
        },
        'alpine-retail.example',
      ).problems,
    ).toEqual([
      'protocol_version is missing or not major.minor',
      'organization.domain is missing or not a domain name',
    ]);
    const withoutInterfaces: Record<string, unknown> = { ...official };
    delete withoutInterfaces.agent;
    expect(readPoppyDocument(withoutInterfaces, 'alpine-retail.example').problems).toEqual([
      'none of agent, apis or web is declared',
    ]);
  });

  it('ignores unknown fields and compares the domain without regard to case', () => {
    const reading = readPoppyDocument(
      {
        protocol_version: '1.0',
        organization: { name: 'Shop', domain: 'Shop.Example' },
        web: {},
        future: 1,
      },
      'shop.example',
    );
    expect(reading.problems).toEqual([]);
    expect(reading.summary?.web).toBe('offered');
  });

  it('keeps supported versions on the serving host and checks extension entries', () => {
    const reading = readPoppyDocument(
      {
        ...DOCUMENT,
        supported_versions: { '0.3': 'https://cdn.example/poppy-0.3.json' },
        extensions: { 'example.com/gift-wrap': [{ endpoint: `${ORIGIN}/gift` }] },
      },
      'shop.example',
    );
    expect(reading.problems).toEqual([
      'supported_versions 0.3 is not on shop.example',
      'extensions example.com/gift-wrap has an entry without a version',
    ]);
  });

  it('refuses signed_in access while sign-in is turned off', () => {
    const reading = readPoppyDocument(
      {
        ...DOCUMENT,
        auth: { disabled: true },
        agent: { protocols: [{ type: 'poppy', endpoint: `${ORIGIN}/c`, access: 'signed_in' }] },
      },
      'shop.example',
    );
    expect(reading.problems).toContain(
      'auth.disabled is set, but signed_in access or Mediated Sign-In is declared',
    );
  });

  it('places issuer metadata where RFC 8414 puts it', () => {
    expect(authorizationServerMetadataUrl('https://auth.example')).toBe(
      'https://auth.example/.well-known/oauth-authorization-server',
    );
    expect(authorizationServerMetadataUrl('https://auth.provider.example/shop-a')).toBe(
      'https://auth.provider.example/.well-known/oauth-authorization-server/shop-a',
    );
  });
});
