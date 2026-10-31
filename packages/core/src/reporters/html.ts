import type { CheckResult, ScanResult } from '@agentic-readiness/catalog';

import {
  countVerdicts,
  escapeHtml,
  failedResults,
  groupResults,
  nextGateSentence,
  verdictSymbol,
} from './shared.js';

export interface HtmlReportOptions {
  /** Links shown in the footer. */
  jsonUrl?: string;
  markdownUrl?: string;
  badgeUrl?: string;
  /** Link to the companion plugin when WooCommerce was detected. */
  pluginUrl?: string;
  /** Hosted scanner name for the footer. */
  appName?: string;
}

const STYLES = `
:root{--bg:#fff;--fg:#0f172a;--muted:#475569;--line:#e2e8f0;--pass:#15803d;--warn:#b45309;--fail:#b91c1c;--skip:#64748b;--accent:#0f766e}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--fg:#e2e8f0;--muted:#94a3b8;--line:#1e293b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px}h1{font-size:1.6rem;margin:0 0 .25rem}h2{font-size:1.15rem;margin:2rem 0 .5rem;border-bottom:1px solid var(--line);padding-bottom:.25rem}
.level{font-size:1.25rem;margin:.5rem 0}.gate{color:var(--muted)}.scores{display:flex;gap:16px;flex-wrap:wrap;margin:1rem 0}
.score{flex:1 1 200px;border:1px solid var(--line);border-radius:8px;padding:12px}.score strong{font-size:2rem;display:block}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.v{font-weight:700;font-variant:small-caps;letter-spacing:.03em}.v-pass{color:var(--pass)}.v-warn{color:var(--warn)}.v-fail{color:var(--fail)}.v-skip{color:var(--skip)}
details{margin:.5rem 0}summary{cursor:pointer}pre{overflow:auto;background:rgba(127,127,127,.12);padding:8px;border-radius:6px;font-size:.85rem}
.muted{color:var(--muted);font-size:.9rem}textarea{width:100%;min-height:160px;font:.85rem/1.4 ui-monospace,monospace}footer{margin-top:3rem;color:var(--muted);font-size:.9rem}
`;

function renderRow(item: CheckResult): string {
  const skip =
    item.verdict === 'skip' && item.skip_reason
      ? ` <span class="muted">(${escapeHtml(item.skip_reason.replace(/_/g, ' '))})</span>`
      : '';
  const fix =
    item.fix && (item.verdict === 'fail' || item.verdict === 'warn')
      ? `<details><summary>Fix</summary><p>${escapeHtml(item.fix.summary)}</p>${
          item.fix.snippet ? `<pre><code>${escapeHtml(item.fix.snippet)}</code></pre>` : ''
        }<details><summary>Prompt for a coding agent</summary><pre>${escapeHtml(item.fix.agent_prompt)}</pre></details></details>`
      : '';
  const evidence = `<details><summary>Evidence</summary><pre>${escapeHtml(JSON.stringify(item.evidence, null, 2))}</pre></details>`;
  return `<tr><td class="v v-${item.verdict}">${verdictSymbol(item.verdict)}</td><td><strong>${escapeHtml(item.id)}</strong> ${escapeHtml(item.title)}${skip}<div class="muted">${escapeHtml(item.message ?? '')}</div>${fix}${evidence}</td><td>${item.weight === 'info' ? 'info' : item.weight}</td></tr>`;
}

export function renderHtml(result: ScanResult, options: HtmlReportOptions = {}): string {
  const counts = countVerdicts(result);
  const prompts = failedResults(result)
    .filter((item) => item.fix)
    .map((item) => `## ${item.id} ${item.title}\n${item.fix?.agent_prompt ?? ''}`)
    .join('\n\n');
  const groups = groupResults(result)
    .map(
      (group) =>
        `<h2>${escapeHtml(group.id)}. ${escapeHtml(group.title)} <span class="muted">(${group.dimension})</span></h2><table><thead><tr><th>Verdict</th><th>Check</th><th>Weight</th></tr></thead><tbody>${group.results.map(renderRow).join('')}</tbody></table>`,
    )
    .join('');
  const commerce =
    result.scores.commerce === null
      ? '<strong>n/a</strong>content site'
      : `<strong>${result.scores.commerce}</strong>of 100`;
  const links = [
    options.jsonUrl ? `<a href="${escapeHtml(options.jsonUrl)}">JSON</a>` : '',
    options.markdownUrl ? `<a href="${escapeHtml(options.markdownUrl)}">Markdown</a>` : '',
    options.badgeUrl ? `<a href="${escapeHtml(options.badgeUrl)}">Badge</a>` : '',
    options.pluginUrl && result.target.platform === 'woocommerce'
      ? `<a href="${escapeHtml(options.pluginUrl)}">Fix this with the WooCommerce plugin</a>`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agentic readiness: ${escapeHtml(result.target.url)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<h1>${escapeHtml(result.target.url)}</h1>
<p class="muted">Platform ${escapeHtml(result.target.platform)} · profile ${escapeHtml(result.target.profile)} · scanned ${escapeHtml(result.scanned_at)}</p>
<p class="level"><strong>Level ${result.level.value}: ${escapeHtml(result.level.name)}</strong></p>
<p class="gate">${escapeHtml(nextGateSentence(result))}</p>
<div class="scores">
<div class="score"><span class="muted">Agentic ingestion</span><strong>${result.scores.ingestion}</strong>of 100</div>
<div class="score"><span class="muted">Agentic commerce</span>${commerce}</div>
<div class="score"><span class="muted">Checks</span><strong>${counts.pass}</strong>${counts.pass} pass · ${counts.warn} warn · ${counts.fail} fail · ${counts.skip} skipped</div>
</div>
${result.scores.commerce === null ? '' : '<p class="muted">A high commerce score means the public surface is in order. It does not mean a channel approved the products or that a checkout works.</p>'}
${groups}
${prompts ? `<h2>All fix prompts</h2><p class="muted">Paste into a coding agent working on the store.</p><textarea readonly>${escapeHtml(prompts)}</textarea>` : ''}
${result.warnings.length > 0 ? `<h2>Scan warnings</h2><ul>${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}
<footer>Catalog ${escapeHtml(result.catalog_version)} · scoring ${escapeHtml(result.scoring_version)} · scanner ${escapeHtml(result.scanner_version)} · ${result.requests} requests in ${result.duration_ms} ms${links ? ` · ${links}` : ''}${options.appName ? ` · ${escapeHtml(options.appName)}` : ''}</footer>
</main>
</body>
</html>
`;
}
