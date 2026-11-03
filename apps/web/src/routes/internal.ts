import { Hono } from 'hono';

import type { AppConfig } from '../config.js';
import { hostKey } from '../hosts.js';
import type { HistoryStore } from '../history/types.js';
import type { ProgressStore } from '../progress/types.js';
import type { MonitoringService } from '../monitoring/service.js';
import { digestsEqual } from '../monitoring/tokens.js';
import type { MonitorStore } from '../monitoring/types.js';
import type { ResultStore } from '../store/types.js';
import type { TargetRegistry } from '../targets/types.js';
import type { ScanLimiter } from '../rate-limit/types.js';
import type { ScanJobStore } from '../jobs/types.js';
import type { SweepReport } from '../scan-service.js';

export interface InternalRouteDependencies {
  config: AppConfig;
  store: ResultStore;
  targets?: TargetRegistry;
  history?: HistoryStore;
  monitors?: MonitorStore;
  progress?: ProgressStore;
  limiter?: ScanLimiter;
  /** Null when monitoring is off: no monitor cron, nothing to purge. */
  monitoring: MonitoringService | null;
  jobs: ScanJobStore;
  /** Runs steps of scans nobody advanced lately, within the time given. */
  sweep: (budgetMs: number) => Promise<SweepReport>;
  now: () => Date;
}

/** Time the sweeper spends per run: Functions requests answer within 30 seconds. */
const SWEEP_BUDGET_MS = 26_000;
/** A scan still running after this long is given up; its steps would have finished long ago. */
const JOB_EXPIRY_MS = 30 * 60 * 1000;

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

  // Owner exports: the hosts ever scanned, one host's history and the monitoring
  // subscriptions. Bearer token only.
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
      case 'history.json': {
        const host = hostKey(c.req.query('host') ?? '');
        if (!/^[a-z0-9.-]+$/.test(host)) return c.json({ error: 'host is required' }, 400);
        return c.json({
          host,
          entries: deps.history ? await deps.history.forHost(host, limit) : [],
        });
      }
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

  // The third trigger after the page and the app itself: every hour, the next step of
  // each scan nobody advanced lately. Overlapping fires are skipped by the platform and
  // job leases keep a step from running twice, so the header gate is enough.
  app.get('/cron/scan-jobs', async (c) => {
    if (!c.req.header('x-spacefast-cron')) return c.text('cron only', 403);
    return c.json(await deps.sweep(SWEEP_BUDGET_MS));
  });

  app.get('/cron/cleanup', async (c) => {
    if (!c.req.header('x-spacefast-cron')) return c.text('cron only', 403);
    const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000).toISOString();
    const removed = await store.deleteOlderThan(cutoff);
    const pendingRemoved = monitoring ? await monitoring.purgePending() : 0;
    const progressRemoved = deps.progress
      ? await deps.progress.deleteOlderThan(new Date(Date.now() - 3_600_000).toISOString())
      : 0;
    const limitsRemoved = deps.limiter
      ? await deps.limiter.deleteOlderThan(new Date(now().getTime() - 86_400_000).toISOString())
      : 0;
    const nowMs = now().getTime();
    const jobsExpired = await deps.jobs.expireRunning(
      new Date(nowMs - JOB_EXPIRY_MS).toISOString(),
      now().toISOString(),
    );
    const jobsRemoved = await deps.jobs.deleteOlderThan(new Date(nowMs - 86_400_000).toISOString());
    const cacheRemoved = await deps.jobs.cacheDeleteOlderThan(
      new Date(nowMs - 2 * 3_600_000).toISOString(),
    );
    return c.json({
      removed,
      cutoff,
      pendingRemoved,
      progressRemoved,
      limitsRemoved,
      jobsExpired,
      jobsRemoved,
      cacheRemoved,
    });
  });

  return app;
}
