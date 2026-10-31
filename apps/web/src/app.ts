import { catalog } from '@agentic-readiness/catalog';
import { SCANNER_VERSION } from '@agentic-readiness/core';
import { Hono } from 'hono';

import type { AppConfig } from './config.js';
import { MonitoringService } from './monitoring/service.js';
import type { Mailer, MonitorStore } from './monitoring/types.js';
import { homePage } from './pages/home.js';
import { page } from './pages/layout.js';
import { createInternalRoutes } from './routes/internal.js';
import { createMonitorRoutes } from './routes/monitor.js';
import { createReportRoutes } from './routes/report.js';
import { scanOrReuse, type ScanDependencies } from './scan-service.js';

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
    rescan: (url) => scanOrReuse(deps, { url }).then((outcome) => outcome.scan),
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
      `Contact: ${config.repositoryUrl}/security/advisories/new\nExpires: ${securityTxtExpires(now())}\nPreferred-Languages: en, de\nCanonical: ${config.baseUrl}/.well-known/security.txt\nPolicy: ${config.repositoryUrl}/blob/main/SECURITY.md\n`,
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
      ...(deps.monitors ? { monitors: deps.monitors } : {}),
    }),
  );

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
