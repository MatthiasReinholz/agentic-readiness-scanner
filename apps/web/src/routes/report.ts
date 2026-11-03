import {
  escapeHtml,
  legalJson,
  renderBadge,
  renderHtml,
  renderJson,
  renderLegalHtml,
  renderLegalMarkdown,
  renderMarkdown,
  withoutLegal,
} from '@agentic-readiness/core';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { AppConfig } from '../config.js';
import { knowledgeUrlFor } from '../knowledge/pages.js';
import { reportMetadata } from '../metadata.js';
import type { StoredScan } from '../store/types.js';
import { entryContaining } from '../history/types.js';
import { hostKey } from '../hosts.js';
import { SCAN_ID } from '../ids.js';
import type { MonitoringService } from '../monitoring/service.js';
import { historyJson, historyPage, sincePreviousPanel, withinRetention } from '../pages/history.js';
import { homePage } from '../pages/home.js';
import { disposableReport } from '../pages/disposable-report.js';
import { isRootInput, isRootScan, profileHost, siteProfilePath } from '../scan-scope.js';
import { hostedFooterHtml, hostedHead } from '../pages/layout.js';
import { MONITOR_SCRIPT, monitorDialog, monitorPanel } from '../pages/monitor.js';
import { ProgressRecorder } from '../jobs/progress.js';
import { PROGRESS_TOKEN } from '../progress/types.js';
import {
  donePayload,
  ScanRequestError,
  scanOrReuse,
  validateScanRequest,
  type ScanDependencies,
} from '../scan-service.js';
import { continueInBackground, outcomeJson } from './jobs.js';

export interface ReportRouteDependencies {
  deps: ScanDependencies;
  /** Null when monitoring is off: the report then carries no signup panel. */
  monitoring: MonitoringService | null;
}

function reportLinks(config: AppConfig, stored: StoredScan, path = `/r/${stored.id}`) {
  const { host } = stored;
  const metadata = reportMetadata(config, stored, path);
  const url = `${config.baseUrl}${path}`;
  const latest = path.startsWith('/sites/');
  return {
    title: metadata.title,
    description: metadata.description,
    reportUrl: url,
    jsonUrl: latest ? `${url}/report.json` : `${url}.json`,
    markdownUrl: latest ? `${url}/report.md` : `${url}.md`,
    badgeUrl: `${config.baseUrl}/badge/${host}.svg`,
    appName: config.appName,
    homeUrl: `${config.baseUrl}/`,
    head: `${hostedHead()}\n${metadata.head}`,
    footerHtml: hostedFooterHtml(config),
  };
}

function legalFormat(c: Context, file: string): string {
  if (file.endsWith('.json')) return 'json';
  if (file.endsWith('.md') || c.req.header('accept')?.includes('text/markdown')) return 'md';
  return 'html';
}

/** Distinct states shown on a history page at most. */
export const HISTORY_PAGE_ENTRIES = 200;

/** Scanning and reports: the form, the JSON API, /r/:id in three formats, history and the badge. */
export function createReportRoutes({ deps, monitoring }: ReportRouteDependencies): Hono {
  const { config, store } = deps;
  const app = new Hono();
  const now = deps.now ?? (() => new Date());

  async function serveReport(
    c: Context,
    stored: StoredScan,
    format: string,
    path = `/r/${stored.id}`,
  ): Promise<Response> {
    const links = reportLinks(config, stored, path);
    c.header(
      'Link',
      `<${links.reportUrl}>; rel="canonical", <${links.jsonUrl}>; rel="alternate"; type="application/json", <${links.markdownUrl}>; rel="alternate"; type="text/markdown"`,
    );
    c.header(
      'X-Robots-Tag',
      format === 'html' ? 'index, follow, max-image-preview:large' : 'noindex, follow',
    );
    c.header('Cache-Control', 'public, max-age=60');
    c.header('Vary', 'Accept');
    if (format === 'json')
      return c.body(renderJson(withoutLegal(stored.result)), 200, {
        'content-type': 'application/json; charset=utf-8',
      });
    if (format === 'md')
      return c.body(renderMarkdown(stored.result, { reportUrl: links.reportUrl }), 200, {
        'content-type': 'text/markdown; charset=utf-8',
      });
    const entries = deps.history
      ? await deps.history.forHost(stored.host, HISTORY_PAGE_ENTRIES)
      : [];
    const progress =
      entries.length > 0
        ? sincePreviousPanel(stored.host, entries, stored, entryContaining(entries, stored))
        : '';
    const root = isRootScan(stored);
    const legalLink = `<p class="mt-5 text-sm text-muted-foreground"><a class="font-semibold text-primary hover:underline" href="${path}/legal" rel="nofollow">Legal signals</a>: a technical evaluation of the store's public legal disclosures, never scored and not legal advice.</p>`;
    const profile = root
      ? `<p class="mt-5 text-sm text-muted-foreground">Store profile: <a class="text-primary hover:underline" href="${siteProfilePath(stored.host)}">${escapeHtml(stored.host)}</a> · <a class="text-primary hover:underline" href="/r/${stored.id}">This scan's snapshot</a> · <a class="text-primary hover:underline" href="/h/${encodeURIComponent(stored.host)}">History</a></p>`
      : '';
    const monitorSlots =
      monitoring && root
        ? { endHtml: monitorDialog(config, stored), scripts: [MONITOR_SCRIPT] }
        : {};
    return c.html(
      renderHtml(stored.result, {
        ...links,
        afterScoresHtml: `${legalLink}${profile}${progress}${monitoring && root ? monitorPanel(config, stored) : ''}`,
        ...monitorSlots,
      }),
    );
  }

  /**
   * Legal signals beside a report, at <report>/legal: never indexed, never crawled (robots
   * disallows the path), never in the sitemap, and every format opens with the notice.
   */
  function serveLegal(c: Context, stored: StoredScan, format: string, path: string): Response {
    const base = `${config.baseUrl}${path}`;
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    c.header('Cache-Control', 'public, max-age=60');
    c.header('Vary', 'Accept');
    const options = {
      appName: config.appName,
      homeUrl: `${config.baseUrl}/`,
      reportUrl: base,
      jsonUrl: `${base}/legal.json`,
      markdownUrl: `${base}/legal.md`,
      knowledgeUrl: (id: string) => knowledgeUrlFor(config, id),
      head: hostedHead(),
      footerHtml: hostedFooterHtml(config),
    };
    if (format === 'json') return c.json(legalJson(stored.result, options));
    if (format === 'md')
      return c.body(renderLegalMarkdown(stored.result, options), 200, {
        'content-type': 'text/markdown; charset=utf-8',
      });
    return c.html(renderLegalHtml(stored.result, options));
  }

  // Stable host identity and immutable snapshot identity are deliberately separate.
  async function serveProfile(c: Context, format: string): Promise<Response> {
    c.header('Vary', 'Accept');
    const host = profileHost(c.req.param('host') ?? '');
    if (!host) return c.notFound();
    const path = siteProfilePath(host);
    if (host !== c.req.param('host'))
      return c.redirect(`${path}${format === 'html' ? '' : `/report.${format}`}`, 301);
    const stored = await store.latestForHost(host);
    if (stored && isRootScan(stored) && withinRetention(config, stored.createdAt, now()))
      return serveReport(c, stored, format, path);
    if (format !== 'html') return c.notFound();
    const entries = deps.history ? await deps.history.forHost(host, HISTORY_PAGE_ENTRIES) : [];
    if (!entries.length) return c.notFound();
    c.header('Cache-Control', 'public, max-age=60');
    return c.html(historyPage(config, { host, entries, now: now(), view: 'profile' }));
  }
  app.get('/sites/:host', (c) =>
    serveProfile(c, c.req.header('accept')?.includes('text/markdown') ? 'md' : 'html'),
  );
  app.get('/sites/:host/report.json', (c) => serveProfile(c, 'json'));
  app.get('/sites/:host/report.md', (c) => serveProfile(c, 'md'));
  app.get('/sites/:host/:legal{legal(?:\\.json|\\.md)?}', async (c) => {
    const host = profileHost(c.req.param('host'));
    if (!host) return c.notFound();
    const file = c.req.param('legal');
    if (host !== c.req.param('host')) return c.redirect(`${siteProfilePath(host)}/${file}`, 301);
    const stored = await store.latestForHost(host);
    if (!stored || !isRootScan(stored) || !withinRetention(config, stored.createdAt, now()))
      return c.notFound();
    return serveLegal(c, stored, legalFormat(c, file), siteProfilePath(host));
  });
  app.get('/r/:id/:legal{legal(?:\\.json|\\.md)?}', async (c) => {
    const id = c.req.param('id');
    if (!SCAN_ID.test(id)) return c.notFound();
    const stored = await store.get(id);
    if (!stored || !withinRetention(config, stored.createdAt, now())) return c.notFound();
    return serveLegal(c, stored, legalFormat(c, c.req.param('legal')), `/r/${id}`);
  });

  app.post('/scan', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    try {
      const form = await c.req.parseBody();
      const request = validateScanRequest(form);
      const outcome = await scanOrReuse(deps, request);
      if (outcome.persistence === 'disposable')
        return c.html(disposableReport(config, outcome.result));
      if (outcome.persistence === 'pending') {
        continueInBackground(c, config, outcome);
        return c.redirect(`/scan/jobs/${outcome.job.id}`, 303);
      }
      return c.redirect(siteProfilePath(outcome.scan.host), 303);
    } catch (error) {
      if (error instanceof ScanRequestError) {
        if (error.retryAfterSeconds) c.header('Retry-After', String(error.retryAfterSeconds));
        return c.html(homePage(config, error.message), error.status as 400 | 429 | 503);
      }
      console.error('[scan]', error instanceof Error ? error.name : 'UnexpectedError');
      return c.html(homePage(config, 'The scan failed unexpectedly. Try again in a minute.'), 500);
    }
  });

  app.post('/api/scan', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
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
      const outcome = await scanOrReuse(deps, request);
      // A scan that needs more steps answers 202 with where to follow it; the steps run
      // on without the caller (see continueInBackground and the sweeper cron).
      continueInBackground(c, config, outcome);
      return c.json(outcomeJson(config, outcome), outcome.persistence === 'pending' ? 202 : 200);
    } catch (error) {
      if (error instanceof ScanRequestError) {
        if (error.retryAfterSeconds) c.header('Retry-After', String(error.retryAfterSeconds));
        return c.json({ error: error.message }, error.status as 400 | 429 | 503);
      }
      console.error('[scan]', error instanceof Error ? error.name : 'UnexpectedError');
      return c.json({ error: 'The scan failed unexpectedly. Try again in a minute.' }, 500);
    }
  });

  // The same scan as /api/scan, streamed as server-sent events so the home page can show
  // what the scanner is doing: `progress` per phase and per check verdict, then `done`
  // with the report URL, or `failure` with the reason. A reused result answers `done` at
  // once with its verdicts, so the page can replay them. A scan that needs more steps
  // ends the stream with `paused` and its job; the page then calls the job's continue
  // endpoint until it is done.
  app.post('/api/scan/stream', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be JSON.' }, 400);
    }
    let request;
    try {
      request = validateScanRequest(
        body && typeof body === 'object' ? (body as Record<string, unknown>) : {},
      );
    } catch (error) {
      if (error instanceof ScanRequestError)
        return c.json({ error: error.message }, error.status as 400);
      throw error;
    }
    const rawToken =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>).progress_token
        : undefined;
    const token =
      isRootInput(request.url) &&
      typeof rawToken === 'string' &&
      PROGRESS_TOKEN.test(rawToken) &&
      deps.progress
        ? rawToken
        : null;
    c.header('cache-control', 'no-store, no-transform');
    c.header('X-Robots-Tag', 'noindex');
    // The platform's nginx front buffers proxied responses unless told otherwise; without
    // this every event would arrive at once when the scan ends.
    c.header('x-accel-buffering', 'no');
    const response = streamSSE(c, async (stream) => {
      let open = true;
      stream.onAbort(() => {
        open = false;
      });
      // Writes are chained so they reach the client in order and all of them have flushed
      // before the stream closes.
      let pending: Promise<unknown> = Promise.resolve();
      const send = (event: string, data: unknown): void => {
        if (!open) return;
        pending = pending.then(() => stream.writeSSE({ event, data: JSON.stringify(data) }));
      };
      // The scan's steps write the same events to the progress record (the platform holds
      // the stream back until it ends, so the page polls the record). Outcomes that ran no
      // step, a reused result or a refusal, are written here.
      const finish = async (event: 'done' | 'failure', data: unknown): Promise<void> => {
        send(event, data);
        if (token && deps.progress) {
          const recorder = await ProgressRecorder.open(deps.progress, token);
          await recorder.finish(event, data);
        }
      };
      // A comment every few seconds keeps intermediaries from holding the stream while a
      // slow store takes its time between events.
      const keepAlive = setInterval(() => {
        if (open) pending = pending.then(() => stream.write(': keep-alive\n\n'));
      }, 5000);
      try {
        const outcome = await scanOrReuse(
          deps,
          { ...request, ...(token ? { progressToken: token } : {}) },
          (event) => {
            send('progress', event);
          },
        );
        if (outcome.persistence === 'pending') {
          // The page drives the next steps; the app and the sweeper cron do when it closes.
          continueInBackground(c, config, outcome);
          send('paused', outcomeJson(config, outcome));
        } else await finish('done', donePayload(outcome));
      } catch (error) {
        if (error instanceof ScanRequestError)
          await finish('failure', { message: error.message, status: error.status });
        else {
          console.error('[scan-stream]', error instanceof Error ? error.name : 'UnexpectedError');
          const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          await finish('failure', {
            message: `The scan failed unexpectedly (${reason.slice(0, 200)}). Try again in a minute.`,
            status: 500,
          });
        }
      } finally {
        clearInterval(keepAlive);
        await pending.catch(() => undefined);
      }
    });
    // streamSSE sets no-cache itself; disposable payloads require the stronger no-store policy.
    response.headers.set('Cache-Control', 'no-store, no-transform');
    return response;
  });

  // What a scan in flight has done so far, for the page's poll: events after `after`, and
  // the final event once the scan ended. Unknown tokens answer 404 until the first write.
  app.get('/api/scan/progress/:token', async (c) => {
    const token = c.req.param('token');
    if (!PROGRESS_TOKEN.test(token) || !deps.progress) return c.notFound();
    c.header('cache-control', 'no-store');
    const record = await deps.progress.load(token);
    if (!record) return c.json({ events: [], final: null }, 404);
    const after = Number(c.req.query('after') ?? '0');
    const events = record.events.filter(
      (event) =>
        typeof event === 'object' &&
        event !== null &&
        Number((event as { seq?: unknown }).seq) > (Number.isFinite(after) ? after : 0),
    );
    return c.json({ events, final: record.final });
  });

  app.get('/r/:file', async (c) => {
    const file = c.req.param('file');
    const match = /^([0-9a-f]{16})(?:\.(json|md))?$/.exec(file);
    if (!match?.[1] || !SCAN_ID.test(match[1])) return c.notFound();
    const stored = await store.get(match[1]);
    if (!stored || !withinRetention(config, stored.createdAt, now())) return c.notFound();
    const format = match[2] ?? (c.req.header('accept')?.includes('text/markdown') ? 'md' : 'html');
    return serveReport(c, stored, format);
  });

  // History per host: one row per distinct state, never purged.
  app.get('/h/:file', async (c) => {
    const match = /^([a-z0-9.-]+?)(\.json)?$/i.exec(c.req.param('file'));
    if (!match?.[1] || !deps.history) return c.notFound();
    const host = hostKey(match[1]);
    // One page per site: /h/www.example.com moves to /h/example.com.
    if (host !== match[1]) return c.redirect(`/h/${host}${match[2] ?? ''}`, 301);
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
    const stored = await store.latestForHost(hostKey(match[1]));
    if (!stored) return c.notFound();
    return c.body(renderBadge(stored.result), 200, {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=86400',
    });
  });

  return app;
}
