import { Hono } from 'hono';
import { expect, it } from 'vitest';

import { configFromEnv } from './config.js';
import { createMcpRoute } from './mcp-route.js';
import { MemoryResultStore } from './store/memory.js';

it('enforces no-store on the actual MCP SDK response, including its SSE transport', async () => {
  const app = new Hono().route(
    '/mcp',
    createMcpRoute({ config: configFromEnv({}), store: new MemoryResultStore() }),
  );
  const response = await app.request('/mcp', { headers: { accept: 'text/event-stream' } });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(response.headers.get('cache-control')).toBe('no-store');
  await response.body?.cancel();
});
