/**
 * Local development server. `sf dev` does not run Functions workers, so the app runs on
 * Node with an in-memory result store. Scans go to the real network.
 */
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { MemoryHistoryStore } from './history/memory.js';
import { createMcpRoute } from './mcp-route.js';
import { createMailer } from './monitoring/mailer.js';
import { MemoryMonitorStore } from './monitoring/memory.js';
import { MemoryResultStore } from './store/memory.js';
import { MemoryTargetRegistry } from './targets/memory.js';

const port = Number(process.env.PORT ?? 8787);
const config = configFromEnv({
  MAIL_PROVIDER: 'console',
  ...process.env,
  APP_BASE_URL: process.env.APP_BASE_URL ?? `http://localhost:${port}`,
});
const store = new MemoryResultStore();
const history = new MemoryHistoryStore();
const mailer = createMailer(config.monitoring);
const app = createApp({
  config,
  store,
  targets: new MemoryTargetRegistry(),
  history,
  monitors: new MemoryMonitorStore(),
  ...(mailer ? { mailer } : {}),
});
app.route('/mcp', createMcpRoute({ config, store, history }));

// Static files that Spacefast serves from dist/ in production: public/ as is, and the
// Inter files straight from the package (build.mjs copies them to dist/fonts).
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

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Agentic Readiness Scanner listening on http://localhost:${info.port}`);
});
