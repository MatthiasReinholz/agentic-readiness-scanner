import { catalog } from '@agentic-readiness/catalog';
import { escapeHtml } from '@agentic-readiness/core';
import {
  alert,
  badge,
  button,
  card,
  codeInline,
  icon,
  input,
  identifier,
  nativeSelect,
  nativeSelectChevron,
  nativeSelectWrapper,
} from '@agentic-readiness/ui';

import type { AppConfig } from '../config.js';
import { groupSlug } from '../knowledge/pages.js';
import { HOME_DESCRIPTION, homeMetadata } from '../metadata.js';
import { page } from './layout.js';
import { SCAN_CONSOLE_SCRIPT, SCAN_CONSOLE_STYLE, scanConsoleMarkup } from './scan-console.js';

export function homePage(config: AppConfig, error?: string): string {
  const profiles = catalog.profiles
    .map(
      (profile) =>
        `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.title)}</option>`,
    )
    .join('');
  const groups = catalog.groups
    .map(
      (group) =>
        `<a class="${card} group block p-4 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/knowledge-base/${groupSlug(group)}"><h3 class="flex items-start gap-2 text-base font-semibold leading-6"><span class="${badge()} ${identifier}">${escapeHtml(group.id)}</span><span class="min-w-0">${escapeHtml(group.title)}</span></h3><p class="mt-1.5 text-sm text-muted-foreground">${escapeHtml(group.description)}</p><p class="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">${catalog.checks.filter((check) => check.group === group.id).length} checks explained${icon('arrow-right', 'size-4 transition-transform group-hover:translate-x-0.5')}</p></a>`,
    )
    .join('');
  const code = (text: string) => `<code class="${codeInline}">${escapeHtml(text)}</code>`;
  const hero = `
<p class="hero-eyebrow">The next customer could be an agent</p>
<h1 class="hero-headline">Is your store ready<br>for <em class="hero-highlight" data-text="AI agents?">AI agents?</em></h1>
<p class="hero-description">Scans public signals only, scores agentic ingestion and agentic commerce, and returns a report with a fix for every finding. Built WooCommerce first. Works on any store.</p>
${error ? `<div class="${alert({ variant: 'destructive' })} hero-error mt-4" role="alert">${icon('circle-alert')}<strong class="font-semibold">${escapeHtml(error)}</strong></div>` : ''}
<form method="post" action="/scan" id="scan-form" class="hero-form">
<input class="${input}" type="url" name="url" placeholder="https://example.com" required aria-label="Store URL" autocomplete="url" inputmode="url" spellcheck="false">
<div class="${nativeSelectWrapper}"><select class="${nativeSelect}" name="profile" aria-label="Profile"><option value="">Detect profile</option>${profiles}</select>${icon('chevron-down', nativeSelectChevron)}</div>
<button type="submit" class="${button({ size: 'lg' })} hero-submit">Scan my store${icon('arrow-right')}</button>
</form>
<p class="hero-trust"><span>Public signals only</span><span>No credentials needed</span><span>A fix for every finding</span></p>
<p class="hero-policy">Up to ${config.scanBudget} requests per scan with the user agent <code>AgenticReadinessScanner</code>. At most one new scan per host every ${Math.round(config.targetCooldownSeconds / 60)} minute${config.targetCooldownSeconds === 60 ? '' : 's'}, across all paths. Root URLs have public profiles and reports kept ${config.retentionDays} days. Paths and query URLs run once and are not saved: a scan that needs several steps keeps its progress on the server only until the result reaches you, an hour at most.</p>
`;
  const body = `
${scanConsoleMarkup()}
<section class="home-checks">
<div class="mb-3.5 flex flex-wrap items-baseline justify-between gap-2"><h2 class="text-lg font-semibold tracking-tight">What gets checked</h2><a class="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/knowledge-base">Knowledge base: every check explained</a></div>
<div class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">${groups}</div>
</section>
<section class="mt-10">
<h2 class="mb-3.5 text-lg font-semibold tracking-tight">For agents and pipelines</h2>
<ul class="list-disc space-y-1.5 pl-5 text-muted-foreground">
<li>JSON: ${code('POST /api/scan')} with ${code('{"url": "https://example.com"}')}. Root profiles offer ${code('/report.json')}; snapshot URLs offer ${code('.json')}. Path scans return the result directly.</li>
<li>Markdown: use ${code('/report.md')} on a root profile or ${code('.md')} on a snapshot, or read <a href="/llms.txt">/llms.txt</a></li>
<li>MCP: Streamable HTTP at ${code('/mcp')}, advertised in <a href="/.well-known/mcp/server-card.json">the server card</a></li>
<li>CLI: ${code('npx @agentic-readiness/cli scan https://example.com')}</li>
<li>Local MCP server for coding agents: ${code('npx -y @agentic-readiness/cli mcp')} over stdio</li>
<li>Library: ${code("import { scan } from '@agentic-readiness/core'")}</li>
</ul>
</section>
`;
  return page(
    config,
    {
      title: `${config.appName}: Is your store ready for AI agents?`,
      hero,
      home: true,
      description: HOME_DESCRIPTION,
      head: `${homeMetadata(config)}\n<style>${SCAN_CONSOLE_STYLE}</style>`,
      scripts: [SCAN_CONSOLE_SCRIPT],
    },
    body,
  );
}
