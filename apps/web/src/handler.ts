/**
 * Spacefast Functions entry. The platform calls fetch(request, env, ctx) in the shape
 * Workers expect. Everything else lives in createApp so the same app runs locally.
 */
import type { ExecutionContext } from 'hono';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { SqlHistoryStore } from './history/sql.js';
import { createMcpRoute } from './mcp-route.js';
import { createMailer } from './monitoring/mailer.js';
import { SqlMonitorStore } from './monitoring/sql.js';
import { SqlResultStore, type SqlDatabase } from './store/sql.js';
import { SqlTargetRegistry } from './targets/sql.js';

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
  const store = new SqlResultStore(env.DB);
  const history = new SqlHistoryStore(env.DB);
  const mailer = createMailer(config.monitoring);
  const app = createApp({
    config,
    store,
    targets: new SqlTargetRegistry(env.DB),
    history,
    monitors: new SqlMonitorStore(env.DB),
    ...(mailer ? { mailer } : {}),
  });
  app.route('/mcp', createMcpRoute({ config, store, history }));
  cached = { app, db: env.DB };
  return app;
}

export default {
  fetch(request: Request, env: FunctionsEnv, ctx: ExecutionContext): Promise<Response> | Response {
    return appFor(env, request.url).fetch(request, env, ctx);
  },
};
