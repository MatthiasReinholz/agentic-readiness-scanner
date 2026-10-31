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
  const body = `
<h1>Can an AI agent find, read, trust and buy from your store?</h1>
<p class="muted">Scans public signals only, scores agentic ingestion and agentic commerce, and returns a report with a fix for every finding. Built WordPress-first; works on any store.</p>
${error ? `<p role="alert"><strong>${escapeHtml(error)}</strong></p>` : ''}
<form method="post" action="/scan">
<input type="url" name="url" placeholder="https://example.shop" required autofocus>
<select name="profile" aria-label="Profile"><option value="">Detect profile</option>${profiles}</select>
<button type="submit">Scan</button>
</form>
<p class="muted">Up to ${config.scanBudget} requests per scan with the user agent <code>AgenticReadinessScanner</code>. A target is scanned at most once every ${Math.round(config.targetCooldownSeconds / 60)} minutes; results are kept ${config.retentionDays} days. Nothing requires credentials.</p>
<h2>What gets checked</h2>
<ul>
${catalog.groups.map((group) => `<li><strong>${escapeHtml(group.id)} ${escapeHtml(group.title)}</strong> <span class="muted">(${group.dimension})</span>: ${escapeHtml(group.description)}</li>`).join('\n')}
</ul>
<h2>For agents and pipelines</h2>
<ul>
<li>JSON: <code>POST /api/scan</code> with <code>{"url": "https://example.shop"}</code>, or append <code>.json</code> to any report URL</li>
<li>Markdown: append <code>.md</code> to any report URL, or read <a href="/llms.txt">/llms.txt</a></li>
<li>MCP: Streamable HTTP at <code>/mcp</code>, advertised in <a href="/.well-known/mcp/server-card.json">the server card</a></li>
<li>CLI: <code>npx @agentic-readiness/cli scan https://example.shop</code></li>
</ul>
<footer>Catalog ${escapeHtml(catalog.version)} · <a href="${escapeHtml(config.repositoryUrl)}">Source on GitHub</a> · GPL-3.0-or-later · Not affiliated with Automattic or WooCommerce.</footer>
`;
  return page(config.appName, body);
}
