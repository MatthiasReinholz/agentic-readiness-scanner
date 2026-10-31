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
  nativeSelect,
  nativeSelectChevron,
  nativeSelectWrapper,
} from '@agentic-readiness/ui';

import type { AppConfig } from '../config.js';
import { page } from './layout.js';

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
        `<div class="${card} p-5"><h3 class="flex items-center gap-2 text-base font-semibold"><span class="${badge()}">${escapeHtml(group.id)}</span>${escapeHtml(group.title)}</h3><p class="mt-1.5 text-sm text-muted-foreground">${escapeHtml(group.description)}</p></div>`,
    )
    .join('');
  const code = (text: string) => `<code class="${codeInline}">${escapeHtml(text)}</code>`;
  const body = `
<section>
<h1 class="max-w-[18ch] text-balance text-3xl font-bold tracking-tight sm:text-4xl">Can an AI agent find, read, trust and buy from your store?</h1>
<p class="mt-3 max-w-[62ch] text-muted-foreground">Scans public signals only, scores agentic ingestion and agentic commerce, and returns a report with a fix for every finding. Built WordPress-first; works on any store.</p>
${error ? `<div class="${alert({ variant: 'destructive' })} mt-4" role="alert">${icon('circle-alert')}<strong class="font-semibold">${escapeHtml(error)}</strong></div>` : ''}
<form method="post" action="/scan" class="mt-6 grid gap-2.5 md:grid-cols-[minmax(0,1fr)_200px_auto]">
<input class="${input}" type="url" name="url" placeholder="https://example.com" required autofocus aria-label="Store URL" autocomplete="url" inputmode="url" spellcheck="false">
<div class="${nativeSelectWrapper}"><select class="${nativeSelect}" name="profile" aria-label="Profile"><option value="">Detect profile</option>${profiles}</select>${icon('chevron-down', nativeSelectChevron)}</div>
<button type="submit" class="${button({ size: 'lg' })}">Scan</button>
</form>
<p class="mt-3 text-sm text-muted-foreground">Up to ${config.scanBudget} requests per scan with the user agent ${code('AgenticReadinessScanner')}. A target is scanned at most once every ${Math.round(config.targetCooldownSeconds / 60)} minutes; results are kept ${config.retentionDays} days. Nothing requires credentials.</p>
</section>
<section class="mt-11">
<h2 class="mb-3.5 text-lg font-semibold tracking-tight">What gets checked</h2>
<div class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">${groups}</div>
</section>
<section class="mt-11">
<h2 class="mb-3.5 text-lg font-semibold tracking-tight">For agents and pipelines</h2>
<ul class="list-disc space-y-1.5 pl-5 text-muted-foreground">
<li>JSON: ${code('POST /api/scan')} with ${code('{"url": "https://example.com"}')}, or append ${code('.json')} to any report URL</li>
<li>Markdown: append ${code('.md')} to any report URL, or read <a href="/llms.txt">/llms.txt</a></li>
<li>MCP: Streamable HTTP at ${code('/mcp')}, advertised in <a href="/.well-known/mcp/server-card.json">the server card</a></li>
<li>CLI: ${code('npx @agentic-readiness/cli scan https://example.com')}</li>
</ul>
</section>
`;
  return page(
    config,
    {
      title: config.appName,
      description:
        'Scan any store URL for agentic ingestion and agentic commerce readiness. Public signals only, a fix for every finding.',
    },
    body,
  );
}
