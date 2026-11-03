/**
 * Streamable HTTP MCP endpoint mounted at /mcp. Stateless: every request gets a fresh
 * transport, which suits a worker isolate and needs no session storage.
 */
import { createMcpServer } from '@agentic-readiness/mcp';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';

import { hostKey } from './hosts.js';
import { articleByCheckId, articleMarkdown } from './knowledge/pages.js';
import { historyJson } from './pages/history.js';
import { continueInBackground } from './routes/jobs.js';
import { siteProfilePath } from './scan-scope.js';
import { ScanPendingError, scanOrReuse, type ScanDependencies } from './scan-service.js';

export function createMcpRoute(deps: ScanDependencies): Hono {
  const route = new Hono();
  const { history } = deps;
  route.all('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const server = createMcpServer({
      scanner: async (url, profile) => {
        const outcome = await scanOrReuse(deps, {
          url,
          ...(profile !== undefined ? { profile } : {}),
        });
        if (outcome.persistence === 'pending') {
          // The tool answers with an error the agent can act on; asking again runs the next
          // step, and the scan carries on meanwhile.
          continueInBackground(c, deps.config, outcome);
          const where = outcome.job.persistent
            ? ` The result will be at ${deps.config.baseUrl}${siteProfilePath(outcome.job.host)}.`
            : '';
          throw new Error(
            `${new ScanPendingError(outcome).message} Call scan_store again with the same URL in about a minute.${where}`,
          );
        }
        return outcome.persistence === 'stored' ? outcome.scan.result : outcome.result;
      },
      ...(history
        ? {
            history: async (host: string) => {
              const key = hostKey(host);
              return historyJson(key, await history.forHost(key, 50));
            },
          }
        : {}),
      explain: (checkId) => {
        const article = articleByCheckId(checkId);
        return article ? articleMarkdown(deps.config, article) : undefined;
      },
    });
    // No sessionIdGenerator: stateless mode, one transport per request.
    const transport = new WebStandardStreamableHTTPServerTransport({});
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw);
    // The SDK sets its own cache headers on SSE; enforce this on the actual response.
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });
  return route;
}
