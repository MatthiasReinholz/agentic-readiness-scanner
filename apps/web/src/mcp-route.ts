/**
 * Streamable HTTP MCP endpoint mounted at /mcp. Stateless: every request gets a fresh
 * transport, which suits a worker isolate and needs no session storage.
 */
import { scan } from '@agentic-readiness/core';
import { createMcpServer } from '@agentic-readiness/mcp';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';

import { scanOrReuse, type AppDependencies } from './app.js';

export function createMcpRoute(deps: AppDependencies): Hono {
  const route = new Hono();
  route.all('/', async (c) => {
    const server = createMcpServer({
      scanner: async (url, profile) => {
        const { scan: stored } = await scanOrReuse(deps, {
          url,
          ...(profile !== undefined ? { profile } : {}),
        });
        return stored.result;
      },
    });
    // No sessionIdGenerator: stateless mode, one transport per request.
    const transport = new WebStandardStreamableHTTPServerTransport({});
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  return route;
}

export { scan };
