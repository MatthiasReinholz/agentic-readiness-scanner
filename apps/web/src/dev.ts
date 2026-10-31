/**
 * Local development server. `sf dev` does not run Functions workers, so the app runs on
 * Node with an in-memory result store. Scans go to the real network.
 */
import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
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
const mailer = createMailer(config.monitoring);
const app = createApp({
  config,
  store,
  targets: new MemoryTargetRegistry(),
  monitors: new MemoryMonitorStore(),
  ...(mailer ? { mailer } : {}),
});
app.route('/mcp', createMcpRoute({ config, store }));

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Agentic Readiness Scanner listening on http://localhost:${info.port}`);
});
