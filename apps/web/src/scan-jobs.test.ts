import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalog, type ScanResult } from '@agentic-readiness/catalog';
import { fetcherAsFetch, fixtureFetcher } from '@agentic-readiness/core/testing';
import type { FetchLike } from '@agentic-readiness/core';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { packJson, unpackJson } from './jobs/codec.js';
import { MemoryScanJobStore } from './jobs/memory.js';
import { ProgressRecorder } from './jobs/progress.js';
import { SqlScanJobStore } from './jobs/sql.js';
import { MemoryProgressStore } from './progress/memory.js';
import { MemoryResultStore } from './store/memory.js';
import { FakeSqlDatabase } from './store/fake-sql.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'stores',
  'good-woocommerce',
);

/** The recorded store, each answer a little late, so a short step allowance pauses a scan. */
function slowFetch(delayMs: number): FetchLike {
  const recorded = fetcherAsFetch(fixtureFetcher(fixture, { budget: 1_000_000 }));
  return async (input, init) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return recorded(input, init);
  };
}

function harness(options: { stepMs?: number; delayMs?: number } = {}) {
  const store = new MemoryResultStore();
  const progress = new MemoryProgressStore();
  const jobs = new MemoryScanJobStore();
  let clock = Date.parse('2026-11-03T12:00:00Z');
  const app = createApp({
    config: configFromEnv({
      APP_BASE_URL: 'https://scanner.example',
      SCAN_STEP_MS: String(options.stepMs ?? 200),
      SCAN_MAX_STEPS: '50',
      SCAN_MAX_ACTIVE_MS: '600000',
    }),
    store,
    progress,
    jobs,
    fetchFactory: () => slowFetch(options.delayMs ?? 15),
    minIntervalMs: 0,
    now: () => new Date(clock),
  });
  const post = (path: string, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    app,
    store,
    progress,
    jobs,
    post,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

type Json = Record<string, unknown>;

/** Calls the continue endpoint until the scan is done; returns the last answer and the calls. */
async function drive(post: (path: string) => Response | Promise<Response>, jobId: string) {
  let answer: Json = {};
  let calls = 0;
  for (; calls < 60; calls += 1) {
    answer = (await (await post(`/api/scan/jobs/${jobId}/continue`)).json()) as Json;
    if (answer.status !== 'running') break;
  }
  return { answer, calls };
}

describe('hosted scans in steps', () => {
  it('pause when a step runs out of time and finish on the next calls without a skipped check', async () => {
    const h = harness();
    const started = await h.post('/api/scan', { url: 'https://ceramics.example/' });
    expect(started.status).toBe(202);
    const pending = (await started.json()) as Json;
    expect(pending).toMatchObject({
      persistence: 'pending',
      status: 'running',
      profile_url: 'https://scanner.example/sites/ceramics.example',
    });
    const jobId = String(pending.job_id);
    expect(pending.status_url).toBe(`https://scanner.example/api/scan/jobs/${jobId}`);

    const { answer, calls } = await drive(h.post, jobId);
    expect(calls).toBeGreaterThan(0);
    expect(answer).toMatchObject({ status: 'done', persistence: 'stored' });
    const result = answer.result as ScanResult;
    expect(result.steps).toBeGreaterThan(1);
    expect(result.results.filter((item) => item.skip_reason === 'budget_exhausted')).toEqual([]);
    // The profile now serves the stored result, and the job answers done from then on.
    expect((await h.app.request('/sites/ceramics.example')).status).toBe(200);
    const status = (await (await h.app.request(`/api/scan/jobs/${jobId}`)).json()) as Json;
    expect(status).toMatchObject({ status: 'done', persistence: 'stored' });
    expect(status.done).toMatchObject({ report_url: '/sites/ceramics.example' });
  }, 30_000);

  it('give the same verdicts as a scan that fits in one step', async () => {
    const quick = harness({ stepMs: 20_000, delayMs: 0 });
    const single = (await (
      await quick.post('/api/scan', { url: 'https://ceramics.example/' })
    ).json()) as Json;
    expect(single.persistence).toBe('stored');

    const stepped = harness();
    const pending = (await (
      await stepped.post('/api/scan', { url: 'https://ceramics.example/' })
    ).json()) as Json;
    const { answer } = await drive(stepped.post, String(pending.job_id));
    const verdicts = (value: Json) =>
      (value.result as ScanResult).results.map((item) => [item.id, item.verdict]);
    expect(verdicts(answer)).toEqual(verdicts(single));
    expect((answer.result as ScanResult).legal?.results.map((item) => item.verdict)).toEqual(
      (single.result as ScanResult).legal?.results.map((item) => item.verdict),
    );
  }, 30_000);

  it('let a second request for the same root join the running scan instead of refusing it', async () => {
    const h = harness();
    const first = (await (
      await h.post('/api/scan', { url: 'https://ceramics.example/' })
    ).json()) as Json;
    h.advance(90_000);
    const second = await h.post('/api/scan', { url: 'https://ceramics.example/' });
    const joined = (await second.json()) as Json;
    expect([200, 202]).toContain(second.status);
    if (joined.persistence === 'pending') expect(joined.job_id).toBe(first.job_id);
    expect(joined.reused).toBe(true);
  }, 30_000);

  it('run one step at a time: a caller that finds the step taken gets the job back busy', async () => {
    const h = harness();
    const pending = (await (
      await h.post('/api/scan', { url: 'https://ceramics.example/' })
    ).json()) as Json;
    const jobId = String(pending.job_id);
    const lease = await h.jobs.claim(jobId, new Date('2026-11-03T12:00:00Z'), 60_000);
    expect(lease).not.toBeNull();
    const busy = (await (await h.post(`/api/scan/jobs/${jobId}/continue`)).json()) as Json;
    expect(busy).toMatchObject({ status: 'running', busy: true });
    // Once the lease expires, the next caller takes the step.
    h.advance(61_000);
    const next = (await (await h.post(`/api/scan/jobs/${jobId}/continue`)).json()) as Json;
    expect(next.busy).not.toBe(true);
  }, 30_000);

  it('are carried on by the sweeper cron when nobody else advances them', async () => {
    const h = harness();
    const pending = (await (
      await h.post('/api/scan', { url: 'https://ceramics.example/' })
    ).json()) as Json;
    const forbidden = await h.app.request('/internal/cron/scan-jobs');
    expect(forbidden.status).toBe(403);
    let report: Json = {};
    for (let run = 0; run < 60; run += 1) {
      h.advance(60_000);
      report = (await (
        await h.app.request('/internal/cron/scan-jobs', { headers: { 'x-spacefast-cron': '1' } })
      ).json()) as Json;
      if (report.finished === 1) break;
    }
    expect(report).toMatchObject({ finished: 1, failed: 0 });
    const job = await h.jobs.get(String(pending.job_id));
    expect(job?.status).toBe('done');
    expect(await h.store.latestForHost('ceramics.example')).not.toBeNull();
  }, 30_000);

  it('give a job up after steps that never saved, with a reason the page can show', async () => {
    const h = harness();
    const pending = (await (
      await h.post('/api/scan', { url: 'https://ceramics.example/' })
    ).json()) as Json;
    const jobId = String(pending.job_id);
    // Three claims whose steps the platform cut off: nothing saved, leases left to expire.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await h.jobs.claim(jobId, new Date(Date.parse('2026-11-03T12:00:00Z') + attempt), 1);
    }
    h.advance(60_000);
    const response = await h.post(`/api/scan/jobs/${jobId}/continue`);
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ status: 'failed' });
    expect((await h.jobs.get(jobId))?.status).toBe('failed');
  }, 30_000);

  it('start over when a deploy changed the scanner between two steps', async () => {
    const h = harness();
    const pending = (await (
      await h.post('/api/scan', { url: 'https://ceramics.example/' })
    ).json()) as Json;
    const jobId = String(pending.job_id);
    const job = await h.jobs.get(jobId);
    if (!job?.state) throw new Error('expected a paused job');
    const lease = await h.jobs.claim(jobId, new Date('2026-11-03T12:00:00Z'), 1);
    await h.jobs.save({ ...job, state: { ...job.state, scanner_version: '0.0.1' } }, lease ?? '');
    const { answer } = await drive(h.post, jobId);
    expect(answer).toMatchObject({ status: 'done', persistence: 'stored' });
  }, 30_000);

  it('write each progress event once to the page across steps, numbered in order', async () => {
    const h = harness();
    const token = 'ab'.repeat(16);
    const response = await h.post('/api/scan/stream', {
      url: 'https://ceramics.example/',
      progress_token: token,
    });
    const text = await response.text();
    expect(text).toContain('event: paused');
    const paused = /event: paused\ndata: (.*)\n/.exec(text)?.[1] ?? '{}';
    await drive(h.post, String((JSON.parse(paused) as Json).job_id));
    const record = await h.progress.load(token);
    const events = (record?.events ?? []) as Json[];
    const checks = events.filter((event) => event.type === 'check').map((event) => event.id);
    expect(new Set(checks).size).toBe(checks.length);
    expect(checks).toHaveLength(catalog.checks.length);
    const seqs = events.map((event) => Number(event.seq));
    expect(seqs).toEqual(seqs.map((_, index) => index + 1));
    expect(record?.final?.event).toBe('done');
  }, 30_000);

  it('send a one-time scan from the form to a page that waits for it and then shows it', async () => {
    const h = harness();
    const posted = await h.app.request('/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `url=${encodeURIComponent('https://ceramics.example/product/stoneware-mug/')}`,
    });
    expect(posted.status).toBe(303);
    const location = posted.headers.get('location') ?? '';
    expect(location).toMatch(/^\/scan\/jobs\/[0-9a-f]{16}$/);
    const waiting = await h.app.request(location);
    expect(waiting.status).toBe(200);
    expect(waiting.headers.get('x-robots-tag')).toBe('noindex');
    expect(await waiting.text()).toContain('http-equiv="refresh"');
    await drive(h.post, location.split('/').at(-1) ?? '');
    const report = await h.app.request(location);
    expect(report.status).toBe(200);
    expect(await report.text()).toContain('ceramics.example');
    expect(await h.store.latestForHost('ceramics.example')).toBeNull();
    // Shown once, then gone from the server.
    expect(await h.jobs.get(location.split('/').at(-1) ?? '')).toBeNull();
    expect((await h.app.request(location)).status).toBe(404);
  }, 30_000);

  it('keep a one-time result only until an API caller fetched it, and an hour at most', async () => {
    const h = harness();
    const started = (await (
      await h.post('/api/scan', { url: 'https://ceramics.example/product/stoneware-mug/' })
    ).json()) as Json;
    expect(started.persistence).toBe('pending');
    expect(started.profile_url).toBeUndefined();
    const jobId = String(started.job_id);
    await drive(h.post, jobId);
    expect((await h.jobs.get(jobId))?.result).not.toBeNull();
    const fetched = (await (await h.app.request(`/api/scan/jobs/${jobId}`)).json()) as Json;
    expect(fetched).toMatchObject({ status: 'done', persistence: 'disposable' });
    expect(await h.jobs.get(jobId)).toBeNull();

    // A one-time scan nobody came back for is purged by the sweeper after an hour.
    h.advance(120_000);
    const abandoned = (await (
      await h.post('/api/scan', { url: 'https://ceramics.example/product/serving-bowl/' })
    ).json()) as Json;
    h.advance(61 * 60_000);
    await h.app.request('/internal/cron/scan-jobs', { headers: { 'x-spacefast-cron': '1' } });
    expect(await h.jobs.get(String(abandoned.job_id))).toBeNull();
  }, 30_000);

  it('keep robots away from the waiting pages', async () => {
    const h = harness();
    expect(await (await h.app.request('/robots.txt')).text()).toContain('Disallow: /scan/');
  });
});

describe('job storage', () => {
  it('packs cached responses small and reads them back unchanged', async () => {
    const response = {
      url: 'https://ceramics.example/',
      finalUrl: 'https://ceramics.example/',
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html>'.padEnd(200_000, ' ünïcødé ') + '</html>',
      bytes: 200_000,
      truncated: false,
      redirects: 0,
      durationMs: 12,
      fromCache: false,
    };
    const packed = await packJson(response);
    expect(packed.length).toBeLessThan(20_000);
    expect(await unpackJson(packed)).toEqual(response);
  });

  it('takes a lease with a conditional update and reads its own token back', async () => {
    const db = new FakeSqlDatabase();
    const jobs = new SqlScanJobStore(db);
    expect(await jobs.claim('0123456789abcdef', new Date('2026-11-03T12:00:00Z'), 35_000)).toBe(
      null,
    );
    const update = db.statements(/UPDATE scan_jobs SET lease_token/)[0];
    expect(update?.sql).toContain('lease_until IS NULL OR lease_until <= ?');
    expect(update?.values.slice(1)).toEqual([
      '2026-11-03T12:00:35.000Z',
      '0123456789abcdef',
      '2026-11-03T12:00:00.000Z',
    ]);
    // Only the lease holder writes a step back.
    await jobs.save(
      {
        id: '0123456789abcdef',
        host: 'ceramics.example',
        url: 'https://ceramics.example/',
        persistent: true,
        status: 'running',
        state: null,
        progressToken: null,
        attempts: 1,
        createdAt: '2026-11-03T12:00:00.000Z',
        updatedAt: '2026-11-03T12:00:10.000Z',
        scanId: null,
        result: null,
        error: null,
        errorStatus: null,
      },
      'f'.repeat(32),
    );
    const save = db.statements(/UPDATE scan_jobs SET status/)[0];
    expect(save?.sql).toContain('WHERE id = ? AND lease_token = ?');
    expect(save?.values.at(-1)).toBe('f'.repeat(32));
  });

  it('keeps the first of each event when steps replay them', async () => {
    const progress = new MemoryProgressStore();
    const token = 'cd'.repeat(16);
    const base = { requests: 1, budget: 60, elapsed_ms: 5 };
    const first = await ProgressRecorder.open(progress, token);
    first.emit({ ...base, type: 'phase', phase: 'home', detail: 'home page answered' });
    await first.flush();
    const second = await ProgressRecorder.open(progress, token);
    expect(second.emit({ ...base, type: 'phase', phase: 'home', detail: 'again' })).toBeNull();
    expect(
      second.emit({ ...base, type: 'phase', phase: 'robots', detail: 'robots.txt' }),
    ).toMatchObject({ seq: 2 });
    await second.finish('done', { ok: true });
    await second.finish('failure', { ok: false });
    expect((await progress.load(token))?.final).toEqual({ event: 'done', data: { ok: true } });
  });
});
