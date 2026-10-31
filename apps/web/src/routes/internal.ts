import { Hono } from 'hono';

import type { AppConfig } from '../config.js';
import type { MonitoringService } from '../monitoring/service.js';
import { digestsEqual } from '../monitoring/tokens.js';
import type { MonitorStore } from '../monitoring/types.js';
import type { ResultStore } from '../store/types.js';
import type { TargetRegistry } from '../targets/types.js';

export interface InternalRouteDependencies {
  config: AppConfig;
  store: ResultStore;
  targets?: TargetRegistry;
  monitors?: MonitorStore;
  /** Null when monitoring is off: no monitor cron, nothing to purge. */
  monitoring: MonitoringService | null;
  now: () => Date;
}

/** Floor between monitoring runs on this isolate; see the cron route. */
const MIN_MONITOR_RUN_INTERVAL_MS = 10 * 60 * 1000;
let lastMonitorRun = 0;

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

/** /internal: the crons the platform fires and the owner's exports. */
export function createInternalRoutes(deps: InternalRouteDependencies): Hono {
  const { config, store, monitoring, now } = deps;
  const app = new Hono();

  if (monitoring) {
    app.get('/cron/monitor', async (c) => {
      if (!c.req.header('x-spacefast-cron')) return c.text('cron only', 403);
      // Scheduled fires carry only the header, which anyone can set. The run is cheap
      // when nothing is due and rows are claimed before work, so the remaining defence
      // is a floor between runs on this isolate.
      const nowMs = now().getTime();
      if (nowMs - lastMonitorRun < MIN_MONITOR_RUN_INTERVAL_MS) {
        return c.json({ skipped: 'ran recently' }, 429);
      }
      lastMonitorRun = nowMs;
      return c.json(await monitoring.runDue());
    });
  }

  // Owner exports: the hosts ever scanned and the monitoring subscriptions. Bearer token only.
  app.get('/export/:file', async (c) => {
    if (!config.adminToken) return c.notFound();
    const token = bearerToken(c.req.header('authorization'));
    if (!token || !digestsEqual(token, config.adminToken))
      return c.json({ error: 'unauthorized' }, 401);
    const requested = Number(c.req.query('limit') ?? 1000);
    const limit = Number.isFinite(requested)
      ? Math.min(5000, Math.max(1, Math.trunc(requested)))
      : 1000;
    switch (c.req.param('file')) {
      case 'targets.json':
        return c.json({ targets: deps.targets ? await deps.targets.list(limit) : [] });
      case 'monitors.json': {
        const monitors = deps.monitors ? await deps.monitors.list(limit) : [];
        return c.json({
          monitors: monitors.map((monitor) => ({
            id: monitor.id,
            email: monitor.email,
            host: monitor.host,
            url: monitor.url,
            status: monitor.status,
            createdAt: monitor.createdAt,
            confirmedAt: monitor.confirmedAt,
            unsubscribedAt: monitor.unsubscribedAt,
            lastCheckedAt: monitor.lastCheckedAt,
            lastNotifiedAt: monitor.lastNotifiedAt,
            baseline: monitor.baseline,
          })),
        });
      }
      default:
        return c.notFound();
    }
  });

  app.get('/cron/cleanup', async (c) => {
    if (!c.req.header('x-spacefast-cron')) return c.text('cron only', 403);
    const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000).toISOString();
    const removed = await store.deleteOlderThan(cutoff);
    const pendingRemoved = monitoring ? await monitoring.purgePending() : 0;
    return c.json({ removed, cutoff, pendingRemoved });
  });

  return app;
}
