import { fileURLToPath } from 'node:url';

import type { ScanResult } from '@agentic-readiness/catalog';
import { fixtureFetcher } from '@agentic-readiness/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { MemoryHistoryStore } from './history/memory.js';
import { MemoryMailer } from './monitoring/mailer.js';
import { MemoryMonitorStore } from './monitoring/memory.js';
import { MemoryProgressStore } from './progress/memory.js';
import { MemoryScanLimiter } from './rate-limit/memory.js';
import { isRootInput, profileHost, scanScope, siteProfilePath } from './scan-scope.js';
import { MemoryResultStore } from './store/memory.js';
import { MemoryTargetRegistry } from './targets/memory.js';

const fixture = fileURLToPath(
  new URL('../../../fixtures/stores/good-woocommerce', import.meta.url),
);
const token = '0123456789abcdef0123456789abcdef';

function harness(options: { redirect?: string; fail?: boolean } = {}) {
  const store = new MemoryResultStore();
  const history = new MemoryHistoryStore();
  const targets = new MemoryTargetRegistry();
  const progress = new MemoryProgressStore();
  const limiter = new MemoryScanLimiter();
  const monitors = new MemoryMonitorStore();
  const mailer = new MemoryMailer();
  const put = vi.spyOn(store, 'put');
  const saveProgress = vi.spyOn(progress, 'save');
  let time = Date.parse('2026-11-02T12:00:00Z');
  let scans = 0;
  const config = configFromEnv({
    APP_BASE_URL: 'https://scanner.example',
    MAIL_PROVIDER: 'console',
  });
  const app = createApp({
    config,
    store,
    history,
    targets,
    progress,
    limiter,
    monitors,
    mailer,
    now: () => new Date(time),
    fetcherFactory: () => {
      scans++;
      const f = fixtureFetcher(fixture);
      return {
        get budget() {
          return f.budget;
        },
        get requestCount() {
          return f.requestCount;
        },
        async fetch(url, fetchOptions) {
          if (options.fail) throw new Error('private query must not reach logs');
          const parsed = new URL(url);
          // Give each submitted starting path the same recorded storefront, preserving its scope.
          if (['/', '/de/', '/us/en/', '/one', '/two'].includes(parsed.pathname)) {
            const response = await f.fetch('https://ceramics.example/', fetchOptions);
            return { ...response, url, finalUrl: options.redirect ?? url };
          }
          return f.fetch(url, fetchOptions);
        },
      };
    },
  });
  function post(url: string, path = '/api/scan', extra: Record<string, unknown> = {}) {
    return app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, ...extra }),
    });
  }
  return {
    app,
    post,
    store,
    history,
    targets,
    progress,
    put,
    saveProgress,
    mailer,
    monitors,
    config,
    limiter,
    scans: () => scans,
    advance(seconds: number) {
      time += seconds * 1000;
    },
  };
}

describe('host identity and submitted scan scope', () => {
  it.each([
    ['HTTPS://WWW.Example.COM./#local', 'example.com', true],
    ['https://shop.example.com/', 'shop.example.com', true],
    ['https://example.com:443/', 'example.com', true],
    ['http://example.com:80/', 'example.com', true],
    ['https://example.com/de/', 'example.com', false],
    ['https://example.com/?token=secret', 'example.com', false],
    ['https://example.com:80/', 'example.com', false],
    ['https://bücher.example/', 'xn--bcher-kva.example', true],
  ])('classifies %s before cache lookup or redirects', (url, host, persistent) => {
    expect(scanScope(url)).toMatchObject({ host, persistent });
    expect(scanScope(url).url).not.toContain('#');
  });

  it('uses unambiguous host segments and rejects URL-shaped profile identifiers', () => {
    expect(siteProfilePath('WWW.Example.com')).toBe('/sites/example.com');
    expect(profileHost('example.co.md')).toBe('example.co.md');
    expect(profileHost('bücher.example')).toBe('xn--bcher-kva.example');
    expect(profileHost('[2606:4700:4700::1111]')).toBe('[2606:4700:4700::1111]');
    for (const value of [
      'example.com/path',
      'user@example.com',
      'example.com?secret',
      'example.com:80',
      'localhost',
      '127.0.0.1',
      'example.com%2Fpath',
    ])
      expect(profileHost(value), value).toBeNull();
    for (const value of [
      'https://localhost',
      'https://127.0.0.1',
      'https://user:secret@example.com',
      'ftp://example.com',
    ])
      expect(isRootInput(value), value).toBe(false);
  });
});

describe('root profiles and one-time scans', () => {
  it('returns a stable profile, keeps immutable snapshots, and never fetches during profile reads', async () => {
    const h = harness();
    const response = await h.post('https://ceramics.example/#discard-this');
    const body = (await response.json()) as {
      id: string;
      profile_id: string;
      profile_url: string;
      snapshot_url: string;
      result: ScanResult;
    };
    expect(body).toMatchObject({
      profile_id: 'ceramics.example',
      profile_url: 'https://scanner.example/sites/ceramics.example',
    });
    expect(body.result.target.input_url).toBe('https://ceramics.example/');
    const firstId = body.id;
    const profile = await h.app.request('/sites/ceramics.example');
    const html = await profile.text();
    expect(profile.status).toBe(200);
    expect(html).toContain(
      '<link rel="canonical" href="https://scanner.example/sites/ceramics.example">',
    );
    expect(html).toContain(`href="/r/${firstId}"`);
    expect(
      (await h.app.request('/sites/ceramics.example/report.json')).headers.get('content-type'),
    ).toContain('application/json');
    expect(
      (await h.app.request('/sites/ceramics.example/report.md')).headers.get('content-type'),
    ).toContain('text/markdown');
    expect((await h.app.request('/sites/WWW.CERAMICS.EXAMPLE')).headers.get('location')).toBe(
      '/sites/ceramics.example',
    );
    expect((await h.app.request('/sites/unscanned.example')).status).toBe(404);
    expect(h.scans()).toBe(1);
    h.advance(60);
    const second = (await (await h.post('https://ceramics.example/')).json()) as { id: string };
    expect(second.id).not.toBe(firstId);
    expect((await h.app.request(`/r/${firstId}`)).status).toBe(200);
    expect(await (await h.app.request('/sites/ceramics.example/report.json')).json()).toMatchObject(
      { scanned_at: '2026-11-02T12:01:00.000Z' },
    );
    h.advance(31 * 86_400);
    expect((await h.app.request(`/r/${firstId}`)).status).toBe(404);
    expect((await h.app.request('/sites/ceramics.example/report.json')).status).toBe(404);
    const expired = await h.app.request('/sites/ceramics.example');
    expect(expired.headers.get('vary')).toBe('Accept');
    expect(await expired.text()).toContain('retains recorded history');
    const markdown = await h.app.request('/sites/ceramics.example', {
      headers: { accept: 'text/markdown' },
    });
    expect(markdown.status).toBe(404);
    expect(markdown.headers.get('vary')).toBe('Accept');
  });

  it('returns path results directly with no storage, public IDs, progress records or mail', async () => {
    const h = harness();
    const response = await h.post('https://ceramics.example/de/?token=only-in-browser');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as {
      persistence: string;
      result: ScanResult;
      id?: string;
      report_url?: string;
    };
    expect(body.persistence).toBe('disposable');
    expect(body.result.target.input_url).toContain('/de/?token=only-in-browser');
    expect(body.id).toBeUndefined();
    expect(body.report_url).toBeUndefined();
    expect(h.put).not.toHaveBeenCalled();
    expect(await h.targets.list(10)).toEqual([]);
    expect(await h.history.forHost('ceramics.example', 10)).toEqual([]);
    expect(h.saveProgress).not.toHaveBeenCalled();
    expect(h.mailer.sent).toHaveLength(0);
    expect((await h.app.request('/sites/ceramics.example')).status).toBe(404);
  });

  it('bypasses all saved progress for disposable streams and returns the result directly', async () => {
    const h = harness();
    const response = await h.post('https://ceramics.example/de/', '/api/scan/stream', {
      progress_token: token,
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
    const text = await response.text();
    const final = text.split('\n\n').find((chunk) => chunk.startsWith('event: done')) ?? '';
    const data = JSON.parse(final.split('\ndata: ')[1] ?? '{}') as {
      persistence: string;
      result: ScanResult;
      report_url?: string;
    };
    expect(data.persistence).toBe('disposable');
    expect(data.report_url).toBeUndefined();
    expect(data.result.target.input_url).toBe('https://ceramics.example/de/');
    expect(h.saveProgress).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
    expect(await h.progress.load(token)).toBeNull();
  });

  it('renders a disposable form POST without JavaScript or a redirect', async () => {
    const h = harness();
    const response = await h.app.request('/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ url: 'https://ceramics.example/de/' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('One-time scan · not saved');
    expect(html).not.toMatch(
      /<base|rel="canonical"|property="og:|application\/ld\+json|id="monitor"|href="\/h\//,
    );
    expect(html).toContain('href="#A1.1"');
    expect(h.put).not.toHaveBeenCalled();
  });

  it('applies one host reservation across paths and root scans without returning a different scope', async () => {
    const h = harness();
    expect((await h.post('https://ceramics.example/de/')).status).toBe(200);
    for (const url of [
      'https://ceramics.example/us/en/',
      'https://www.ceramics.example/',
      'https://ceramics.example/',
    ]) {
      const response = await h.post(url);
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('60');
    }
    expect(h.scans()).toBe(1);
    h.advance(59);
    expect((await h.post('https://ceramics.example/two')).status).toBe(429);
    h.advance(1);
    expect((await h.post('https://ceramics.example/us/en/')).status).toBe(200);
    expect(h.scans()).toBe(2);
    h.advance(60);
    expect((await h.post('https://ceramics.example/')).status).toBe(200);
    const denied = await h.post('https://ceramics.example/de/');
    expect(denied.status).toBe(429);
    expect(await denied.text()).not.toContain('"result"');
    expect((await (await h.post('https://ceramics.example/')).json()) as unknown).toMatchObject({
      reused: true,
    });
    expect(h.scans()).toBe(3);
  });

  it('keeps subdomain profiles separate and validates unsafe URLs before root cache reuse', async () => {
    const h = harness();
    await h.post('https://ceramics.example/');
    expect((await h.post('https://shop.ceramics.example/')).status).toBe(200);
    expect((await h.app.request('/sites/shop.ceramics.example')).status).toBe(200);
    expect((await h.post('https://user:secret@ceramics.example/')).status).toBe(400);
    expect((await h.post('https://ceramics.example:9000/')).status).toBe(400);
    expect(h.scans()).toBe(2);
  });

  it('keeps a path disposable even when it redirects to root, and preserves root redirect evidence', async () => {
    const path = harness({ redirect: 'https://ceramics.example/' });
    expect(await (await path.post('https://ceramics.example/de/')).json()).toMatchObject({
      persistence: 'disposable',
    });
    expect(path.put).not.toHaveBeenCalled();
    const root = harness({ redirect: 'https://ceramics.example/de/' });
    expect(await (await root.post('https://ceramics.example/')).json()).toMatchObject({
      persistence: 'stored',
      result: {
        target: {
          input_url: 'https://ceramics.example/',
          sampled: { home: 'https://ceramics.example/de/' },
        },
      },
    });
  });

  it('retains the minute after failures without logging path data or writing failure progress', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const h = harness({ fail: true });
      await (
        await h.post('https://ceramics.example/de/?token=secret', '/api/scan/stream', {
          progress_token: token,
        })
      ).text();
      expect(h.saveProgress).not.toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain('private query');
      expect((await h.post('https://ceramics.example/')).status).toBe(429);
    } finally {
      log.mockRestore();
    }
  });

  it('denies concurrent different paths instead of sharing another caller’s result', async () => {
    const h = harness();
    const responses = await Promise.all([
      h.post('https://ceramics.example/one'),
      h.post('https://ceramics.example/two'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
    const successful = responses.find((response) => response.status === 200);
    expect(await successful?.json()).toMatchObject({
      persistence: 'disposable',
      result: { target: { input_url: 'https://ceramics.example/one' } },
    });
    expect(h.scans()).toBe(1);
    expect(h.put).not.toHaveBeenCalled();
  });

  it('keeps cross-host redirects attached to the submitted profile for history and monitoring', async () => {
    const h = harness({ redirect: 'https://destination.example/' });
    const body = (await (await h.post('https://ceramics.example/')).json()) as {
      id: string;
      result: ScanResult;
    };
    expect(body.result.target.url).toBe('https://destination.example');
    expect((await h.history.forHost('ceramics.example', 10))[0]?.url).toBe(
      'https://ceramics.example',
    );
    expect((await h.targets.list(10))[0]?.url).toBe('https://ceramics.example');
    const signup = await h.app.request('/monitor', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ scan_id: body.id, email: 'reader@example.com' }),
    });
    expect(signup.status).toBe(200);
    expect(
      (await h.monitors.findByEmailAndHost('reader@example.com', 'ceramics.example'))?.url,
    ).toBe('https://ceramics.example');
    const saved = await h.store.get(body.id);
    if (!saved) throw new Error('Missing root scan');
    const legacyPath = structuredClone(saved);
    legacyPath.result.target.input_url = 'https://ceramics.example/de/';
    await h.store.put(legacyPath);
    const denied = await h.app.request('/monitor', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ scan_id: body.id, email: 'other@example.com' }),
    });
    expect(denied.status).toBe(400);
    expect(await h.monitors.findByEmailAndHost('other@example.com', 'ceramics.example')).toBeNull();
    const profile = await (await h.app.request('/sites/ceramics.example')).text();
    expect(profile).toContain('retains recorded history');
    expect(profile).not.toContain('id="check-map"');
    expect(profile).not.toContain('Current state');
  });
});
