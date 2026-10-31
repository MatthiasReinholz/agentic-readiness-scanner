/**
 * Spacefast Functions entry. The platform calls fetch(request, env, ctx) in the shape
 * Workers expect. Everything else lives in createApp so the same app runs locally.
 */
import type { ExecutionContext } from 'hono';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { createMcpRoute } from './mcp-route.js';
import { SqlResultStore, type SqlDatabase } from './store/sql.js';

interface FunctionsEnv extends Record<string, unknown> {
  DB: SqlDatabase;
}

let cached: { app: ReturnType<typeof createApp>; db: SqlDatabase } | null = null;

function appFor(env: FunctionsEnv, requestUrl: string) {
  if (cached?.db === env.DB) return cached.app;
  const stringEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env))
    if (typeof value === 'string') stringEnv[key] = value;
  const config = configFromEnv(stringEnv, requestUrl);
  const app = createApp({ config, store: new SqlResultStore(env.DB) });
  app.route('/mcp', createMcpRoute({ config, store: new SqlResultStore(env.DB) }));
  cached = { app, db: env.DB };
  return app;
}

export default {
  fetch(request: Request, env: FunctionsEnv, ctx: ExecutionContext): Promise<Response> | Response {
    return appFor(env, request.url).fetch(request, env, ctx);
  },
};
