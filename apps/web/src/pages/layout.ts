import { escapeHtml, htmlDocument, themeToggleButton } from '@agentic-readiness/core';

import type { AppConfig } from '../config.js';

export interface PageOptions {
  title: string;
  description?: string;
  head?: string;
  scripts?: string[];
}

const PAGE_CSS = `
.hero h1{max-width:18ch}
.scan-form{display:grid;gap:10px;grid-template-columns:1fr;margin-top:24px}
@media (min-width:720px){.scan-form{grid-template-columns:minmax(0,1fr) 200px auto}}
.notice{border:1px solid color-mix(in srgb,var(--fail) 40%,transparent);background:var(--fail-soft);color:var(--fg);border-radius:10px;padding:12px 14px;margin-top:16px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.tile{background:var(--bg-raised);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.tile h3{display:flex;align-items:center;gap:8px}
.tile p{margin-top:6px;color:var(--fg-muted);font-size:.93rem}
.section{margin-top:44px}.section>h2{margin-bottom:14px}
.kv li{color:var(--fg-muted)}.kv li code{color:var(--fg)}
`;

/** Wraps page markup in the shared document shell: top bar with brand and theme toggle, footer. */
export function page(config: AppConfig, options: PageOptions, body: string): string {
  const main = `<main>
<div class="topbar"><a class="brand" href="/"><span class="brand-mark">AR</span><span>${escapeHtml(config.appName)}</span></a>${themeToggleButton()}</div>
${body}
<footer class="site">Catalog and scoring are open data · <a href="${escapeHtml(config.repositoryUrl)}">Source on GitHub</a> · GPL-3.0-or-later · Not affiliated with Automattic or WooCommerce.</footer>
</main>`;
  return htmlDocument(
    {
      title: options.title,
      ...(options.description ? { description: options.description } : {}),
      head: `<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/markdown" href="/llms.txt" title="llms.txt">
<style>${PAGE_CSS}</style>
${options.head ?? ''}`,
      ...(options.scripts ? { scripts: options.scripts } : {}),
    },
    main,
  );
}
