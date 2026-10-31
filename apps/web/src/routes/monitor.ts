import { Hono } from 'hono';

import type { AppConfig } from '../config.js';
import { SCAN_ID } from '../ids.js';
import type { MonitoringService } from '../monitoring/service.js';
import { normalizeEmail } from '../monitoring/tokens.js';
import { monitorPage } from '../pages/monitor.js';
import type { ResultStore } from '../store/types.js';

export interface MonitorRouteDependencies {
  config: AppConfig;
  service: MonitoringService;
  scans: ResultStore;
}

/** Monitor ids are minted like scan ids, so one pattern validates both. */
const ID = SCAN_ID;
const TOKEN = /^[0-9a-f]{48}$/;

/** /monitor: signup (POST), confirm and unsubscribe links (GET). */
export function createMonitorRoutes(deps: MonitorRouteDependencies): Hono {
  const { config, service, scans } = deps;
  const app = new Hono();

  app.post('/', async (c) => {
    const form = await c.req.parseBody();
    const scanId = typeof form.scan_id === 'string' ? form.scan_id : '';
    const email = typeof form.email === 'string' ? normalizeEmail(form.email) : null;
    const scan = ID.test(scanId) ? await scans.get(scanId) : null;
    if (!scan) return c.html(monitorPage(config, 'invalid'), 404);
    const reportUrl = `${config.baseUrl}/r/${scan.id}`;
    if (!email) {
      return c.html(monitorPage(config, 'invalid', { host: scan.host, reportUrl }), 400);
    }
    // Every outcome shows the same page so an address cannot be probed for its status.
    await service.subscribe(email, scan);
    return c.html(monitorPage(config, 'check_inbox', { host: scan.host, reportUrl }));
  });

  app.get('/confirm/:id/:token', async (c) => {
    const { id, token } = c.req.param();
    if (!ID.test(id) || !TOKEN.test(token)) return c.html(monitorPage(config, 'invalid'), 404);
    const monitor = await service.confirm(id, token);
    if (!monitor) return c.html(monitorPage(config, 'invalid'), 404);
    const latest = await scans.latestForHost(monitor.host);
    return c.html(
      monitorPage(config, 'confirmed', {
        host: monitor.host,
        ...(latest ? { reportUrl: `${config.baseUrl}/r/${latest.id}` } : {}),
      }),
    );
  });

  app.get('/unsubscribe/:id/:token', async (c) => {
    const { id, token } = c.req.param();
    if (!ID.test(id) || !TOKEN.test(token)) return c.html(monitorPage(config, 'invalid'), 404);
    const monitor = await service.unsubscribe(id, token);
    if (!monitor) return c.html(monitorPage(config, 'invalid'), 404);
    return c.html(monitorPage(config, 'unsubscribed', { host: monitor.host }));
  });

  return app;
}
