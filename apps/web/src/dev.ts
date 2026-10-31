/**
 * Local development server. `sf dev` does not run Functions workers, so the app runs on
 * Node with an in-memory result store. Scans go to the real network.
 */
import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { createMcpRoute } from './mcp-route.js';
import { MemoryResultStore } from './store/memory.js';

const port = Number(process.env.PORT ?? 8787);
const config = configFromEnv({
  ...process.env,
  APP_BASE_URL: process.env.APP_BASE_URL ?? `http://localhost:${port}`,
});
const store = new MemoryResultStore();
const app = createApp({ config, store });
app.route('/mcp', createMcpRoute({ config, store }));

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Agentic Readiness Scanner listening on http://localhost:${info.port}`);
});
