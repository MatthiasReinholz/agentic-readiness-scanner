import type { ScanResult } from '@agentic-readiness/catalog';
import { escapeHtml, renderHtml, renderLegalSectionHtml } from '@agentic-readiness/core';
import { alert, icon } from '@agentic-readiness/ui';

import type { AppConfig } from '../config.js';
import { knowledgeUrlFor } from '../knowledge/pages.js';
import { hostedFooterHtml, hostedHead } from './layout.js';

/** A POST-only document: no stored ID, public URL, structured sharing metadata or monitoring. */
export function disposableReport(config: AppConfig, result: ScanResult): string {
  return renderHtml(result, {
    title: 'One-time readiness scan',
    description:
      'A one-time site scan started from the submitted URL. Results are not saved by the scanner.',
    displayUrl: result.target.input_url,
    appName: config.appName,
    homeUrl: `${config.baseUrl}/`,
    head: `<meta name="robots" content="noindex, nofollow">${hostedHead()}`,
    afterScoresHtml: `<aside class="${alert()} mt-6">${icon('info')}<div class="min-w-0 [overflow-wrap:anywhere]"><strong>One-time scan · not saved</strong><p class="mt-1 text-sm">Started from ${escapeHtml(result.target.input_url)}. This scan includes site-wide signals and sampled pages; it is not limited to this path. Results stay in this browser tab and cannot be shared or recovered after closing it; the server kept the scan's progress only until this page received it. No store profile, history or monitoring was created.</p></div></aside>`,
    footerHtml: hostedFooterHtml(config),
    // No URL to hang a /legal page on, so the legal signals close this noindex document.
    endHtml: result.legal
      ? `<section class="mt-12" id="legal-signals" aria-labelledby="legal-signals-heading"><h2 id="legal-signals-heading" class="mb-3 text-lg font-semibold tracking-tight">Legal signals</h2>${renderLegalSectionHtml(result, { knowledgeUrl: (id) => knowledgeUrlFor(config, id) })}</section>`
      : '',
  });
}
