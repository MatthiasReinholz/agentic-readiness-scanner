import { renderBadge, renderHtml, renderJson, renderMarkdown } from '@agentic-readiness/core';
import { Hono } from 'hono';

import type { AppConfig } from '../config.js';
import { entryContaining } from '../history/types.js';
import { SCAN_ID } from '../ids.js';
import type { MonitoringService } from '../monitoring/service.js';
import { historyJson, historyPage, sincePreviousPanel } from '../pages/history.js';
import { homePage } from '../pages/home.js';
import { hostedFooterHtml, hostedHead } from '../pages/layout.js';
import { MONITOR_SCRIPT, monitorDialog, monitorPanel } from '../pages/monitor.js';
import {
  ScanRequestError,
  scanOrReuse,
  validateScanRequest,
  type ScanDependencies,
} from '../scan-service.js';

export interface ReportRouteDependencies {
  deps: ScanDependencies;
  /** Null when monitoring is off: the report then carries no signup panel. */
  monitoring: MonitoringService | null;
}

function reportLinks(config: AppConfig, id: string, host: string) {
  return {
    reportUrl: `${config.baseUrl}/r/${id}`,
    jsonUrl: `${config.baseUrl}/r/${id}.json`,
    markdownUrl: `${config.baseUrl}/r/${id}.md`,
    badgeUrl: `${config.baseUrl}/badge/${host}.svg`,
    appName: config.appName,
    homeUrl: `${config.baseUrl}/`,
    head: hostedHead(),
    footerHtml: hostedFooterHtml(config),
  };
}

/** Distinct states shown on a history page at most. */
export const HISTORY_PAGE_ENTRIES = 200;

/** Scanning and reports: the form, the JSON API, /r/:id in three formats, history and the badge. */
export function createReportRoutes({ deps, monitoring }: ReportRouteDependencies): Hono {
  const { config, store } = deps;
  const app = new Hono();

  app.post('/scan', async (c) => {
    const form = await c.req.parseBody();
    try {
      const request = validateScanRequest(form);
      const { scan: stored } = await scanOrReuse(deps, request);
      return c.redirect(`/r/${stored.id}`, 303);
    } catch (error) {
      if (error instanceof ScanRequestError)
        return c.html(homePage(config, error.message), error.status as 400 | 503);
      throw error;
    }
  });

  app.post('/api/scan', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be JSON.' }, 400);
    }
    try {
      const request = validateScanRequest(
        body && typeof body === 'object' ? (body as Record<string, unknown>) : {},
      );
      const { scan: stored, reused } = await scanOrReuse(deps, request);
      return c.json({
        id: stored.id,
        reused,
        report_url: `${config.baseUrl}/r/${stored.id}`,
        result: stored.result,
      });
    } catch (error) {
      if (error instanceof ScanRequestError)
        return c.json({ error: error.message }, error.status as 400 | 503);
      throw error;
    }
  });

  app.get('/r/:file', async (c) => {
    const file = c.req.param('file');
    const match = /^([0-9a-f]{16})(?:\.(json|md))?$/.exec(file);
    if (!match?.[1] || !SCAN_ID.test(match[1])) return c.notFound();
    const stored = await store.get(match[1]);
    if (!stored) return c.notFound();
    const format = match[2] ?? (c.req.header('accept')?.includes('text/markdown') ? 'md' : 'html');
    c.header('cache-control', 'public, max-age=300');
    // The bare URL negotiates on Accept, so caches must key on it or Markdown clients get HTML.
    c.header('vary', 'Accept');
    if (format === 'json')
      return c.body(renderJson(stored.result), 200, {
        'content-type': 'application/json; charset=utf-8',
      });
    if (format === 'md')
      return c.body(
        renderMarkdown(stored.result, { reportUrl: `${config.baseUrl}/r/${stored.id}` }),
        200,
        {
          'content-type': 'text/markdown; charset=utf-8',
          vary: 'Accept',
        },
      );
    // Recent entries are enough to place this scan and show what changed before it.
    const entries = deps.history ? await deps.history.forHost(stored.host, 20) : [];
    const progress =
      entries.length > 0
        ? sincePreviousPanel(stored.host, entries, stored, entryContaining(entries, stored))
        : '';
    const monitorSlots = monitoring
      ? {
          endHtml: monitorDialog(config, stored),
          scripts: [MONITOR_SCRIPT],
        }
      : {};
    return c.html(
      renderHtml(stored.result, {
        ...reportLinks(config, stored.id, stored.host),
        afterScoresHtml: `${progress}${monitoring ? monitorPanel(config, stored) : ''}`,
        ...monitorSlots,
      }),
    );
  });

  // History per host: one row per distinct state, never purged.
  app.get('/h/:file', async (c) => {
    const match = /^([a-z0-9.-]+?)(\.json)?$/i.exec(c.req.param('file'));
    if (!match?.[1] || !deps.history) return c.notFound();
    const host = match[1].toLowerCase();
    const entries = await deps.history.forHost(host, HISTORY_PAGE_ENTRIES);
    c.header('cache-control', 'public, max-age=300');
    if (match[2]) {
      if (entries.length === 0) return c.json({ error: 'No scans recorded for this host.' }, 404);
      return c.json(historyJson(host, entries));
    }
    if (entries.length === 0 && !(await store.latestForHost(host))) return c.notFound();
    const now = deps.now ?? (() => new Date());
    return c.html(historyPage(config, { host, entries, now: now() }));
  });

  app.get('/badge/:file', async (c) => {
    const match = /^([a-z0-9.-]+)\.svg$/i.exec(c.req.param('file'));
    if (!match?.[1]) return c.notFound();
    const stored = await store.latestForHost(match[1].toLowerCase());
    if (!stored) return c.notFound();
    return c.body(renderBadge(stored.result), 200, {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=86400',
    });
  });

  return app;
}
