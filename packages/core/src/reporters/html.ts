import {
  composeAgentPrompt,
  getCheck,
  type CheckResult,
  type ScanResult,
} from '@agentic-readiness/catalog';
import {
  alert,
  badge,
  button,
  card,
  codeBlock,
  codeInline,
  icon,
  textarea,
} from '@agentic-readiness/ui';

import { scoreGroup } from '../scoring.js';
import { htmlDocument, scoreTone, siteFooter, siteHeader } from './html-theme.js';
import {
  countSkips,
  groupIsOptional,
  prioritize,
  TIER_LABEL,
  type Priorities,
  type Priority,
  type Tier,
} from './priorities.js';
import {
  countVerdicts,
  escapeHtml,
  failedResults,
  groupResults,
  nextGateSentence,
  type GroupedResults,
} from './shared.js';

export interface HtmlReportOptions {
  /** Links shown in the footer. */
  jsonUrl?: string;
  markdownUrl?: string;
  badgeUrl?: string;
  /** Canonical URL of this report, included in agent prompts. */
  reportUrl?: string;
  /** Hosted scanner name and home link for the header and footer. */
  appName?: string;
  homeUrl?: string;
  /** Extra <head> markup from the host app, e.g. icon links and @font-face rules. */
  head?: string;
  /** Trusted HTML appended to the footer, e.g. source link and disclaimer. */
  footerHtml?: string;
  /** Trusted HTML the host app wants between the scores and the sections (e.g. a signup). */
  afterScoresHtml?: string;
  /** Trusted HTML appended at the end of the body, and extra inline scripts. */
  endHtml?: string;
  scripts?: string[];
}

/** Toggles every section at once; the button label follows the sections' state. */
const EXPAND_SCRIPT = `(function(){var b=document.getElementById('expand-all');if(!b)return;var g=function(){return Array.prototype.slice.call(document.querySelectorAll('details[data-group]'))};var u=function(){var all=g().every(function(d){return d.open});b.textContent=all?'Collapse all':'Expand all';b.setAttribute('aria-expanded',all?'true':'false')};b.addEventListener('click',function(){var all=g().every(function(d){return d.open});g().forEach(function(d){d.open=!all});u()});g().forEach(function(d){d.addEventListener('toggle',u)});u();var h=location.hash&&document.querySelector(location.hash);if(h){var p=h.closest('details[data-group]');if(p)p.open=true}})();`;

/** Copies the element named by data-copy and confirms on the button's label span. */
const COPY_SCRIPT = `(function(){document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){var t=document.getElementById(b.getAttribute('data-copy'));if(!t||!navigator.clipboard)return;var l=b.querySelector('[data-copy-label]')||b;navigator.clipboard.writeText(t.value||t.textContent||'').then(function(){var o=l.textContent;l.textContent='Copied';setTimeout(function(){l.textContent=o},1500)})})})})();`;

const VERDICT_BADGE: Record<CheckResult['verdict'], string> = {
  pass: `<span class="${badge({ variant: 'success' })} uppercase tracking-wide" data-verdict="pass">${icon('circle-check')}pass</span>`,
  warn: `<span class="${badge({ variant: 'warning' })} uppercase tracking-wide" data-verdict="warn">${icon('triangle-alert')}warn</span>`,
  fail: `<span class="${badge({ variant: 'destructive' })} uppercase tracking-wide" data-verdict="fail">${icon('circle-alert')}fail</span>`,
  skip: `<span class="${badge({ variant: 'outline' })} uppercase tracking-wide" data-verdict="skip">${icon('minus')}skip</span>`,
};

const SECTION_SUMMARY_CLASS =
  'grid cursor-pointer grid-cols-[auto_1fr] items-center gap-3.5 px-4 py-4 transition-colors hover:bg-accent/60 group-open/section:border-b group-open/section:border-border sm:grid-cols-[auto_1fr_auto] sm:px-5';
const DISCLOSURE_SUMMARY_CLASS =
  'inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-primary hover:underline';

function disclosureChevron(scope: 'section' | 'fix'): string {
  return scope === 'section'
    ? `<span class="grid size-5 place-items-center text-muted-foreground transition-transform group-open/section:rotate-90">${icon('chevron-right', 'size-4')}</span>`
    : icon('chevron-right', 'size-3.5 transition-transform group-open/fix:rotate-90');
}

function copyButton(targetId: string, labelText: string): string {
  return `<button type="button" class="${button({ variant: 'outline', size: 'sm' })}" data-copy="${targetId}">${icon('copy')}<span data-copy-label>${labelText}</span></button>`;
}

function scoreCard(label: string, score: number | null, note: string): string {
  const tone = scoreTone(score);
  const value =
    score === null
      ? `<div class="mt-1.5 text-[2rem] font-extrabold leading-none text-muted-foreground">n/a</div>`
      : `<div class="mt-1.5 flex items-baseline gap-1.5 text-[2rem] font-extrabold leading-none ${tone}">${score}<small class="text-sm font-semibold text-muted-foreground">/ 100</small></div>`;
  const meter =
    score === null
      ? ''
      : `<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted ${tone}" aria-hidden="true"><i class="block h-full rounded-full bg-current" style="width:${score}%"></i></div>`;
  return `<div class="${card} p-5"><div class="text-xs font-bold uppercase tracking-wider text-muted-foreground">${escapeHtml(label)}</div>${value}${meter}<div class="mt-2 text-sm text-muted-foreground">${escapeHtml(note)}</div></div>`;
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
      ? ` <span class="font-normal text-muted-foreground">· ${escapeHtml(item.skip_reason.replace(/_/g, ' '))}</span>`
      : '';
  const promptId = `prompt-${item.id.replace('.', '-')}`;
  const prompt =
    item.verdict === 'fail' || item.verdict === 'warn'
      ? promptFor(result, item, options.reportUrl)
      : null;
  const fix =
    item.fix && prompt
      ? `<details class="group/fix mt-2"><summary class="${DISCLOSURE_SUMMARY_CLASS}">${disclosureChevron('fix')}How to fix it</summary><div class="mt-2.5 space-y-2.5"><p class="text-[0.95rem]">${escapeHtml(item.fix.summary)}</p>${
          item.fix.snippet
            ? `<pre class="${codeBlock}"><code>${escapeHtml(item.fix.snippet)}</code></pre>`
            : ''
        }<div class="flex flex-wrap items-center gap-2"><span class="text-sm text-muted-foreground">Brief for a coding agent</span>${copyButton(promptId, 'Copy brief')}</div><textarea class="${textarea}" id="${promptId}" readonly aria-label="Brief for a coding agent">${escapeHtml(prompt)}</textarea></div></details>`
      : '';
  const evidence = `<details class="group/fix mt-2"><summary class="${DISCLOSURE_SUMMARY_CLASS}">${disclosureChevron('fix')}Evidence</summary><pre class="${codeBlock} mt-2.5"><code>${escapeHtml(JSON.stringify(item.evidence, null, 2))}</code></pre></details>`;
  return `<li class="grid grid-cols-[auto_1fr] items-start gap-3.5 px-4 py-3.5 sm:grid-cols-[auto_1fr_auto] sm:px-5" id="${escapeHtml(item.id)}"><div class="pt-px">${VERDICT_BADGE[item.verdict]}</div><div class="min-w-0"><div class="font-semibold"><code class="${codeInline} mr-1.5">${escapeHtml(item.id)}</code>${escapeHtml(item.title)}${skip}</div>${item.message ? `<div class="mt-1 text-[0.93rem] text-muted-foreground">${escapeHtml(item.message)}</div>` : ''}${fix}${evidence}</div><div class="col-start-2 whitespace-nowrap text-xs text-muted-foreground sm:col-auto sm:pt-1">weight ${item.weight === 'info' ? 'info' : String(item.weight)}</div></li>`;
}

const TIER_BADGE: Record<Tier, string> = {
  blocking: `<span class="${badge({ variant: 'destructive' })}">blocking</span>`,
  expected: `<span class="${badge({ variant: 'warning' })}">expected</span>`,
  nice_to_have: `<span class="${badge({ variant: 'outline' })}">nice to have</span>`,
  informational: `<span class="${badge({ variant: 'outline' })}">informational</span>`,
};

function priorityTagsHtml(priority: Priority): string {
  const tags = [TIER_BADGE[priority.tier]];
  if (priority.unlocks !== null)
    tags.push(
      `<span class="${badge({ variant: 'default' })}">unlocks Level ${priority.unlocks}</span>`,
    );
  if (priority.mechanical)
    tags.push(`<span class="${badge({ variant: 'secondary' })}">mechanical fix</span>`);
  return tags.join('');
}

function priorityItemHtml(priority: Priority): string {
  const item = priority.result;
  const message = item.message
    ? `<div class="mt-1 text-sm text-muted-foreground">${escapeHtml(item.message)}</div>`
    : '';
  const fix = item.fix
    ? `<div class="mt-1 text-sm">${escapeHtml(item.fix.summary)} <a class="font-semibold text-primary hover:underline" href="#${escapeHtml(item.id)}">Details</a></div>`
    : '';
  return `<li class="py-3"><div class="flex flex-wrap items-center gap-1.5"><a class="font-semibold hover:underline" href="#${escapeHtml(item.id)}"><code class="${codeInline} mr-1.5">${escapeHtml(item.id)}</code>${escapeHtml(item.title)}</a>${priorityTagsHtml(priority)}</div>${message}${fix}</li>`;
}

function compactPriorityHtml(priority: Priority): string {
  const item = priority.result;
  const tags = [
    priority.unlocks !== null ? `unlocks Level ${priority.unlocks}` : '',
    priority.mechanical ? 'mechanical fix' : '',
  ].filter(Boolean);
  return `<li><a class="hover:underline" href="#${escapeHtml(item.id)}"><code class="${codeInline} mr-1">${escapeHtml(item.id)}</code>${escapeHtml(item.title)}</a>${tags.length > 0 ? ` <span class="text-muted-foreground">(${escapeHtml(tags.join(', '))})</span>` : ''}</li>`;
}

/** The "what to do" card: next-gate and blocking findings in full, the rest as compact lists. */
function renderPriorities(priorities: Priorities): string {
  const total =
    priorities.first.length +
    priorities.next.length +
    priorities.optional.length +
    priorities.informational.length;
  if (total === 0)
    return `<section class="${card} mt-8 p-6" id="priorities"><h2 class="text-lg font-semibold tracking-tight">Nothing to fix</h2><p class="mt-1.5 text-sm text-muted-foreground">Every check that applied to this site passed.</p></section>`;
  const block = (title: string, note: string, body: string): string =>
    `<div class="mt-6 first:mt-0"><h3 class="text-base font-semibold tracking-tight">${title}</h3><p class="mt-0.5 text-sm text-muted-foreground">${note}</p>${body}</div>`;
  const parts: string[] = [];
  if (priorities.first.length > 0)
    parts.push(
      block(
        'Fix first',
        'What stands between the store and the next level, then everything else that blocks agents.',
        `<ol class="mt-2 divide-y divide-border">${priorities.first.map(priorityItemHtml).join('')}</ol>`,
      ),
    );
  if (priorities.next.length > 0)
    parts.push(
      block(
        'Fix next',
        'Expected by the channels and crawlers behind AI answers; each costs points.',
        `<ol class="mt-2 divide-y divide-border">${priorities.next.map(priorityItemHtml).join('')}</ol>`,
      ),
    );
  if (priorities.optional.length > 0)
    parts.push(
      block(
        'Nice to have',
        'Conventions and optional protocols with no documented consumer that requires them. Low weight; adopt them when they fit.',
        `<ul class="mt-2 list-disc space-y-1 pl-5 text-sm">${priorities.optional.map(compactPriorityHtml).join('')}</ul>`,
      ),
    );
  if (priorities.informational.length > 0)
    parts.push(
      block(
        'Informational',
        'Reported, never scored.',
        `<ul class="mt-2 list-disc space-y-1 pl-5 text-sm">${priorities.informational.map(compactPriorityHtml).join('')}</ul>`,
      ),
    );
  return `<section class="${card} mt-8 p-6" id="priorities"><h2 class="text-lg font-semibold tracking-tight">What to do</h2>${parts.join('')}</section>`;
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
    `<span>${escapeHtml(group.dimension)}</span>`,
    counts.fail ? `<span class="text-destructive">${counts.fail} fail</span>` : '',
    counts.warn ? `<span class="text-warning">${counts.warn} warn</span>` : '',
    counts.pass ? `<span class="text-success">${counts.pass} pass</span>` : '',
    counts.skip ? `<span>${counts.skip} skipped</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  // A group made only of nice-to-have and informational checks is scored like any other,
  // but a zero there is not a red flag: nothing in it is required by any consumer.
  const optional = groupIsOptional(group.results);
  const tone = optional ? 'text-muted-foreground' : score === null ? '' : scoreTone(score);
  const scoreMarkup =
    score === null
      ? `<div class="col-start-2 flex items-baseline gap-2 sm:col-auto sm:block sm:min-w-16 sm:text-right" data-group-score><b class="block text-2xl font-extrabold leading-none text-muted-foreground">–</b><span class="text-[0.72rem] uppercase tracking-wider text-muted-foreground">not applicable</span></div>`
      : `<div class="col-start-2 flex items-baseline gap-2 sm:col-auto sm:block sm:min-w-16 sm:text-right" data-group-score><b class="block text-2xl font-extrabold leading-none ${tone}">${score}</b><span class="text-[0.72rem] uppercase tracking-wider text-muted-foreground">of 100</span></div>`;
  const optionalTag = optional
    ? `<span class="${badge({ variant: 'outline' })}" data-group-optional>nice to have</span>`
    : '';
  return `<details class="group/section ${card} overflow-hidden" data-group="${escapeHtml(group.id)}" id="group-${escapeHtml(group.id)}"><summary class="${SECTION_SUMMARY_CLASS}">${disclosureChevron('section')}<div class="min-w-0"><h2 class="flex flex-wrap items-center gap-2 text-base font-semibold tracking-tight">${escapeHtml(group.id)} · ${escapeHtml(group.title)}${optionalTag}</h2><div class="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-sm text-muted-foreground">${meta}</div></div>${scoreMarkup}</summary><ul class="divide-y divide-border py-1">${group.results.map((item) => renderCheck(result, item, options)).join('')}</ul></details>`;
}

export function renderHtml(result: ScanResult, options: HtmlReportOptions = {}): string {
  const counts = countVerdicts(result);
  const skips = countSkips(result);
  const priorities = prioritize(result);
  const openCounts = (['blocking', 'expected', 'nice_to_have', 'informational'] as const)
    .filter((tier) => priorities.counts[tier] > 0)
    .map((tier) => `${priorities.counts[tier]} ${TIER_LABEL[tier]}`);
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
  ].filter(Boolean);
  const appName = options.appName ?? 'Agentic Readiness Scanner';
  const gate = nextGateSentence(result);
  const body = `${siteHeader(appName, options.homeUrl)}
<header class="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
<div class="min-w-0"><p class="text-sm text-muted-foreground">Agentic readiness report</p><h1 class="mt-1 break-all text-2xl font-bold tracking-tight sm:text-3xl">${escapeHtml(result.target.url)}</h1><p class="mt-1.5 text-sm text-muted-foreground">Platform ${escapeHtml(result.target.platform)} · profile ${escapeHtml(result.target.profile)} · scanned ${escapeHtml(result.scanned_at.slice(0, 16).replace('T', ' '))} UTC</p></div>
${links.length > 0 ? `<p class="text-sm text-muted-foreground">${links.join(' · ')}</p>` : ''}
</header>
<section class="${card} mt-6 grid gap-5 p-6 sm:grid-cols-[auto_1fr] sm:items-center">
<div class="inline-grid size-[88px] place-items-center rounded-2xl border border-primary/40 bg-primary/10 text-4xl font-extrabold leading-none text-primary"><small class="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">Level</small>${result.level.value}</div>
<div><h2 class="text-lg font-semibold tracking-tight">${escapeHtml(result.level.name)}</h2>${gate ? `<p class="mt-1.5 text-muted-foreground">${escapeHtml(gate)}</p>` : ''}${openCounts.length > 0 ? `<p class="mt-1.5 text-sm text-muted-foreground">Open findings: ${escapeHtml(openCounts.join(' · '))}. <a class="font-semibold text-primary hover:underline" href="#priorities">What to do</a></p>` : ''}</div>
</section>
<section class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Scores">
${scoreCard('Agentic ingestion', result.scores.ingestion, 'Can agents find and read the site?')}
${scoreCard('Agentic commerce', result.scores.commerce, result.scores.commerce === null ? 'Not scored for this profile' : 'Can agents trust and buy?')}
<div class="${card} p-5"><div class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Checks</div><div class="mt-1.5 flex items-baseline gap-1.5 text-[2rem] font-extrabold leading-none">${counts.pass + counts.warn + counts.fail}<small class="text-sm font-semibold text-muted-foreground">evaluated</small></div><div class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2"><span class="inline-flex items-center gap-2 font-bold tabular-nums">${VERDICT_BADGE.pass}${counts.pass}</span><span class="inline-flex items-center gap-2 font-bold tabular-nums">${VERDICT_BADGE.warn}${counts.warn}</span><span class="inline-flex items-center gap-2 font-bold tabular-nums">${VERDICT_BADGE.fail}${counts.fail}</span><span class="inline-flex items-center gap-2 font-bold tabular-nums">${VERDICT_BADGE.skip}${counts.skip}</span></div><div class="mt-2 text-sm text-muted-foreground">${skips.not_applicable > 0 ? `${skips.not_applicable} did not apply to this site` : ''}${skips.not_applicable > 0 && skips.unanswered > 0 ? ' · ' : ''}${skips.unanswered > 0 ? `${skips.unanswered} could not run` : ''}</div></div>
</section>
${result.scores.commerce === null ? '' : `<div class="${alert({ variant: 'info' })} mt-4" role="note">${icon('info')}<span>A high commerce score means the public surface is in order. It does not mean a channel approved the products or that a checkout works.</span></div>`}
${renderPriorities(priorities)}
${options.afterScoresHtml ?? ''}
<div class="mb-3 mt-10 flex items-center justify-between gap-4"><h2 class="text-lg font-semibold tracking-tight">Results by section</h2><button type="button" class="${button({ variant: 'outline', size: 'sm' })}" id="expand-all" aria-expanded="false">Expand all</button></div>
<div class="space-y-3">${sections}</div>
${prompts ? `<section class="${card} mt-8 p-6"><div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-lg font-semibold tracking-tight">All fix briefs</h2><p class="mt-1 text-sm text-muted-foreground">One brief per finding, ready for a coding agent working on the store.</p></div>${copyButton('all-prompts', 'Copy all')}</div><textarea class="${textarea} mt-3.5 min-h-[260px]" id="all-prompts" readonly aria-label="All fix briefs">${escapeHtml(prompts)}</textarea></section>` : ''}
${result.warnings.length > 0 ? `<section class="mt-8"><h2 class="text-lg font-semibold tracking-tight">Scan warnings</h2><ul class="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>` : ''}
${options.endHtml ?? ''}
${siteFooter(`Catalog ${escapeHtml(result.catalog_version)} · scoring ${escapeHtml(result.scoring_version)} · scanner ${escapeHtml(result.scanner_version)} · ${result.requests} requests in ${result.duration_ms} ms${links.length > 0 ? ` · ${links.join(' · ')}` : ''}${options.footerHtml ? `<br>${options.footerHtml}` : ''}`)}`;
  return htmlDocument(
    {
      title: `Agentic readiness: ${result.target.url}`,
      description: `Level ${result.level.value} (${result.level.name}); ingestion ${result.scores.ingestion}, commerce ${result.scores.commerce ?? 'n/a'}.`,
      ...(options.head ? { head: options.head } : {}),
      scripts: [EXPAND_SCRIPT, COPY_SCRIPT, ...(options.scripts ?? [])],
    },
    body,
  );
}
