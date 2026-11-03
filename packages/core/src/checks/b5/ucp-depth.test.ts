import { describe, expect, it } from 'vitest';

import type { CheckOutcome } from '../types.js';
import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import { ucpMcpTools, ucpSigningKeys } from './ucp-depth.js';

const MCP = 'https://shop.example/ucp/mcp';
const EC = { kid: 'k1', kty: 'EC', crv: 'P-256', x: 'xx', y: 'yy', alg: 'ES256' };

function profileOutcome(evidence: Record<string, unknown>): Map<string, CheckOutcome> {
  return new Map([['B5.1', { verdict: 'pass', evidence }]]);
}

const mcpProfile = (capabilities: string[]) => ({
  services: { 'dev.ucp.shopping': [{ version: '2026-08-25', transport: 'mcp', endpoint: MCP }] },
  capabilities: Object.fromEntries(capabilities.map((id) => [id, [{ version: '2026-08-25' }]])),
  payment_handlers: {},
});

const toolsAnswer = (names: string[]) => ({
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { tools: names.map((name) => ({ name })) },
  }),
});

const CHECKOUT_TOOLS = [
  'create_checkout',
  'get_checkout',
  'update_checkout',
  'complete_checkout',
  'cancel_checkout',
];

describe('B5.10 UCP signing keys', () => {
  const run = (keys: unknown[]) =>
    runCheck(ucpSigningKeys, targetFor(), mapFetcher({}), profileOutcome({ keys }));

  it('passes on complete public keys', async () => {
    const outcome = await run([EC, { kid: 'k2', kty: 'OKP', crv: 'Ed25519', x: 'xx' }]);
    expect(outcome.verdict).toBe('pass');
  });

  it('fails when a key carries private material', async () => {
    const outcome = await run([{ ...EC, d: 'secret' }]);
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('k1 (d)');
  });

  it('fails on a symmetric key', async () => {
    expect((await run([{ kid: 'h', kty: 'oct', k: 'c2VjcmV0' }])).verdict).toBe('fail');
  });

  it('warns on a missing member or a duplicate kid, and allows unknown key types', async () => {
    const missing = await run([{ kid: 'k1', kty: 'EC', crv: 'P-256', x: 'xx' }]);
    expect(missing.verdict).toBe('warn');
    expect(missing.message).toContain('k1 lacks y');
    expect((await run([EC, EC])).message).toContain('kid k1 is used more than once');
    expect((await run([{ kid: 'pq', kty: 'AKP', alg: 'ML-DSA-44', pub: 'xx' }])).verdict).toBe(
      'pass',
    );
  });

  it('is not applicable without keys', async () => {
    expect((await run([])).verdict).toBe('skip');
  });
});

describe('B5.11 UCP MCP tools', () => {
  const run = (capabilities: string[], fetcher = mapFetcher({})) =>
    runCheck(
      ucpMcpTools,
      targetFor(),
      fetcher,
      profileOutcome({ profile: mcpProfile(capabilities) }),
    );

  it('passes when the stateless tools/list offers every checkout tool', async () => {
    const fetcher = mapFetcher({ [MCP]: toolsAnswer(CHECKOUT_TOOLS) });
    const outcome = await run(['dev.ucp.shopping.checkout'], fetcher);
    expect(outcome.verdict).toBe('pass');
    expect(fetcher.log).toHaveLength(1);
  });

  it('warns when a declared cart has no cart tools, after a session handshake', async () => {
    const fetcher = mapFetcher({
      [MCP]: [
        {
          status: 400,
          body: 'Session ID required',
          when: { method: 'POST', headers: { 'mcp-method': 'tools/list' } },
        },
        {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' },
          body: '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}',
          when: { method: 'POST', headers: { 'mcp-protocol-version': '2025-06-18' } },
        },
        {
          ...toolsAnswer(CHECKOUT_TOOLS),
          when: {
            method: 'POST',
            headers: { 'mcp-session-id': 's1', 'mcp-protocol-version': '2025-06-18' },
          },
        },
      ],
    });
    const outcome = await run(['dev.ucp.shopping.checkout', 'dev.ucp.shopping.cart'], fetcher);
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toContain(
      'dev.ucp.shopping.cart lacks create_cart, get_cart, update_cart, cancel_cart',
    );
    expect(outcome.evidence).toMatchObject({ session: true });
  });

  it('reads a tool list larger than 200 KB, as Shopify serves with full schemas', async () => {
    const big = toolsAnswer(CHECKOUT_TOOLS);
    const body = JSON.parse(big.body) as { result: { tools: Record<string, unknown>[] } };
    body.result.tools[0] = { ...body.result.tools[0], description: 'x'.repeat(250_000) };
    const fetcher = mapFetcher({ [MCP]: { ...big, body: JSON.stringify(body) } });
    expect((await run(['dev.ucp.shopping.checkout'], fetcher)).verdict).toBe('pass');
  });

  it('skips when the endpoint asks for authorization', async () => {
    const fetcher = mapFetcher({ [MCP]: { status: 401, body: 'Unauthorized' } });
    const outcome = await run(['dev.ucp.shopping.checkout'], fetcher);
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'error' });
  });

  it('fails when the endpoint lists none of the UCP tools', async () => {
    const outcome = await run(
      ['dev.ucp.shopping.checkout'],
      mapFetcher({ [MCP]: toolsAnswer(['search']) }),
    );
    expect(outcome.verdict).toBe('fail');
  });

  it('is not applicable without an MCP binding', async () => {
    const outcome = await runCheck(
      ucpMcpTools,
      targetFor(),
      mapFetcher({}),
      profileOutcome({ profile: { services: {}, capabilities: {}, payment_handlers: {} } }),
    );
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });
});
