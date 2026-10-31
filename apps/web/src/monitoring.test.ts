import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixtureFetcher } from '@agentic-readiness/core/testing';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { MemoryMailer } from './monitoring/mailer.js';
import { MemoryMonitorStore } from './monitoring/memory.js';
import { MonitoringService } from './monitoring/service.js';
import { MemoryResultStore } from './store/memory.js';
import type { StoredScan } from './store/types.js';
import { MemoryTargetRegistry } from './targets/memory.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'stores',
  'good-woocommerce',
);

function harness(options: { provider?: 'console' | null; adminToken?: string } = {}) {
  const store = new MemoryResultStore();
  const monitors = new MemoryMonitorStore();
  const mailer = new MemoryMailer();
  const targets = new MemoryTargetRegistry();
  let clock = Date.parse('2026-10-31T12:00:00Z');
  const config = configFromEnv({
    APP_BASE_URL: 'https://scanner.example',
    ...(options.provider === null ? {} : { MAIL_PROVIDER: options.provider ?? 'console' }),
    ...(options.adminToken ? { ADMIN_TOKEN: options.adminToken } : {}),
  });
  const app = createApp({
    config,
    store,
    monitors,
    mailer,
    targets,
    fetcherFactory: () => fixtureFetcher(fixture),
    now: () => new Date(clock),
  });
  return {
    app,
    store,
    monitors,
    mailer,
    targets,
    config,
    advance(ms: number) {
      clock += ms;
    },
  };
}

async function scanOnce(app: ReturnType<typeof harness>['app']): Promise<string> {
  const response = await app.request('/api/scan', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://ceramics.example/' }),
  });
  return ((await response.json()) as { id: string }).id;
}

async function stored(store: MemoryResultStore, id: string): Promise<StoredScan> {
  const scan = await store.get(id);
  if (!scan) throw new Error(`scan ${id} not stored`);
  return scan;
}

function linkIn(text: string, path: string): string {
  const match = new RegExp(`https://scanner\\.example${path}/[0-9a-f]{16}/[0-9a-f]{48}`).exec(text);
  if (!match) throw new Error(`no ${path} link in:\n${text}`);
  return match[0].replace('https://scanner.example', '');
}

describe('monitoring signup, confirmation and unsubscribe', () => {
  it('offers monitoring on the report only when a mail provider is configured', async () => {
    const withMail = harness();
    const id = await scanOnce(withMail.app);
    const html = await (await withMail.app.request(`/r/${id}`)).text();
    expect(html).toContain('id="monitor"');
    expect(html).toContain('<dialog class="monitor-dialog"');
    expect(html).toContain('data-host="ceramics.example"');

    const without = harness({ provider: null });
    const otherId = await scanOnce(without.app);
    const plain = await (await without.app.request(`/r/${otherId}`)).text();
    expect(plain).not.toContain('id="monitor"');
    expect((await without.app.request('/monitor', { method: 'POST' })).status).toBe(404);
  });

  it('runs double opt-in end to end and honours unsubscribe', async () => {
    const h = harness();
    const scanId = await scanOnce(h.app);

    const signup = await h.app.request('/monitor', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `scan_id=${scanId}&email=Owner%40Example.com`,
    });
    expect(signup.status).toBe(200);
    expect(await signup.text()).toContain('Check your inbox');
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]?.to).toBe('owner@example.com');
    expect(h.mailer.sent[0]?.subject).toBe('Confirm monitoring for ceramics.example');
    const pending = await h.monitors.findByEmailAndHost('owner@example.com', 'ceramics.example');
    expect(pending?.status).toBe('pending');
    expect(pending?.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);

    // A second signup inside the hour is throttled: same page, no second email.
    await h.app.request('/monitor', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `scan_id=${scanId}&email=owner@example.com`,
    });
    expect(h.mailer.sent).toHaveLength(1);

    const confirmPath = linkIn(h.mailer.sent[0]?.text ?? '', '/monitor/confirm');
    expect((await h.app.request(confirmPath.replace(/.$/, 'x'))).status).toBe(404);
    const confirmed = await h.app.request(confirmPath);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.text()).toContain('Monitoring is on');
    const active = await h.monitors.get(pending?.id ?? '');
    expect(active?.status).toBe('active');
    expect(active?.baseline?.scanId).toBe(scanId);
    expect(active?.baseline?.level).toBeGreaterThanOrEqual(1);

    // Nothing is due before the interval; after it, the rescan finds no change and stays quiet.
    const cron = { headers: { 'x-spacefast-cron': '1' } };
    expect((await h.app.request('/internal/cron/monitor')).status).toBe(403);
    expect(await (await h.app.request('/internal/cron/monitor', cron)).json()).toMatchObject({
      due: 0,
    });
    h.advance(8 * 86_400_000);
    expect(await (await h.app.request('/internal/cron/monitor', cron)).json()).toMatchObject({
      due: 1,
      checked: 1,
      notified: 0,
    });
    expect(h.mailer.sent).toHaveLength(1);
  });

  it('rejects bad input without leaking anything', async () => {
    const h = harness();
    const scanId = await scanOnce(h.app);
    expect(
      (
        await h.app.request('/monitor', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: `scan_id=${scanId}&email=not-an-email`,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.app.request('/monitor', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: `scan_id=0000000000000000&email=a@b.co`,
        })
      ).status,
    ).toBe(404);
    expect((await h.app.request('/monitor/confirm/zzz/zzz')).status).toBe(404);
    expect(h.mailer.sent).toHaveLength(0);
  });
});

describe('weekly check', () => {
  it('emails the diff when a rescan changes and rotates the unsubscribe token', async () => {
    const monitors = new MemoryMonitorStore();
    const mailer = new MemoryMailer();
    const config = configFromEnv({
      APP_BASE_URL: 'https://scanner.example',
      MAIL_PROVIDER: 'console',
    });
    let clock = Date.parse('2026-10-31T12:00:00Z');
    const store = new MemoryResultStore();
    const baseApp = createApp({
      config,
      store,
      fetcherFactory: () => fixtureFetcher(fixture),
      now: () => new Date(clock),
    });
    const firstId = await scanOnce(baseApp);
    const first = await stored(store, firstId);

    // The rescan returns the same result with one check flipped and the level dropped.
    const flipped: StoredScan = {
      ...first,
      id: 'feedfacefeedface',
      result: {
        ...first.result,
        level: { value: 0, name: 'Not reachable', next_gate: ['A1.1'] },
        results: first.result.results.map((item) =>
          item.id === 'A1.1' ? { ...item, verdict: 'fail' as const } : item,
        ),
      },
    };
    const service = new MonitoringService({
      config,
      store: monitors,
      mailer,
      latestScan: () => Promise.resolve(first),
      rescan: () => Promise.resolve(flipped),
      now: () => new Date(clock),
    });
    await service.subscribe('owner@example.com', first);
    const confirmPath = linkIn(mailer.sent[0]?.text ?? '', '/monitor/confirm');
    const [, , , id, token] = confirmPath.split('/');
    expect(await service.confirm(id ?? '', token ?? '')).toMatchObject({ status: 'active' });

    clock += 8 * 86_400_000;
    const report = await service.runDue();
    expect(report).toEqual({ due: 1, checked: 1, notified: 1, failed: 0 });
    expect(mailer.sent).toHaveLength(2);
    const email = mailer.sent[1];
    expect(email?.subject).toContain('Level');
    expect(email?.text).toContain('A1.1 robots.txt exists and parses: pass → fail');
    expect(email?.text).toContain('https://scanner.example/r/feedfacefeedface');
    const unsubscribePath = linkIn(email?.text ?? '', '/monitor/unsubscribe');
    const [, , , uid, utoken] = unsubscribePath.split('/');
    expect(await service.unsubscribe(uid ?? '', utoken ?? '')).toMatchObject({
      status: 'unsubscribed',
    });

    // Unsubscribed monitors are never due again; a second run does nothing.
    clock += 8 * 86_400_000;
    expect(await service.runDue()).toEqual({ due: 0, checked: 0, notified: 0, failed: 0 });
  });

  it('keeps going when a rescan fails and retries only next interval', async () => {
    const monitors = new MemoryMonitorStore();
    const mailer = new MemoryMailer();
    const config = configFromEnv({
      APP_BASE_URL: 'https://scanner.example',
      MAIL_PROVIDER: 'console',
    });
    let clock = Date.parse('2026-10-31T12:00:00Z');
    const store = new MemoryResultStore();
    const baseApp = createApp({ config, store, fetcherFactory: () => fixtureFetcher(fixture) });
    const first = await stored(store, await scanOnce(baseApp));
    const service = new MonitoringService({
      config,
      store: monitors,
      mailer,
      latestScan: () => Promise.resolve(first),
      rescan: () => Promise.reject(new Error('offline')),
      now: () => new Date(clock),
    });
    await service.subscribe('owner@example.com', first);
    const [, , , id, token] = linkIn(mailer.sent[0]?.text ?? '', '/monitor/confirm').split('/');
    await service.confirm(id ?? '', token ?? '');
    clock += 8 * 86_400_000;
    expect(await service.runDue()).toEqual({ due: 1, checked: 0, notified: 0, failed: 1 });
    expect(await service.runDue()).toEqual({ due: 0, checked: 0, notified: 0, failed: 0 });
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('monitoring limits', () => {
  it('caps confirmation emails per address per day and forgets stale pending requests', async () => {
    const h = harness();
    const scanId = await scanOnce(h.app);
    const post = (email: string) =>
      h.app.request('/monitor', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `scan_id=${scanId}&email=${encodeURIComponent(email)}`,
      });
    await post('a@example.com');
    expect(h.mailer.sent).toHaveLength(1);
    // Pending rows are purged by the cleanup cron once they are older than 48 hours.
    h.advance(49 * 3_600_000);
    const cleanup = await h.app.request('/internal/cron/cleanup', {
      headers: { 'x-spacefast-cron': '1' },
    });
    expect(await cleanup.json()).toMatchObject({ pendingRemoved: 1 });
    expect(await h.monitors.findByEmailAndHost('a@example.com', 'ceramics.example')).toBeNull();
  });

  it('does not build email links when APP_BASE_URL is not explicit', async () => {
    const store = new MemoryResultStore();
    const config = configFromEnv({ MAIL_PROVIDER: 'console' }, 'https://forged.example/');
    const app = createApp({
      config,
      store,
      monitors: new MemoryMonitorStore(),
      mailer: new MemoryMailer(),
      fetcherFactory: () => fixtureFetcher(fixture),
    });
    const id = await scanOnce(app);
    expect(await (await app.request(`/r/${id}`)).text()).not.toContain('id="monitor"');
    expect((await app.request('/monitor', { method: 'POST' })).status).toBe(404);
  });

  it('keeps going when the mail provider fails for one subscriber', async () => {
    const monitors = new MemoryMonitorStore();
    const config = configFromEnv({
      APP_BASE_URL: 'https://scanner.example',
      MAIL_PROVIDER: 'console',
    });
    let clock = Date.parse('2026-10-31T12:00:00Z');
    const store = new MemoryResultStore();
    const baseApp = createApp({ config, store, fetcherFactory: () => fixtureFetcher(fixture) });
    const first = await stored(store, await scanOnce(baseApp));
    const flipped: StoredScan = {
      ...first,
      id: 'feedfacefeedface',
      result: { ...first.result, level: { value: 0, name: 'Not reachable', next_gate: ['A1.1'] } },
    };
    let failNext = false;
    const flaky = {
      sent: [] as string[],
      send: (message: { to: string }) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('provider 500'));
        }
        flaky.sent.push(message.to);
        return Promise.resolve();
      },
    };
    const service = new MonitoringService({
      config,
      store: monitors,
      mailer: flaky,
      latestScan: () => Promise.resolve(first),
      rescan: () => Promise.resolve(flipped),
      now: () => new Date(clock),
    });
    for (const email of ['one@example.com', 'two@example.com'])
      await service.subscribe(email, first);
    for (const monitor of await monitors.list(10)) {
      await monitors.update({
        ...monitor,
        status: 'active',
        baseline: null,
        confirmedAt: new Date(clock).toISOString(),
      });
    }
    clock += 8 * 86_400_000;
    // First run establishes baselines; no email yet.
    expect(await service.runDue()).toMatchObject({ due: 2, checked: 2, notified: 0, failed: 0 });
    clock += 8 * 86_400_000;
    const changed: StoredScan = {
      ...flipped,
      id: 'cafebabecafebabe',
      result: { ...flipped.result, level: { value: 1, name: 'Crawlable', next_gate: [] } },
    };
    const service2 = new MonitoringService({
      config,
      store: monitors,
      mailer: flaky,
      latestScan: () => Promise.resolve(first),
      rescan: () => Promise.resolve(changed),
      now: () => new Date(clock),
    });
    const sentBefore = flaky.sent.length; // the two confirmation emails
    failNext = true;
    const report = await service2.runDue();
    expect(report).toMatchObject({ due: 2, checked: 2, notified: 1, failed: 1 });
    expect(flaky.sent.length - sentBefore).toBe(1);
    // The failed subscriber keeps the old baseline and is told next time.
    clock += 8 * 86_400_000;
    expect(await service2.runDue()).toMatchObject({ due: 2, notified: 1 });
  });
});

describe('owner exports', () => {
  it('lists scanned targets and subscriptions behind a bearer token, never token hashes', async () => {
    const h = harness({ adminToken: 'secret-token' });
    const scanId = await scanOnce(h.app);
    await h.app.request('/monitor', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `scan_id=${scanId}&email=owner@example.com`,
    });
    expect((await h.app.request('/internal/export/targets.json')).status).toBe(401);
    expect(
      (
        await h.app.request('/internal/export/targets.json', {
          headers: { authorization: 'Bearer wrong' },
        })
      ).status,
    ).toBe(401);
    const auth = { headers: { authorization: 'Bearer secret-token' } };
    const targets = (await (await h.app.request('/internal/export/targets.json', auth)).json()) as {
      targets: { host: string; scanCount: number; lastLevel: number }[];
    };
    expect(targets.targets).toHaveLength(1);
    expect((await h.app.request('/internal/export/targets.json?limit=abc', auth)).status).toBe(200);
    expect(targets.targets[0]).toMatchObject({ host: 'ceramics.example', scanCount: 1 });
    const monitors = (await (
      await h.app.request('/internal/export/monitors.json', auth)
    ).json()) as {
      monitors: Record<string, unknown>[];
    };
    expect(monitors.monitors[0]).toMatchObject({ email: 'owner@example.com', status: 'pending' });
    expect(monitors.monitors[0]).not.toHaveProperty('confirmTokenHash');

    const without = harness();
    expect((await without.app.request('/internal/export/targets.json')).status).toBe(404);
  });
});
