import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ScanResultSchema } from '@agentic-readiness/catalog';
import { scan } from '@agentic-readiness/core';
import { fixtureFetcher } from '@agentic-readiness/core/testing';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { MemoryResultStore } from './store/memory.js';
import { attachFixes, stripFixes } from './store/sql.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'stores',
  'good-woocommerce',
);

function testApp() {
  const store = new MemoryResultStore();
  const config = configFromEnv({ APP_BASE_URL: 'https://scanner.example' });
  const app = createApp({
    config,
    store,
    fetcherFactory: () => fixtureFetcher(fixture),
    now: () => new Date('2026-10-30T12:00:00Z'),
  });
  return { app, store };
}

describe('hosted app', () => {
  it('sets security headers on every response and discovery links on the home page', async () => {
    const { app } = testApp();
    const home = await app.request('/');
    expect(home.headers.get('x-content-type-options')).toBe('nosniff');
    expect(home.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(home.headers.get('link')).toContain(
      '</llms.txt>; rel="llms-txt"'.replace('</', '<https://scanner.example/'),
    );
    expect(home.headers.get('link')).toContain('rel="mcp-server"');
    const health = await app.request('/health');
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('link')).toBeNull();
  });

  it('serves the form, llms.txt and the MCP server card', async () => {
    const { app } = testApp();
    expect((await app.request('/')).status).toBe(200);
    const llms = await app.request('/llms.txt');
    expect(llms.headers.get('content-type')).toContain('text/markdown');
    expect(await llms.text()).toContain('# Agentic Readiness Scanner');
    const card = await app.request('/.well-known/mcp/server-card.json');
    expect(await card.json()).toMatchObject({
      endpoint: 'https://scanner.example/mcp',
      tools: ['scan_store', 'get_fix', 'list_checks'],
    });
  });

  it('scans through the JSON API and serves the report in three formats plus a badge', async () => {
    const { app } = testApp();
    const response = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'ceramics.example' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; reused: boolean; result: unknown };
    expect(body.reused).toBe(false);
    expect(ScanResultSchema.safeParse(body.result).success).toBe(true);

    expect((await app.request(`/r/${body.id}`)).headers.get('content-type')).toContain('text/html');
    expect((await app.request(`/r/${body.id}.json`)).headers.get('content-type')).toContain(
      'application/json',
    );
    const markdown = await app.request(`/r/${body.id}.md`);
    expect(await markdown.text()).toContain('# Agentic readiness report');
    const negotiated = await app.request(`/r/${body.id}`, { headers: { accept: 'text/markdown' } });
    expect(negotiated.headers.get('content-type')).toContain('text/markdown');

    const badge = await app.request('/badge/ceramics.example.svg');
    expect(badge.headers.get('content-type')).toBe('image/svg+xml');
    expect(await badge.text()).toContain('Level');
  });

  it('reuses a recent result for the same host', async () => {
    const { app } = testApp();
    const first = (await (
      await app.request('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://ceramics.example/' }),
      })
    ).json()) as { id: string };
    const second = (await (
      await app.request('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ url: 'ceramics.example' }),
      })
    ).json()) as { id: string; reused: boolean };
    expect(second.reused).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('keeps the per-host cooldown even when a profile override is requested', async () => {
    const { app } = testApp();
    const first = (await (
      await app.request('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://ceramics.example/' }),
      })
    ).json()) as { id: string };
    const second = (await (
      await app.request('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://ceramics.example/', profile: 'other-store' }),
      })
    ).json()) as { id: string; reused: boolean };
    expect(second.reused).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('sends Vary: Accept on negotiated report URLs', async () => {
    const { app } = testApp();
    const { id } = (await (
      await app.request('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://ceramics.example/' }),
      })
    ).json()) as { id: string };
    expect((await app.request(`/r/${id}`)).headers.get('vary')).toBe('Accept');
    expect((await app.request(`/r/${id}.json`)).headers.get('vary')).toBe('Accept');
  });

  it('rejects bad input and unreachable targets with useful statuses', async () => {
    const { app } = testApp();
    expect((await app.request('/api/scan', { method: 'POST', body: '{}' })).status).toBe(400);
    expect(
      (
        await app.request('/api/scan', {
          method: 'POST',
          body: JSON.stringify({ url: 'http://localhost/' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/api/scan', {
          method: 'POST',
          body: JSON.stringify({ url: 'https://missing.example/' }),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await app.request('/api/scan', {
          method: 'POST',
          body: JSON.stringify({ url: 'x.example', profile: 'nope' }),
        })
      ).status,
    ).toBe(400);
    expect((await app.request('/r/0123456789abcdef')).status).toBe(404);
    expect((await app.request('/r/../etc')).status).toBe(404);
  });

  it('accepts the HTML form and redirects to the report', async () => {
    const { app } = testApp();
    const response = await app.request('/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'url=https%3A%2F%2Fceramics.example%2F&profile=',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toMatch(/^\/r\/[0-9a-f]{16}$/);
  });

  it('only runs cleanup for the cron caller', async () => {
    const { app } = testApp();
    expect((await app.request('/internal/cron/cleanup')).status).toBe(403);
    const response = await app.request('/internal/cron/cleanup', {
      headers: { 'x-spacefast-cron': '1' },
    });
    expect(await response.json()).toMatchObject({ removed: 0 });
  });
});

describe('fix stripping for storage', () => {
  it('round-trips a result with failures through strip and attach', async () => {
    const contentSite = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'fixtures',
      'stores',
      'content-site',
    );
    const result = await scan('https://blog.example/', { fetcher: fixtureFetcher(contentSite) });
    expect(result.results.some((item) => item.fix !== undefined)).toBe(true);
    const stripped = stripFixes(result);
    expect(stripped.results.every((item) => item.fix === undefined)).toBe(true);
    expect(JSON.stringify(stripped).length).toBeLessThan(JSON.stringify(result).length);
    expect(attachFixes(stripped)).toEqual(result);
  });
});
