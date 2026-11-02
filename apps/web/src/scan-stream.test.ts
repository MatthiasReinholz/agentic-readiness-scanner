import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

import { fixtureFetcher } from '@agentic-readiness/core/testing';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { SCAN_CONSOLE_SCRIPT } from './pages/scan-console.js';
import { MemoryResultStore } from './store/memory.js';

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
  const app = createApp({
    config: configFromEnv({ APP_BASE_URL: 'https://scanner.example' }),
    store,
    fetcherFactory: () => fixtureFetcher(fixture),
    now: () => new Date('2026-10-30T12:00:00Z'),
  });
  return { app, store };
}

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

async function readEvents(response: Response): Promise<SseEvent[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .map((chunk) => {
      const lines = chunk.split('\n');
      const event =
        lines
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim() ?? '';
      const data = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      return { event, data: data ? (JSON.parse(data) as Record<string, unknown>) : {} };
    })
    .filter((item) => item.event !== '');
}

describe('streamed scan', () => {
  it('streams phases and every verdict, then done with the report URL and the verdicts', async () => {
    const { app, store } = testApp();
    const response = await app.request('/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://ceramics.example/' }),
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const events = await readEvents(response);
    const progress = events.filter((item) => item.event === 'progress');
    expect(
      progress.filter((item) => item.data.type === 'phase').map((item) => item.data.phase),
    ).toEqual(['home', 'robots', 'sitemap', 'sample']);
    expect(progress.filter((item) => item.data.type === 'check')).toHaveLength(64);
    const done = events.at(-1);
    expect(done?.event).toBe('done');
    expect(done?.data).toMatchObject({ reused: false, level: { value: 5 } });
    expect(String(done?.data.report_url)).toMatch(/^\/r\/[0-9a-f]{16}$/);
    expect(done?.data.results).toHaveLength(64);
    expect(await store.latestForHost('ceramics.example')).not.toBeNull();

    // Inside the cooldown the stored result answers at once, ready to replay.
    const again = await readEvents(
      await app.request('/api/scan/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://ceramics.example/' }),
      }),
    );
    expect(again.map((item) => item.event)).toEqual(['done']);
    expect(again[0]?.data).toMatchObject({ reused: true });
  });

  it('answers a bad request with JSON before any stream starts, and a refusal as a failure event', async () => {
    const { app } = testApp();
    const bad = await app.request('/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: '' }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'A URL is required.' });
    const blocked = await readEvents(
      await app.request('/api/scan/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1/' }),
      }),
    );
    expect(blocked.map((item) => item.event)).toEqual(['failure']);
    expect(blocked[0]?.data).toMatchObject({ status: 400 });
  });

  it('puts the console on the home page with a client script that parses', async () => {
    const { app } = testApp();
    const html = await (await app.request('/')).text();
    expect(html).toContain('id="scan-form"');
    expect(html).toContain('id="scan-console"');
    expect(html.match(/class="sc-cell"/g)).toHaveLength(64);
    // Compiles without running: a syntax error in the inline script would break the page.
    expect(() => new Script(SCAN_CONSOLE_SCRIPT)).not.toThrow();
    // The form still posts without JavaScript.
    expect(html).toContain('action="/scan"');
  });
});
