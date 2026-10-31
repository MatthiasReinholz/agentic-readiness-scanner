import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalog, getCheck } from '@agentic-readiness/catalog';
import { scan } from '@agentic-readiness/core';
import { fixtureFetcher } from '@agentic-readiness/core/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { createMcpServer } from './index.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'stores',
  'good-woocommerce',
);

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({
    scanner: (url, profile) =>
      scan(url, {
        fetcher: fixtureFetcher(fixture),
        ...(profile !== undefined ? { profile } : {}),
      }),
  });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as { type: string; text?: string }[];
  return content.find((item) => item.type === 'text')?.text ?? '';
}

describe('MCP server', () => {
  it('exposes scan_store, get_fix and list_checks', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['get_fix', 'list_checks', 'scan_store']);
  });

  it('scans a store and returns the result object', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'scan_store',
      arguments: { url: 'ceramics.example' },
    });
    const parsed = JSON.parse(textOf(result)) as {
      target: { platform: string };
      level: { value: number };
    };
    expect(parsed.target.platform).toBe('woocommerce');
    expect(parsed.level.value).toBeGreaterThanOrEqual(1);
  });

  it('returns the Markdown report when asked for that format', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'scan_store',
      arguments: { url: 'ceramics.example', format: 'markdown' },
    });
    const text = textOf(result);
    expect(text.startsWith('# Agentic readiness report for https://ceramics.example')).toBe(true);
    expect(() => {
      JSON.parse(text);
    }).toThrow();
  });

  it('returns the fix for a check with a composed agent brief, and errors on unknown ids', async () => {
    const client = await connectedClient();
    const fix = JSON.parse(
      textOf(await client.callTool({ name: 'get_fix', arguments: { check_id: 'B3.1' } })),
    ) as {
      id: string;
      spec: { url: string }[];
      fix: { auto_fix: boolean; agent_prompt: string };
      agent_brief: string;
    };
    expect(fix.id).toBe('B3.1');
    expect(fix.fix.auto_fix).toBe(true);
    expect(fix.spec.length).toBeGreaterThan(0);
    expect(fix.agent_brief).toContain(fix.fix.agent_prompt);
    expect(fix.agent_brief).toContain(getCheck('B3.1')?.title ?? 'missing');
    const unknown = await client.callTool({ name: 'get_fix', arguments: { check_id: 'B9.9' } });
    expect(unknown.isError).toBe(true);
  });

  it('lists the whole catalog with versions, groups, levels, profiles and one entry per check', async () => {
    const client = await connectedClient();
    const listed = JSON.parse(
      textOf(await client.callTool({ name: 'list_checks', arguments: {} })),
    ) as {
      catalog_version: string;
      scoring_version: string;
      groups: unknown[];
      levels: unknown[];
      profiles: unknown[];
      checks: Record<string, unknown>[];
    };
    expect(listed.catalog_version).toBe(catalog.version);
    expect(listed.scoring_version).toBe(catalog.scoring_version);
    expect(listed.groups).toHaveLength(catalog.groups.length);
    expect(listed.levels).toHaveLength(catalog.levels.length);
    expect(listed.profiles).toHaveLength(catalog.profiles.length);
    expect(listed.checks).toHaveLength(catalog.checks.length);
    expect(Object.keys(listed.checks[0] ?? {}).sort()).toEqual([
      'depends_on',
      'group',
      'id',
      'question',
      'requires',
      'title',
      'weight',
    ]);
  });
});
