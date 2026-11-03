import { catalog } from '@agentic-readiness/catalog';
import {
  SCANNER_VERSION,
  SEARCH_CRAWLERS,
  SHARED_TRAINING_TOKEN,
  TRAINING_CRAWLERS,
  USER_FETCHERS,
} from '@agentic-readiness/core';
import { Hono } from 'hono';

import type { AppConfig } from './config.js';
import { MonitoringService } from './monitoring/service.js';
import type { Mailer, MonitorStore } from './monitoring/types.js';
import { createKnowledgeRoutes, knowledgeIndexLines } from './knowledge/routes.js';
import { homePage } from './pages/home.js';
import { messagePage } from './pages/layout.js';
import { createInternalRoutes } from './routes/internal.js';
import { createMonitorRoutes } from './routes/monitor.js';
import { createReportRoutes } from './routes/report.js';
import { scanOrReuse, type ScanDependencies } from './scan-service.js';
import { isRootInput } from './scan-scope.js';

export interface AppDependencies extends ScanDependencies {
  /** Monitoring needs both a store and a mailer, and a mail provider in the config. */
  monitors?: MonitorStore;
  mailer?: Mailer;
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
    rescan: async (url) => {
      if (!isRootInput(url)) throw new Error('Monitoring requires a root URL');
      const outcome = await scanOrReuse(deps, { url });
      if (outcome.persistence !== 'stored') throw new Error('Monitoring requires a root URL');
      return outcome.scan;
    },
    ...(deps.now ? { now: deps.now } : {}),
  });
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
- [MCP server](${config.baseUrl}/mcp): Streamable HTTP with tools scan_store, get_history, get_fix, explain_check and list_checks; server card at ${config.baseUrl}/mcp/server-card, listed in ${config.baseUrl}/.well-known/ai-catalog.json
- [History](${config.baseUrl}/h/example.com): every distinct state a host was observed in, with what changed between them; append .json for data
- Root profiles: use profile_url (or report_url) returned by a root scan, /sites/<host>, for the latest report. Use /sites/<host>/report.json or /report.md for its exports. Profile reads never run a scan. Subdomains are separate; www and the bare host share one profile.
- Snapshots: snapshot_url, /r/<id>, identifies one immutable scan; append .json or .md for exports. Full results expire under the ${config.retentionDays}-day retention policy; stable profiles retain recorded history. Stored reports and profiles are public and search-indexable.
- One-time scans: a submitted path, query or non-default port returns persistence="disposable" and the result directly, with no report/profile URL. It is a site scan started at that URL, including origin-wide signals and sampled pages, not a strict subtree audit. No result, history, monitoring or progress record is saved. In the web UI the result stays in the browser tab.
- [Result schema](${config.repositoryUrl}/blob/main/packages/catalog/src/result.ts): the versioned contract every report follows

## Knowledge base

One article per check: what it looks at, why agents care, how the scanner decides and how to fix it. Each link is Markdown; drop .md for the HTML page. Everything at once: ${config.baseUrl}/llms-full.txt

${knowledgeIndexLines(config)}

## Reference

- [Check catalog](${config.repositoryUrl}/blob/main/docs/checks.md): ${catalog.checks.length} checks, levels and profiles
- [Source](${config.repositoryUrl}): GPL-3.0-or-later

## How the scanner behaves on your site

- Identifies itself as AgenticReadinessScanner/${SCANNER_VERSION} on every request and never sends another agent's user agent
- Honours robots.txt for that token, makes at most ${config.scanBudget} sequential requests per scan, and starts at most one scan per host every ${config.targetCooldownSeconds} seconds across all paths and interfaces. Root cache hits replay a stored root result without fetching. Cooldown rejections return 429 and retry guidance; failed scans consume the minute too. Only the host and reservation timestamp/token are retained for this admission limit, not path data.
`;
}

/** Discovery links advertised on the home page, per RFC 8288 and the llms.txt proposal. */
function discoveryLinkHeader(config: AppConfig): string {
  return [
    `<${config.baseUrl}/llms.txt>; rel="llms-txt"; type="text/markdown"`,
    `<${config.baseUrl}/mcp>; rel="mcp-server"`,
    `<${config.baseUrl}/.well-known/ai-catalog.json>; rel="ai-catalog"; type="application/ai-catalog+json"`,
  ].join(', ');
}

/** The MCP server card (SEP-2127 shape), served at <endpoint>/server-card and at the community path. */
function serverCard(config: AppConfig) {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    name: config.appName,
    version: SCANNER_VERSION,
    description:
      'Scan a store URL for agentic readiness, read its history and get fixes for every finding.',
    websiteUrl: config.baseUrl,
    repository: config.repositoryUrl,
    // The community field names stay for clients that read the old path.
    endpoint: `${config.baseUrl}/mcp`,
    transport: 'streamable-http',
    remotes: [{ type: 'streamable-http', url: `${config.baseUrl}/mcp` }],
    tools: ['scan_store', 'get_history', 'get_fix', 'explain_check', 'list_checks'],
  };
}

/** The hosted app's own robots.txt: a wildcard policy, a shared training decision, and the crawler classes named. */
function robotsTxt(baseUrl: string): string {
  const disallow = [
    'Disallow: /h/',
    'Disallow: /api/',
    'Disallow: /internal/',
    'Disallow: /monitor/',
    // Legal signals are a technical evaluation, not advice: never crawled or indexed.
    'Disallow: /sites/*/legal',
    'Disallow: /r/*/legal',
  ];
  return [
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
    '# Search crawlers, assistants and agents are welcome on the public pages.',
    'User-agent: *',
    'Allow: /',
    ...disallow,
    'Content-Signal: ai-train=yes, search=yes, ai-input=yes',
    '',
    '# AI training: one shared decision (allowed here), see check A2.1.',
    `User-agent: ${SHARED_TRAINING_TOKEN}`,
    ...TRAINING_CRAWLERS.map((token) => `User-agent: ${token}`),
    'Allow: /',
    'Disallow: /r/',
    'Disallow: /sites/',
    ...disallow,
    '',
    '# The crawlers behind AI answers and the fetchers assistants use (checks A2.2 and A2.5).',
    ...SEARCH_CRAWLERS.map((crawler) => `User-agent: ${crawler.token}`),
    ...USER_FETCHERS.map((token) => `User-agent: ${token}`),
    'Allow: /',
    ...disallow,
    '',
  ].join('\n');
}

/**
 * Wires the hosted app: discovery pages here, scanning and reports in routes/report.ts,
 * monitoring in routes/monitor.ts, crons and exports in routes/internal.ts. The MCP
 * endpoint is mounted by the host (handler.ts, dev.ts) because its transport differs.
 */
export function createApp(deps: AppDependencies): Hono {
  const { config, store } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new Hono();
  const monitoring = createMonitoring(deps);

  app.onError((error, c) => {
    console.error(`[app] ${c.req.method} ${c.req.path}: ${String(error)}`);
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/internal/')) {
      return c.json({ error: 'Internal error.' }, 500);
    }
    return c.html(
      messagePage(
        config,
        'Something went wrong',
        'The scan could not be completed. <a href="/">Try again</a>.',
        { kind: 'error' },
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

  app.get('/robots.txt', (c) => c.text(robotsTxt(config.baseUrl)));

  app.route('/', createKnowledgeRoutes(config));

  app.get('/.well-known/security.txt', (c) =>
    c.text(
      `Contact: ${config.repositoryUrl}/security/advisories/new\nExpires: ${securityTxtExpires(now())}\nPreferred-Languages: en, de\nCanonical: ${config.baseUrl}/.well-known/security.txt\nPolicy: ${config.repositoryUrl}/blob/main/SECURITY.md\n`,
    ),
  );

  // MCP discovery as SEP-2127 describes it: the card next to the endpoint, listed in the
  // AI catalog; the community well-known path keeps answering for clients that read it.
  const card = (c: {
    json: (body: unknown, status?: 200, headers?: Record<string, string>) => Response;
  }) =>
    c.json(serverCard(config), 200, {
      'content-type': 'application/mcp-server-card+json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600',
    });
  app.get('/mcp/server-card', (c) => card(c));
  app.get('/.well-known/mcp/server-card.json', (c) => card(c));
  app.get('/.well-known/ai-catalog.json', (c) =>
    c.json(
      {
        entries: [
          {
            identifier: `urn:air:${new URL(config.baseUrl).hostname}:scanner`,
            type: 'application/mcp-server-card+json',
            url: `${config.baseUrl}/mcp/server-card`,
          },
        ],
      },
      200,
      {
        'content-type': 'application/ai-catalog+json; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=3600',
      },
    ),
  );

  app.route('/', createReportRoutes({ deps, monitoring }));
  if (monitoring) {
    app.route('/monitor', createMonitorRoutes({ config, service: monitoring, scans: store }));
  }
  app.route(
    '/internal',
    createInternalRoutes({
      config,
      store,
      monitoring,
      now,
      ...(deps.targets ? { targets: deps.targets } : {}),
      ...(deps.history ? { history: deps.history } : {}),
      ...(deps.progress ? { progress: deps.progress } : {}),
      ...(deps.limiter ? { limiter: deps.limiter } : {}),
      ...(deps.monitors ? { monitors: deps.monitors } : {}),
    }),
  );

  app.notFound((c) =>
    c.html(messagePage(config, 'Not found', '<a href="/">Back to the scanner</a>'), 404),
  );

  return app;
}
