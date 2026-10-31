import { catalog, type ScanResult } from '@agentic-readiness/catalog';
import {
  BlockedUrlError,
  escapeHtml,
  normalizeInputUrl,
  renderBadge,
  renderHtml,
  renderJson,
  renderMarkdown,
  scan,
  SCANNER_VERSION,
  TargetUnreachableError,
  type Fetcher,
  type ScanOptions,
} from '@agentic-readiness/core';
import { Hono } from 'hono';

import type { AppConfig } from './config.js';
import { MonitoringService } from './monitoring/service.js';
import { digestsEqual } from './monitoring/tokens.js';
import type { Mailer, MonitorStore } from './monitoring/types.js';
import { homePage } from './pages/home.js';
import { page } from './pages/layout.js';
import { MONITOR_CSS, MONITOR_SCRIPT, monitorDialog, monitorPanel } from './pages/monitor.js';
import { createMonitorRoutes } from './routes/monitor.js';
import { newScanId, type ResultStore, type StoredScan } from './store/types.js';
import type { TargetRegistry } from './targets/types.js';

export interface AppDependencies {
  config: AppConfig;
  store: ResultStore;
  /** Durable registry of every host scanned; optional so the app runs without it. */
  targets?: TargetRegistry;
  /** Monitoring needs both a store and a mailer, and a mail provider in the config. */
  monitors?: MonitorStore;
  mailer?: Mailer;
  /** Test seam: supply a Fetcher factory to answer from fixtures instead of the network. */
  fetcherFactory?: () => Fetcher;
  now?: () => Date;
}

export interface ScanRequest {
  url: string;
  profile?: string;
}

export class ScanRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ScanRequestError';
  }
}

const PROFILE_IDS = new Set(catalog.profiles.map((profile) => profile.id));
const SCAN_ID = /^[0-9a-f]{16}$/;

function validateScanRequest(input: Record<string, unknown>): ScanRequest {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url) throw new ScanRequestError('A URL is required.', 400);
  const profile =
    typeof input.profile === 'string' && input.profile !== '' ? input.profile : undefined;
  if (profile !== undefined && !PROFILE_IDS.has(profile))
    throw new ScanRequestError(`Unknown profile "${profile}".`, 400);
  return { url, ...(profile !== undefined ? { profile } : {}) };
}

/**
 * Runs or reuses a scan. A target host is scanned at most once per cooldown window;
 * within it the stored result is returned so repeated submissions cost nothing.
 */
export async function scanOrReuse(
  deps: AppDependencies,
  request: ScanRequest,
): Promise<{ scan: StoredScan; reused: boolean }> {
  let host: string;
  try {
    host = normalizeInputUrl(request.url).hostname.toLowerCase();
  } catch {
    throw new ScanRequestError('That does not look like a URL.', 400);
  }
  const now = deps.now ?? (() => new Date());
  const latest = await deps.store.latestForHost(host);
  // One scan per host per cooldown window, whatever the caller asks for: the window is
  // the only thing standing between this endpoint and a request amplifier, so a profile
  // override does not reopen it. Inside the window the stored result is served.
  if (
    latest &&
    now().getTime() - Date.parse(latest.createdAt) < deps.config.targetCooldownSeconds * 1000
  ) {
    return { scan: latest, reused: true };
  }
  const inFlight = inFlightScans.get(host);
  if (inFlight) return inFlight.then((scan) => ({ scan, reused: true }));
  if (inFlightScans.size >= MAX_CONCURRENT_SCANS) {
    throw new ScanRequestError('The scanner is busy; try again in a minute.', 503);
  }
  const running = performScan(deps, request, host, now);
  inFlightScans.set(host, running);
  try {
    return { scan: await running, reused: false };
  } finally {
    inFlightScans.delete(host);
  }
}

/** Floor between monitoring runs on this isolate; see the cron route. */
const MIN_MONITOR_RUN_INTERVAL_MS = 10 * 60 * 1000;
let lastMonitorRun = 0;

/** Scans in progress on this isolate, by host: parallel submissions share one scan. */
const inFlightScans = new Map<string, Promise<StoredScan>>();
/** Scans this isolate runs at once before answering 503. */
const MAX_CONCURRENT_SCANS = 4;

async function performScan(
  deps: AppDependencies,
  request: ScanRequest,
  host: string,
  now: () => Date,
): Promise<StoredScan> {
  const options: ScanOptions = {
    budget: deps.config.scanBudget,
    now,
    ...(deps.fetcherFactory ? { fetcher: deps.fetcherFactory() } : {}),
    ...(request.profile !== undefined ? { profile: request.profile } : {}),
  };
  let result: ScanResult;
  try {
    result = await scan(request.url, options);
  } catch (error) {
    if (error instanceof TargetUnreachableError) throw new ScanRequestError(error.message, 422);
    if (error instanceof BlockedUrlError) throw new ScanRequestError(error.message, 400);
    throw error;
  }
  const stored: StoredScan = { id: newScanId(), host, createdAt: now().toISOString(), result };
  await deps.store.put(stored);
  await deps.targets?.record(stored);
  return stored;
}

function createMonitoring(deps: AppDependencies): MonitoringService | null {
  if (!deps.monitors || !deps.mailer || deps.config.monitoring.provider === null) return null;
  if (!deps.config.baseUrlExplicit) {
    // Email links must never be built from a request's Host header.
    console.warn('[monitor] disabled: set APP_BASE_URL to enable monitoring');
    return null;
  }
  return new MonitoringService({
    config: deps.config,
    store: deps.monitors,
    mailer: deps.mailer,
    latestScan: (host) => deps.store.latestForHost(host),
    rescan: (url) => scanOrReuse(deps, { url }).then((outcome) => outcome.scan),
    ...(deps.now ? { now: deps.now } : {}),
  });
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

function reportLinks(config: AppConfig, id: string, host: string) {
  return {
    reportUrl: `${config.baseUrl}/r/${id}`,
    jsonUrl: `${config.baseUrl}/r/${id}.json`,
    markdownUrl: `${config.baseUrl}/r/${id}.md`,
    badgeUrl: `${config.baseUrl}/badge/${host}.svg`,
    appName: config.appName,
    homeUrl: `${config.baseUrl}/`,
    footerHtml: `<a href="${escapeHtml(config.repositoryUrl)}">Source on GitHub</a> · GPL-3.0-or-later · Not affiliated with Automattic, WordPress or WooCommerce.`,
  };
}

/** security.txt Expires: RFC 9116 wants it under a year away; the first of a month about six months out. */
function securityTxtExpires(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 7, 1));
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function llmsTxt(config: AppConfig): string {
  return `# ${config.appName}

> Scans any store URL for agentic ingestion and agentic commerce readiness. Public signals only. Every finding ships with a fix.

## Use it

- [Scan form](${config.baseUrl}/): submit a URL, get a report
- [JSON API](${config.baseUrl}/): POST {"url": "https://example.com"} to ${config.baseUrl}/api/scan and receive the result object (GET is not served)
- [MCP server card](${config.baseUrl}/.well-known/mcp/server-card.json): Streamable HTTP endpoint at ${config.baseUrl}/mcp with tools scan_store, get_fix and list_checks
- [Result schema](${config.repositoryUrl}/blob/main/packages/catalog/src/result.ts): the versioned contract every report follows

## Reference

- [Check catalog](${config.repositoryUrl}/blob/main/docs/checks.md): ${catalog.checks.length} checks, levels and profiles
- [Source](${config.repositoryUrl}): GPL-3.0-or-later
`;
}

/** Discovery links advertised on the home page, per RFC 8288 and the llms.txt proposal. */
function discoveryLinkHeader(config: AppConfig): string {
  return [
    `<${config.baseUrl}/llms.txt>; rel="llms-txt"; type="text/markdown"`,
    `<${config.baseUrl}/.well-known/mcp/server-card.json>; rel="mcp-server"; type="application/json"`,
  ].join(', ');
}

export function createApp(deps: AppDependencies): Hono {
  const { config, store } = deps;
  const app = new Hono();
  const monitoring = createMonitoring(deps);

  app.onError((error, c) => {
    console.error(`[app] ${c.req.method} ${c.req.path}: ${String(error)}`);
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/internal/')) {
      return c.json({ error: 'Internal error.' }, 500);
    }
    return c.html(
      page(
        config,
        { title: 'Something went wrong' },
        '<h1>Something went wrong</h1><p class="muted" style="margin-top:12px">The scan could not be completed. <a href="/">Try again</a>.</p>',
      ),
      500,
    );
  });

  // Spacefast's sf.jsonc header rules apply to static files, not to worker responses,
  // so the app sets its own security headers on every response.
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  app.get('/', (c) => {
    c.header('Link', discoveryLinkHeader(config));
    return c.html(homePage(config));
  });

  app.get('/health', (c) =>
    c.json({ ok: true, version: SCANNER_VERSION, catalog: catalog.version }),
  );

  app.get('/llms.txt', (c) =>
    c.text(llmsTxt(config), 200, { 'content-type': 'text/markdown; charset=utf-8' }),
  );

  app.get('/robots.txt', (c) =>
    c.text(
      [
        '# Shopping agents and AI crawlers are welcome on the public pages.',
        'User-agent: *',
        'Allow: /',
        'Disallow: /r/',
        'Disallow: /api/',
        'Disallow: /internal/',
        'Disallow: /monitor/',
        'Content-Signal: ai-train=yes, search=yes, ai-input=yes',
        '',
        '# Explicit decisions for AI training crawlers (see check A2.1).',
        'User-agent: GPTBot',
        'User-agent: ClaudeBot',
        'User-agent: Google-Extended',
        'User-agent: PerplexityBot',
        'User-agent: CCBot',
        'User-agent: Bytespider',
        'User-agent: Applebot-Extended',
        'Allow: /',
        'Disallow: /r/',
        'Disallow: /api/',
        'Disallow: /internal/',
        'Disallow: /monitor/',
        '',
      ].join('\n'),
    ),
  );

  app.get('/.well-known/security.txt', (c) =>
    c.text(
      `Contact: ${config.repositoryUrl}/security/advisories/new\nExpires: ${securityTxtExpires((deps.now ?? (() => new Date()))())}\nPreferred-Languages: en, de\nCanonical: ${config.baseUrl}/.well-known/security.txt\nPolicy: ${config.repositoryUrl}/blob/main/SECURITY.md\n`,
    ),
  );

  app.get('/.well-known/mcp/server-card.json', (c) =>
    c.json({
      name: config.appName,
      description: 'Scan a store URL for agentic readiness and get fixes for every finding.',
      version: SCANNER_VERSION,
      endpoint: `${config.baseUrl}/mcp`,
      transport: 'streamable-http',
      tools: ['scan_store', 'get_fix', 'list_checks'],
      repository: config.repositoryUrl,
    }),
  );

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
    const monitorSlots = monitoring
      ? {
          afterScoresHtml: monitorPanel(config, stored),
          endHtml: `<style>${MONITOR_CSS}</style>${monitorDialog(config, stored)}`,
          scripts: [MONITOR_SCRIPT],
        }
      : {};
    return c.html(
      renderHtml(stored.result, {
        ...reportLinks(config, stored.id, stored.host),
        ...monitorSlots,
      }),
    );
  });

  if (monitoring) {
    app.route('/monitor', createMonitorRoutes({ config, service: monitoring, scans: store }));

    app.get('/internal/cron/monitor', async (c) => {
      if (!c.req.header('x-spacefast-cron')) return c.text('cron only', 403);
      // Scheduled fires carry only the header, which anyone can set. The run is cheap
      // when nothing is due and rows are claimed before work, so the remaining defence
      // is a floor between runs on this isolate.
      const nowMs = (deps.now ?? (() => new Date()))().getTime();
      if (nowMs - lastMonitorRun < MIN_MONITOR_RUN_INTERVAL_MS) {
        return c.json({ skipped: 'ran recently' }, 429);
      }
      lastMonitorRun = nowMs;
      return c.json(await monitoring.runDue());
    });
  }

  // Owner exports: the hosts ever scanned and the monitoring subscriptions. Bearer token only.
  app.get('/internal/export/:file', async (c) => {
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

  app.get('/internal/cron/cleanup', async (c) => {
    if (!c.req.header('x-spacefast-cron')) return c.text('cron only', 403);
    const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000).toISOString();
    const removed = await store.deleteOlderThan(cutoff);
    const pendingRemoved = monitoring ? await monitoring.purgePending() : 0;
    return c.json({ removed, cutoff, pendingRemoved });
  });

  app.notFound((c) =>
    c.html(
      page(
        config,
        { title: 'Not found' },
        '<h1>Not found</h1><p class="muted" style="margin-top:12px"><a href="/">Back to the scanner</a></p>',
      ),
      404,
    ),
  );

  return app;
}
