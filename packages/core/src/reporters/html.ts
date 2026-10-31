import {
  composeAgentPrompt,
  getCheck,
  type CheckResult,
  type ScanResult,
} from '@agentic-readiness/catalog';

import { scoreGroup } from '../scoring.js';
import { htmlDocument, scoreTone, themeToggleButton } from './html-theme.js';
import {
  countVerdicts,
  escapeHtml,
  failedResults,
  groupResults,
  nextGateSentence,
  verdictSymbol,
  type GroupedResults,
} from './shared.js';

export interface HtmlReportOptions {
  /** Links shown in the footer. */
  jsonUrl?: string;
  markdownUrl?: string;
  badgeUrl?: string;
  /** Canonical URL of this report, included in agent prompts. */
  reportUrl?: string;
  /** Link to the companion plugin when WooCommerce was detected. */
  pluginUrl?: string;
  /** Hosted scanner name and home link for the header and footer. */
  appName?: string;
  homeUrl?: string;
  /** Trusted HTML the host app wants between the scores and the sections (e.g. a signup). */
  afterScoresHtml?: string;
  /** Trusted HTML appended at the end of the body, and extra inline scripts. */
  endHtml?: string;
  scripts?: string[];
}

const REPORT_CSS = `
.report-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px 24px}
.report-head .target{min-width:0;word-break:break-all}
.level-card{display:grid;gap:20px;grid-template-columns:1fr}
@media (min-width:720px){.level-card{grid-template-columns:auto 1fr;align-items:center}}
.level-badge{display:inline-grid;place-items:center;width:88px;height:88px;border-radius:22px;background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);color:var(--accent-strong);font-weight:800;font-size:2.2rem;line-height:1}
.level-badge small{font-size:.65rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--fg-muted)}
.scores{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:16px}
.score{background:var(--bg-raised);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.score .label{font-size:.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-muted)}
.score .value{display:flex;align-items:baseline;gap:6px;margin-top:6px;font-size:2rem;font-weight:800;line-height:1.1}
.score .value small{font-size:.9rem;font-weight:600;color:var(--fg-faint)}
.score .meter{height:6px;border-radius:999px;background:var(--bg-sunken);margin-top:12px;overflow:hidden}
.score .meter i{display:block;height:100%;border-radius:999px;background:currentColor}
.counts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px;margin-top:12px}.counts span.n{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-variant-numeric:tabular-nums}
.section-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:40px 0 12px}
details.group{background:var(--bg-raised);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}
details.group+details.group{margin-top:12px}
details.group>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;padding:16px 18px;border-radius:14px}
details.group>summary::-webkit-details-marker{display:none}
details.group>summary:hover{background:var(--accent-soft)}
details.group[open]>summary{border-bottom:1px solid var(--line);border-radius:14px 14px 0 0}
.chev{width:22px;height:22px;display:grid;place-items:center;color:var(--fg-faint);transition:transform .15s}
details.group[open] .chev{transform:rotate(90deg)}
.group-title{min-width:0}.group-title h2{font-size:1.05rem}.group-title .meta{display:flex;flex-wrap:wrap;gap:6px 10px;margin-top:4px;font-size:.85rem;color:var(--fg-muted)}
.group-score{text-align:right;min-width:64px}.group-score b{display:block;font-size:1.4rem;font-weight:800;line-height:1}.group-score span{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-faint)}
.checks{margin:0;padding:6px 0;list-style:none}
.check{display:grid;grid-template-columns:auto 1fr auto;gap:14px;padding:14px 18px;align-items:start}
.check+.check{border-top:1px solid var(--line)}
.check .title{font-weight:650}.check .title code{margin-right:6px;font-weight:600}
.check .msg{margin-top:4px;color:var(--fg-muted);font-size:.93rem}
.check .weight{font-size:.78rem;color:var(--fg-faint);white-space:nowrap;padding-top:4px}
.check details{margin-top:8px}.check details>summary{cursor:pointer;color:var(--accent);font-size:.9rem;font-weight:600;list-style:none;display:inline-flex;align-items:center;gap:6px}.check details>summary::-webkit-details-marker{display:none}.check details>summary::before{content:'';width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s}.check details[open]>summary::before{transform:rotate(45deg)}
.check details>summary:hover{text-decoration:underline}.check details>*+*{margin-top:10px}
.check details p{color:var(--fg);font-size:.95rem}
.fix-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
textarea.prompt{width:100%;min-height:200px;resize:vertical;font:.84rem/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:12px 14px;border-radius:10px;border:1px solid var(--line-strong);background:var(--bg-sunken);color:var(--fg)}
.callout{border-left:3px solid var(--accent);background:var(--accent-soft);padding:12px 16px;border-radius:0 10px 10px 0;color:var(--fg-muted);font-size:.95rem}
.warnings li{color:var(--fg-muted)}
@media (max-width:560px){.check{grid-template-columns:auto 1fr}.check .weight{grid-column:2}details.group>summary{grid-template-columns:auto 1fr}.group-score{grid-column:2;text-align:left;display:flex;gap:8px;align-items:baseline}}
`;

const EXPAND_SCRIPT = `(function(){var b=document.getElementById('expand-all');if(!b)return;var g=function(){return Array.prototype.slice.call(document.querySelectorAll('details.group'))};var u=function(){var all=g().every(function(d){return d.open});b.textContent=all?'Collapse all':'Expand all';b.setAttribute('aria-expanded',all?'true':'false')};b.addEventListener('click',function(){var all=g().every(function(d){return d.open});g().forEach(function(d){d.open=!all});u()});g().forEach(function(d){d.addEventListener('toggle',u)});u();var h=location.hash&&document.querySelector(location.hash);if(h){var p=h.closest('details.group');if(p)p.open=true}})();`;

const COPY_SCRIPT = `(function(){document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){var t=document.getElementById(b.getAttribute('data-copy'));if(!t||!navigator.clipboard)return;navigator.clipboard.writeText(t.value||t.textContent||'').then(function(){var o=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=o},1500)})})})})();`;

function chevron(): string {
  return `<span class="chev" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg></span>`;
}

function verdictPill(verdict: CheckResult['verdict']): string {
  return `<span class="pill pill-${verdict}">${verdictSymbol(verdict)}</span>`;
}

function scoreCard(label: string, score: number | null, note: string): string {
  const tone = scoreTone(score);
  const value =
    score === null
      ? `<span class="value tone-none">n/a</span>`
      : `<span class="value ${tone}">${score}<small>/ 100</small></span>`;
  const meter =
    score === null
      ? ''
      : `<div class="meter ${tone}" aria-hidden="true"><i style="width:${score}%"></i></div>`;
  return `<div class="score"><div class="label">${escapeHtml(label)}</div>${value}${meter}<div class="muted small" style="margin-top:8px">${escapeHtml(note)}</div></div>`;
}

function promptFor(result: ScanResult, item: CheckResult, reportUrl?: string): string | null {
  const definition = getCheck(item.id);
  if (!definition || !item.fix) return null;
  return composeAgentPrompt(definition, {
    targetUrl: result.target.url,
    scannedAt: result.scanned_at,
    platform: result.target.platform,
    verdict: item.verdict,
    ...(item.message ? { message: item.message } : {}),
    ...(reportUrl ? { reportUrl } : {}),
  });
}

function renderCheck(result: ScanResult, item: CheckResult, options: HtmlReportOptions): string {
  const skip =
    item.verdict === 'skip' && item.skip_reason
      ? ` <span class="faint">· ${escapeHtml(item.skip_reason.replace(/_/g, ' '))}</span>`
      : '';
  const promptId = `prompt-${item.id.replace('.', '-')}`;
  const prompt =
    item.verdict === 'fail' || item.verdict === 'warn'
      ? promptFor(result, item, options.reportUrl)
      : null;
  const fix =
    item.fix && prompt
      ? `<details><summary>How to fix it</summary><p>${escapeHtml(item.fix.summary)}</p>${
          item.fix.snippet ? `<pre><code>${escapeHtml(item.fix.snippet)}</code></pre>` : ''
        }<div class="fix-actions"><span class="small muted">Brief for a coding agent</span><button type="button" class="btn btn-ghost btn-sm" data-copy="${promptId}">Copy brief</button></div><textarea class="prompt" id="${promptId}" readonly aria-label="Brief for a coding agent">${escapeHtml(prompt)}</textarea></details>`
      : '';
  const evidence = `<details><summary>Evidence</summary><pre><code>${escapeHtml(JSON.stringify(item.evidence, null, 2))}</code></pre></details>`;
  return `<li class="check" id="${escapeHtml(item.id)}"><div>${verdictPill(item.verdict)}</div><div><div class="title"><code>${escapeHtml(item.id)}</code>${escapeHtml(item.title)}${skip}</div>${item.message ? `<div class="msg">${escapeHtml(item.message)}</div>` : ''}${fix}${evidence}</div><div class="weight">weight ${item.weight === 'info' ? 'info' : String(item.weight)}</div></li>`;
}

function renderGroup(
  result: ScanResult,
  group: GroupedResults,
  options: HtmlReportOptions,
): string {
  const score = scoreGroup(result.results, group.id);
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const item of group.results) counts[item.verdict] += 1;
  const meta = [
    `<span>${group.dimension}</span>`,
    counts.fail ? `<span class="tone-bad">${counts.fail} fail</span>` : '',
    counts.warn ? `<span class="tone-mid">${counts.warn} warn</span>` : '',
    counts.pass ? `<span class="tone-good">${counts.pass} pass</span>` : '',
    counts.skip ? `<span class="faint">${counts.skip} skipped</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  const scoreMarkup =
    score === null
      ? `<div class="group-score"><b class="tone-none">–</b><span>not applicable</span></div>`
      : `<div class="group-score"><b class="${scoreTone(score)}">${score}</b><span>of 100</span></div>`;
  return `<details class="group" id="group-${escapeHtml(group.id)}"><summary>${chevron()}<div class="group-title"><h2>${escapeHtml(group.id)} · ${escapeHtml(group.title)}</h2><div class="meta">${meta}</div></div>${scoreMarkup}</summary><ul class="checks">${group.results.map((item) => renderCheck(result, item, options)).join('')}</ul></details>`;
}

export function renderHtml(result: ScanResult, options: HtmlReportOptions = {}): string {
  const counts = countVerdicts(result);
  const prompts = failedResults(result)
    .map((item) => promptFor(result, item, options.reportUrl))
    .filter((prompt): prompt is string => prompt !== null)
    .join('\n\n---\n\n');
  const sections = groupResults(result)
    .map((group) => renderGroup(result, group, options))
    .join('');
  const links = [
    options.jsonUrl ? `<a href="${escapeHtml(options.jsonUrl)}">JSON</a>` : '',
    options.markdownUrl ? `<a href="${escapeHtml(options.markdownUrl)}">Markdown</a>` : '',
    options.badgeUrl ? `<a href="${escapeHtml(options.badgeUrl)}">Badge</a>` : '',
    options.pluginUrl && result.target.platform === 'woocommerce'
      ? `<a href="${escapeHtml(options.pluginUrl)}">Fix this with the WooCommerce plugin</a>`
      : '',
  ].filter(Boolean);
  const appName = options.appName ?? 'Agentic Readiness Scanner';
  const brand = `<a class="brand" href="${escapeHtml(options.homeUrl ?? '/')}"><span class="brand-mark">AR</span><span>${escapeHtml(appName)}</span></a>`;
  const gate = nextGateSentence(result);
  const body = `<main>
<div class="topbar">${brand}${themeToggleButton()}</div>
<header class="report-head">
<div class="target"><p class="muted small">Agentic readiness report</p><h1>${escapeHtml(result.target.url)}</h1><p class="muted small" style="margin-top:6px">Platform ${escapeHtml(result.target.platform)} · profile ${escapeHtml(result.target.profile)} · scanned ${escapeHtml(result.scanned_at.slice(0, 16).replace('T', ' '))} UTC</p></div>
${links.length > 0 ? `<p class="small muted">${links.join(' · ')}</p>` : ''}
</header>
<section class="card level-card" style="margin-top:24px">
<div class="level-badge"><small>Level</small>${result.level.value}</div>
<div><h2>${escapeHtml(result.level.name)}</h2>${gate ? `<p class="muted" style="margin-top:6px">${escapeHtml(gate)}</p>` : ''}</div>
</section>
<section class="scores" aria-label="Scores">
${scoreCard('Agentic ingestion', result.scores.ingestion, 'Can agents find and read the site?')}
${scoreCard('Agentic commerce', result.scores.commerce, result.scores.commerce === null ? 'Not scored for this profile' : 'Can agents trust and buy?')}
<div class="score"><div class="label">Checks</div><span class="value">${counts.pass + counts.warn + counts.fail}<small>evaluated</small></span><div class="counts"><span class="n">${verdictPill('pass')}${counts.pass}</span><span class="n">${verdictPill('warn')}${counts.warn}</span><span class="n">${verdictPill('fail')}${counts.fail}</span><span class="n">${verdictPill('skip')}${counts.skip}</span></div></div>
</section>
${result.scores.commerce === null ? '' : '<p class="callout" style="margin-top:16px">A high commerce score means the public surface is in order. It does not mean a channel approved the products or that a checkout works.</p>'}
${options.afterScoresHtml ?? ''}
<div class="section-bar"><h2>Results by section</h2><button type="button" class="btn btn-ghost btn-sm" id="expand-all" aria-expanded="false">Expand all</button></div>
${sections}
${prompts ? `<section class="card" style="margin-top:32px"><div class="fix-actions" style="justify-content:space-between"><div><h2>All fix briefs</h2><p class="muted small" style="margin-top:4px">One brief per finding, ready for a coding agent working on the store.</p></div><button type="button" class="btn btn-ghost btn-sm" data-copy="all-prompts">Copy all</button></div><textarea class="prompt" id="all-prompts" readonly aria-label="All fix briefs" style="margin-top:14px;min-height:260px">${escapeHtml(prompts)}</textarea></section>` : ''}
${result.warnings.length > 0 ? `<section style="margin-top:32px"><h2>Scan warnings</h2><ul class="warnings" style="margin-top:8px">${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>` : ''}
${options.endHtml ?? ''}
<footer class="site">Catalog ${escapeHtml(result.catalog_version)} · scoring ${escapeHtml(result.scoring_version)} · scanner ${escapeHtml(result.scanner_version)} · ${result.requests} requests in ${result.duration_ms} ms${links.length > 0 ? ` · ${links.join(' · ')}` : ''}</footer>
</main>`;
  return htmlDocument(
    {
      title: `Agentic readiness: ${result.target.url}`,
      description: `Level ${result.level.value} (${result.level.name}); ingestion ${result.scores.ingestion}, commerce ${result.scores.commerce ?? 'n/a'}.`,
      head: `<style>${REPORT_CSS}</style>`,
      scripts: [EXPAND_SCRIPT, COPY_SCRIPT, ...(options.scripts ?? [])],
    },
    body,
  );
}
