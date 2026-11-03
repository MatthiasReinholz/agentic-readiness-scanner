import { HtmlDocument } from '@agentic-readiness/core';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { MemoryMailer } from './monitoring/mailer.js';
import { MemoryMonitorStore } from './monitoring/memory.js';
import { MemoryResultStore } from './store/memory.js';

function app(env: Record<string, string> = {}) {
  const config = configFromEnv({ APP_BASE_URL: 'https://scanner.example', ...env });
  return createApp({
    config,
    store: new MemoryResultStore(),
    monitors: new MemoryMonitorStore(),
    mailer: new MemoryMailer(),
  });
}

describe('data processing page', () => {
  it('opens with the short version, then the details, with the configured numbers', async () => {
    const response = await app().request('/data-processing');
    expect(response.status).toBe(200);
    const html = await response.text();
    const short = html.indexOf('id="short-version"');
    const details = html.indexOf('id="what-a-scan-fetches"');
    expect(short).toBeGreaterThan(-1);
    expect(details).toBeGreaterThan(short);
    expect(html).toContain('At most 60 requests per scan');
    expect(html).toContain('one new scan per site every minute');
    expect(html).toContain('kept 30 days');
    expect(html).toContain('No cookies, no tracking');
    expect(html).toContain('ars-theme');
    expect(html).toContain('href="/knowledge-base/guides/crawler-blocks-and-browser-scans"');
    expect(new HtmlDocument(html).anchors()).toContainEqual(
      expect.objectContaining({ href: '/data-processing', inFooter: true }),
    );
  });

  it('follows the configuration', async () => {
    const html = await (
      await app({
        SCAN_BUDGET: '25',
        RETENTION_DAYS: '14',
        TARGET_COOLDOWN_SECONDS: '300',
      }).request('/data-processing')
    ).text();
    expect(html).toContain('At most 25 requests per scan');
    expect(html).toContain('every 5 minutes');
    expect(html).toContain('kept 14 days');
  });

  it('describes monitoring only when it is switched on, naming the mail provider', async () => {
    const off = await (await app().request('/data-processing')).text();
    expect(off).not.toContain('Monitoring emails');
    expect(off).toContain('No personal data about you');
    const on = await (
      await app({ MAIL_PROVIDER: 'brevo', MAIL_API_KEY: 'key' }).request('/data-processing')
    ).text();
    expect(on).toContain('Monitoring emails');
    expect(on).toContain('sent through Brevo');
    expect(on).toContain('Your email only if you ask for it');
  });

  it('is Markdown too, redirects /privacy and is listed for crawlers and agents', async () => {
    const instance = app();
    const md = await instance.request('/data-processing.md');
    expect(md.headers.get('content-type')).toContain('text/markdown');
    const text = await md.text();
    expect(text.startsWith('# Data processing and privacy')).toBe(true);
    expect(text).toContain('https://scanner.example/knowledge-base/guides/');
    const privacy = await instance.request('/privacy');
    expect(privacy.status).toBe(301);
    expect(privacy.headers.get('location')).toBe('/data-processing');
    expect(await (await instance.request('/sitemap.xml')).text()).toContain(
      'https://scanner.example/data-processing</loc>',
    );
    expect(await (await instance.request('/llms.txt')).text()).toContain('/data-processing.md');
  });
});
