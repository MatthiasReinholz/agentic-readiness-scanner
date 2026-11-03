import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ScanResultSchema } from '@agentic-readiness/catalog';
import { scan } from '@agentic-readiness/core';
import { fetcherAsFetch, fixtureFetcher } from '@agentic-readiness/core/testing';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { MemoryHistoryStore } from './history/memory.js';
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
  const history = new MemoryHistoryStore();
  const config = configFromEnv({ APP_BASE_URL: 'https://scanner.example' });
  const app = createApp({
    config,
    store,
    history,
    fetchFactory: () => fetcherAsFetch(fixtureFetcher(fixture, { budget: 1_000_000 })),
    minIntervalMs: 0,
    now: () => new Date('2026-10-30T12:00:00Z'),
  });
  return { app, store, history };
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
    expect(home.headers.get('link')).toContain('rel="ai-catalog"');
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
    const card = await app.request('/mcp/server-card');
    expect(card.headers.get('content-type')).toContain('application/mcp-server-card+json');
    expect(card.headers.get('access-control-allow-origin')).toBe('*');
    expect(await card.json()).toMatchObject({
      name: 'Agentic Readiness Scanner',
      remotes: [{ type: 'streamable-http', url: 'https://scanner.example/mcp' }],
      endpoint: 'https://scanner.example/mcp',
      tools: ['scan_store', 'get_history', 'get_fix', 'explain_check', 'list_checks'],
    });
    const legacy = await app.request('/.well-known/mcp/server-card.json');
    expect(legacy.status).toBe(200);
    const aiCatalog = await app.request('/.well-known/ai-catalog.json');
    expect(aiCatalog.headers.get('content-type')).toContain('application/ai-catalog+json');
    expect(await aiCatalog.json()).toMatchObject({
      entries: [
        {
          type: 'application/mcp-server-card+json',
          url: 'https://scanner.example/mcp/server-card',
        },
      ],
    });
    const robots = await (await app.request('/robots.txt')).text();
    expect(robots).toContain('User-agent: __usage_ai-training');
    expect(robots).toContain('User-agent: OAI-SearchBot');
    expect(robots).toContain('Disallow: /h/');
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

  it('records history per host and serves it as a page and as JSON', async () => {
    const { app } = testApp();
    const { id } = (await (
      await app.request('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://ceramics.example/' }),
      })
    ).json()) as { id: string };
    const report = await (await app.request(`/r/${id}`)).text();
    expect(report).toContain('First scan of ceramics.example');
    expect(report).toContain('href="/h/ceramics.example"');

    const html = await app.request('/h/ceramics.example');
    expect(html.status).toBe(200);
    const text = await html.text();
    expect(text).toContain('1 distinct state across 1 scan');
    expect(text).toContain(`href="/r/${id}"`);

    const json = await app.request('/h/ceramics.example.json');
    expect(json.headers.get('content-type')).toContain('application/json');
    const body = (await json.json()) as {
      host: string;
      states: {
        first_scan_id: string;
        scans: number;
        verdicts: Record<string, string>;
        changes: unknown;
      }[];
    };
    expect(body.host).toBe('ceramics.example');
    expect(body.states[0]).toMatchObject({ first_scan_id: id, scans: 1, changes: null });
    expect(body.states[0]?.verdicts['A1.1']).toBe('pass');

    expect((await app.request('/h/never-scanned.example')).status).toBe(404);
    expect((await app.request('/h/never-scanned.example.json')).status).toBe(404);
    expect((await app.request('/h/not a host')).status).toBe(404);
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

  it('stores www. and the bare host under one key', async () => {
    const { app, store } = testApp();
    const first = (await (
      await app.request('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://ceramics.example/' }),
      })
    ).json()) as { id: string };
    expect((await store.get(first.id))?.host).toBe('ceramics.example');
    const second = (await (
      await app.request('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://www.ceramics.example/' }),
      })
    ).json()) as { id: string; reused: boolean };
    expect(second).toMatchObject({ id: first.id, reused: true });
    const history = await app.request('/h/www.ceramics.example.json');
    expect(history.status).toBe(301);
    expect(history.headers.get('location')).toBe('/h/ceramics.example.json');
    expect((await app.request('/badge/www.ceramics.example.svg')).status).toBe(200);
  });

  it('limits new scans to one per host per minute and disallows a shorter configured window', () => {
    expect(configFromEnv({}).targetCooldownSeconds).toBe(60);
    expect(configFromEnv({ TARGET_COOLDOWN_SECONDS: '1' }).targetCooldownSeconds).toBe(60);
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
    expect(response.headers.get('location')).toBe('/sites/ceramics.example');
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

describe('legal signals', () => {
  it('serves them beside the report, never indexed, crawled or exported with readiness', async () => {
    const { app } = testApp();
    const scan = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'ceramics.example' }),
    });
    const body = (await scan.json()) as { id: string; result: { legal?: { results: unknown[] } } };
    expect(body.result.legal?.results.length).toBeGreaterThan(0);

    const robots = await (await app.request('/robots.txt')).text();
    expect(robots).toContain('Disallow: /sites/*/legal');
    expect(robots).toContain('Disallow: /r/*/legal');
    const sitemap = await (await app.request('/sitemap.xml')).text();
    expect(sitemap).not.toContain('/legal<');

    for (const path of ['/sites/ceramics.example/legal', `/r/${body.id}/legal`]) {
      const html = await app.request(path);
      expect(html.status).toBe(200);
      expect(html.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
      const text = await html.text();
      expect(text).toContain('<meta name="robots" content="noindex, nofollow, noarchive">');
      expect(text).toContain('not legal advice');
    }
    const json = (await (await app.request('/sites/ceramics.example/legal.json')).json()) as {
      notice: string;
      results: { laws: unknown[] }[];
    };
    expect(json.notice).toContain('not legal advice');
    expect(json.results.some((item) => item.laws.length > 0)).toBe(true);
    const markdown = await (await app.request(`/r/${body.id}/legal.md`)).text();
    expect(markdown).toMatch(/^# Legal signals for https:\/\/ceramics\.example/);

    const readiness = (await (
      await app.request('/sites/ceramics.example/report.json')
    ).json()) as Record<string, unknown>;
    expect(readiness.legal).toBeUndefined();
    const report = await (await app.request('/sites/ceramics.example')).text();
    expect(report).toContain('href="/sites/ceramics.example/legal" rel="nofollow"');
    expect(report).not.toContain('data-legal-status');
  });
});
