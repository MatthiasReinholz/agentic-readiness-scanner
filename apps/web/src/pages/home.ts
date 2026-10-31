import { catalog } from '@agentic-readiness/catalog';
import { escapeHtml } from '@agentic-readiness/core';

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
        `<div class="tile"><h3><span class="pill pill-accent">${escapeHtml(group.id)}</span>${escapeHtml(group.title)}</h3><p>${escapeHtml(group.description)}</p></div>`,
    )
    .join('');
  const body = `
<section class="hero">
<h1>Can an AI agent find, read, trust and buy from your store?</h1>
<p class="muted" style="margin-top:12px;max-width:62ch">Scans public signals only, scores agentic ingestion and agentic commerce, and returns a report with a fix for every finding. Built WordPress-first; works on any store.</p>
${error ? `<p class="notice" role="alert"><strong>${escapeHtml(error)}</strong></p>` : ''}
<form method="post" action="/scan" class="scan-form">
<input class="field" type="url" name="url" placeholder="https://example.com" required autofocus aria-label="Store URL" autocomplete="url" inputmode="url" spellcheck="false">
<select class="field" name="profile" aria-label="Profile"><option value="">Detect profile</option>${profiles}</select>
<button type="submit" class="btn">Scan</button>
</form>
<p class="muted small" style="margin-top:12px">Up to ${config.scanBudget} requests per scan with the user agent <code>AgenticReadinessScanner</code>. A target is scanned at most once every ${Math.round(config.targetCooldownSeconds / 60)} minutes; results are kept ${config.retentionDays} days. Nothing requires credentials.</p>
</section>
<section class="section">
<h2>What gets checked</h2>
<div class="grid">${groups}</div>
</section>
<section class="section">
<h2>For agents and pipelines</h2>
<ul class="kv stack" style="--stack:6px">
<li>JSON: <code>POST /api/scan</code> with <code>{"url": "https://example.com"}</code>, or append <code>.json</code> to any report URL</li>
<li>Markdown: append <code>.md</code> to any report URL, or read <a href="/llms.txt">/llms.txt</a></li>
<li>MCP: Streamable HTTP at <code>/mcp</code>, advertised in <a href="/.well-known/mcp/server-card.json">the server card</a></li>
<li>CLI: <code>npx @agentic-readiness/cli scan https://example.com</code></li>
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
