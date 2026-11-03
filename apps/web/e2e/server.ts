/**
 * The hosted app on Node for the browser regression suite. Every scan answers from the
 * recorded fixture stores, mail goes to the console, and the seeded stores are scanned
 * before the server answers, so reports, profiles and history render the same content
 * on every run. Nothing here reaches the network.
 */
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { FetchLike } from '@agentic-readiness/core';
import { fetcherAsFetch, loadFixtureDirectory, mapFetcher } from '@agentic-readiness/core/testing';

import { createApp } from '../src/app.js';
import { configFromEnv } from '../src/config.js';
import { MemoryHistoryStore } from '../src/history/memory.js';
import { MemoryMonitorStore } from '../src/monitoring/memory.js';
import { createMailer } from '../src/monitoring/mailer.js';
import { MemoryProgressStore } from '../src/progress/memory.js';
import { MemoryResultStore } from '../src/store/memory.js';
import { MemoryTargetRegistry } from '../src/targets/memory.js';
import { SEEDED_HOST, STEPPED_SCAN_HOST } from './hosts.js';

const here = dirname(fileURLToPath(import.meta.url));
const stores = join(here, '..', '..', '..', 'fixtures', 'stores');
const responses = Object.assign(
  {},
  ...['good-woocommerce', 'shopify-store', 'content-site'].map(
    (name) => loadFixtureDirectory(join(stores, name)).responses,
  ),
) as Parameters<typeof mapFetcher>[0];

const recorded = fetcherAsFetch(mapFetcher(responses, { budget: 1_000_000 }));

/**
 * The stepped-scan host: the recorded blog under another name, every answer late enough
 * that its scan needs more than one step. Other hosts answer at once and fit in one.
 */
const fetchFixtures: FetchLike = async (input, init) => {
  if (new URL(input).hostname !== STEPPED_SCAN_HOST) return recorded(input, init);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const rename = (text: string) => text.replaceAll('blog.example', STEPPED_SCAN_HOST);
  const response = await recorded(input.replace(STEPPED_SCAN_HOST, 'blog.example'), init);
  const headers = new Headers(response.headers);
  const location = headers.get('location');
  if (location) headers.set('location', rename(location));
  const body = response.body ? rename(await response.text()) : null;
  return new Response(body, { status: response.status, headers });
};

const port = Number(process.env.PORT ?? 8799);
const config = configFromEnv({
  MAIL_PROVIDER: 'console',
  APP_BASE_URL: `http://localhost:${port}`,
  SCAN_STEP_MS: '3000',
});
const mailer = createMailer(config.monitoring);
const app = createApp({
  config,
  store: new MemoryResultStore(),
  targets: new MemoryTargetRegistry(),
  progress: new MemoryProgressStore(),
  history: new MemoryHistoryStore(),
  monitors: new MemoryMonitorStore(),
  ...(mailer ? { mailer } : {}),
  fetchFactory: () => fetchFixtures,
  minIntervalMs: 0,
});

const fontDir = join(
  dirname(createRequire(import.meta.url).resolve('@fontsource/inter/package.json')),
  'files',
);
app.use(
  '/fonts/*',
  serveStatic({
    root: relative(process.cwd(), fontDir),
    rewriteRequestPath: (path) => path.replace(/^\/fonts\//, '/'),
  }),
);
app.use('/*', serveStatic({ root: './public' }));

const seeded = await app.request('/api/scan', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: SEEDED_HOST }),
});
// 202 would mean the seeded scan needs more steps: the fixture store answers too slowly.
if (seeded.status !== 200)
  throw new Error(`Seeding ${SEEDED_HOST} failed with ${String(seeded.status)}`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Layout test server listening on http://localhost:${info.port}`);
});
