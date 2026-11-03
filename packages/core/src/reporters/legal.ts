/**
 * Legal signals as their own report: an HTML page, Markdown and JSON, each opening with
 * the notice that this is a technical evaluation and not legal advice. Verdicts read as
 * found, review, not found, not applicable or not checked; nothing here says compliant.
 * Hosts keep these results off their readiness exports with `withoutLegal`.
 */
import {
  catalog as defaultCatalog,
  LEGAL_NOTICE,
  type Catalog,
  type CheckDefinition,
  type CheckResult,
  type Law,
  type LegalResult,
  type Market,
  type ScanResult,
} from '@agentic-readiness/catalog';
import {
  alert,
  badge,
  card,
  codeBlock,
  codeInline,
  icon,
  identifier,
  panel,
} from '@agentic-readiness/ui';

import { htmlDocument, pageHero, siteFooter, siteHeader } from './html-theme.js';
import { escapeHtml } from './shared.js';

export type LegalStatus = 'found' | 'review' | 'not_found' | 'not_applicable' | 'not_checked';

export const LEGAL_STATUS_LABEL: Record<LegalStatus, string> = {
  found: 'Found',
  review: 'Review',
  not_found: 'Not found in the pages read',
  not_applicable: 'Not applicable',
  not_checked: 'Could not check',
};

const MARKET_LABEL: Record<Market, string> = {
  EU: 'European Union',
  UK: 'United Kingdom',
  CH: 'Switzerland',
  US: 'United States',
  CA: 'Canada',
  AU: 'Australia',
  BR: 'Brazil',
  AR: 'Argentina',
  CL: 'Chile',
  CO: 'Colombia',
  PE: 'Peru',
};

export function legalStatus(item: CheckResult): LegalStatus {
  if (item.verdict === 'pass') return 'found';
  if (item.verdict === 'warn') return 'review';
  if (item.verdict === 'fail') return 'not_found';
  return item.skip_reason === 'not_applicable' ? 'not_applicable' : 'not_checked';
}

export function legalCounts(legal: LegalResult): Record<LegalStatus, number> {
  const counts: Record<LegalStatus, number> = {
    found: 0,
    review: 0,
    not_found: 0,
    not_applicable: 0,
    not_checked: 0,
  };
  for (const item of legal.results) counts[legalStatus(item)] += 1;
  return counts;
}

/** One line: "4 found · 2 to review · 1 not found · 17 not applicable". */
export function legalCountsLine(legal: LegalResult): string {
  const counts = legalCounts(legal);
  return [
    `${String(counts.found)} found`,
    `${String(counts.review)} to review`,
    `${String(counts.not_found)} not found`,
    `${String(counts.not_applicable)} not applicable`,
    ...(counts.not_checked > 0 ? [`${String(counts.not_checked)} could not be checked`] : []),
  ].join(' · ');
}

/** The readiness result without legal signals, for exports a host serves publicly. */
export function withoutLegal(result: ScanResult): ScanResult {
  if (!result.legal) return result;
  const rest = { ...result };
  delete rest.legal;
  return rest;
}

/** Laws a check cites, limited to the store's markets when any were found. */
export function lawsFor(
  check: CheckDefinition,
  markets: readonly Market[],
  catalog: Catalog = defaultCatalog,
): Law[] {
  const laws = check.laws
    .map((id) => catalog.legal.laws.find((law) => law.id === id))
    .filter((law): law is Law => law !== undefined);
  if (markets.length === 0) return laws;
  const relevant = laws.filter((law) => markets.includes(law.market));
  return relevant.length > 0 ? relevant : laws;
}

function marketsOf(legal: LegalResult): Market[] {
  return legal.markets.map((item) => item.market);
}

function lawDate(law: Law, now: Date): string {
  if (!law.applies_from) return '';
  return Date.parse(law.applies_from) > now.getTime() ? `applies from ${law.applies_from}` : '';
}

export interface LegalReportOptions {
  catalog?: Catalog;
  appName?: string;
  homeUrl?: string;
  /** The readiness report this page belongs to. */
  reportUrl?: string;
  jsonUrl?: string;
  markdownUrl?: string;
  /** Knowledge-base article for a check id, when the host publishes one. */
  knowledgeUrl?: (checkId: string) => string | undefined;
  head?: string;
  footerHtml?: string;
  title?: string;
  /** Used for "applies from" notes; the scan time by default. */
  now?: Date;
}

/** The legal-signals block as JSON, with the notice and each law expanded. */
export function legalJson(
  result: ScanResult,
  options: Pick<LegalReportOptions, 'catalog' | 'knowledgeUrl'> = {},
) {
  const catalog = options.catalog ?? defaultCatalog;
  const legal = result.legal;
  return {
    notice: LEGAL_NOTICE,
    target: result.target.url,
    scanned_at: result.scanned_at,
    scanner_version: result.scanner_version,
    catalog_version: result.catalog_version,
    available: Boolean(legal),
    markets_source: legal?.markets_source ?? null,
    markets: legal?.markets ?? [],
    counts: legal ? legalCounts(legal) : null,
    results: (legal?.results ?? []).map((item) => {
      const check = catalog.legal.checks.find((candidate) => candidate.id === item.id);
      const article = options.knowledgeUrl?.(item.id);
      return {
        ...item,
        status: legalStatus(item),
        ...(article ? { article } : {}),
        laws: check
          ? lawsFor(
              check,
              marketsOf(legal ?? { markets: [], markets_source: 'detected', results: [] }),
              catalog,
            )
          : [],
      };
    }),
  };
}

export function renderLegalMarkdown(
  result: ScanResult,
  options: LegalReportOptions & { embedded?: boolean } = {},
): string {
  const catalog = options.catalog ?? defaultCatalog;
  const now = options.now ?? new Date(result.scanned_at);
  const heading = options.embedded ? '##' : '#';
  const sub = options.embedded ? '###' : '##';
  const lines: string[] = [
    `${heading} Legal signals for ${result.target.url}`,
    '',
    `> ${LEGAL_NOTICE}`,
    '',
  ];
  const legal = result.legal;
  if (!legal) {
    lines.push('This report was made before legal signals existed. Scan again to see them.', '');
    return lines.join('\n');
  }
  lines.push(
    `- Markets ${legal.markets_source === 'chosen' ? 'chosen' : 'detected'}: ${
      legal.markets.length > 0
        ? legal.markets
            .map((item) => `${MARKET_LABEL[item.market]} (${item.evidence.join(', ')})`)
            .join(' · ')
        : 'none detected, so only checks that apply in any market ran'
    }`,
    `- ${legalCountsLine(legal)}`,
    `- Scanned ${result.scanned_at}${options.reportUrl ? `. Readiness report: ${options.reportUrl}` : ''}`,
    '',
  );
  const markets = marketsOf(legal);
  for (const group of catalog.legal.groups) {
    const items = legal.results.filter((item) => item.group === group.id);
    if (items.length === 0) continue;
    lines.push(`${sub} ${group.id} ${group.title}`, '');
    for (const item of items) {
      const status = legalStatus(item);
      const check = catalog.legal.checks.find((candidate) => candidate.id === item.id);
      lines.push(
        `- **${item.id} ${item.title}: ${LEGAL_STATUS_LABEL[status]}.** ${item.message ?? ''}`.trimEnd(),
      );
      if (check && status !== 'not_applicable') {
        const laws = lawsFor(check, markets, catalog)
          .map(
            (law) =>
              `[${law.jurisdiction}: ${law.name}](${law.url})${lawDate(law, now) ? ` (${lawDate(law, now)})` : ''}`,
          )
          .join(' · ');
        if (laws) lines.push(`  - Laws: ${laws}`);
      }
      if (item.fix && (status === 'review' || status === 'not_found'))
        lines.push(`  - What to do: ${item.fix.summary}`);
      const article = options.knowledgeUrl?.(item.id);
      if (article) lines.push(`  - Explained: ${article}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const STATUS_BADGE: Record<LegalStatus, string> = {
  found: `<span class="${badge({ variant: 'success' })}" data-legal-status="found">${icon('circle-check')}Found</span>`,
  review: `<span class="${badge({ variant: 'warning' })}" data-legal-status="review">${icon('triangle-alert')}Review</span>`,
  not_found: `<span class="${badge({ variant: 'destructive' })}" data-legal-status="not_found">${icon('circle-alert')}Not found</span>`,
  not_applicable: `<span class="${badge({ variant: 'outline' })}" data-legal-status="not_applicable">${icon('minus')}Not applicable</span>`,
  not_checked: `<span class="${badge({ variant: 'outline' })}" data-legal-status="not_checked">${icon('minus')}Could not check</span>`,
};

const LEGAL_SUMMARY_CLASS =
  'result-summary cursor-pointer px-4 py-4 transition-colors hover:bg-accent/60 group-open/section:border-b group-open/section:border-border sm:px-5';
const LEGAL_DISCLOSURE_CLASS =
  'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md text-sm font-semibold text-primary hover:underline';

function renderLegalCheck(
  item: CheckResult,
  markets: readonly Market[],
  options: LegalReportOptions,
  now: Date,
): string {
  const catalog = options.catalog ?? defaultCatalog;
  const status = legalStatus(item);
  const check = catalog.legal.checks.find((candidate) => candidate.id === item.id);
  const laws = check && status !== 'not_applicable' ? lawsFor(check, markets, catalog) : [];
  const lawList =
    laws.length > 0
      ? `<ul class="mt-2 flex flex-wrap gap-1.5" aria-label="Laws">${laws
          .map(
            (law) =>
              `<li><a class="${badge({ variant: 'surface' })} hover:border-primary hover:text-primary" href="${escapeHtml(law.url)}" rel="nofollow noopener" title="${escapeHtml(`${law.instrument}. ${law.note}`)}"><span class="font-mono">${escapeHtml(law.jurisdiction)}</span>${escapeHtml(law.name)}${lawDate(law, now) ? ` · ${escapeHtml(lawDate(law, now))}` : ''}</a></li>`,
          )
          .join('')}</ul>`
      : '';
  const fix =
    item.fix && (status === 'review' || status === 'not_found')
      ? `<details class="group/fix mt-2"><summary class="${LEGAL_DISCLOSURE_CLASS}">${icon('chevron-right', 'size-3.5 transition-transform group-open/fix:rotate-90')}What to do</summary><div class="mt-2.5 space-y-2.5"><p class="text-base leading-7">${escapeHtml(item.fix.summary)}</p>${
          item.fix.snippet
            ? `<pre class="${codeBlock}" tabindex="0" aria-label="Example"><code>${escapeHtml(item.fix.snippet)}</code></pre>`
            : ''
        }</div></details>`
      : '';
  const article = options.knowledgeUrl?.(item.id);
  const explained = article
    ? `<a class="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline" href="${escapeHtml(article)}">How this check works${icon('arrow-right', 'size-3.5')}</a>`
    : '';
  const evidence =
    status === 'not_applicable'
      ? ''
      : `<details class="group/fix mt-1"><summary class="${LEGAL_DISCLOSURE_CLASS}">${icon('chevron-right', 'size-3.5 transition-transform group-open/fix:rotate-90')}Evidence</summary><pre class="${codeBlock} mt-2.5" tabindex="0" aria-label="Check evidence"><code>${escapeHtml(JSON.stringify(item.evidence, null, 2))}</code></pre></details>`;
  return `<li class="result-row px-4 py-4 sm:px-5" id="${escapeHtml(item.id)}"><div class="result-verdict legal-verdict">${STATUS_BADGE[status]}</div><div class="min-w-0"><div class="font-semibold"><code class="${codeInline} ${identifier} mr-1.5">${escapeHtml(item.id)}</code>${escapeHtml(item.title)}</div>${item.message ? `<div class="mt-1 text-sm leading-6 text-muted-foreground">${escapeHtml(item.message)}</div>` : ''}${lawList}${fix}${explained}${evidence}</div></li>`;
}

/** The legal sections and notice, without the document shell (for embedding). */
export function renderLegalSectionHtml(
  result: ScanResult,
  options: LegalReportOptions = {},
): string {
  const catalog = options.catalog ?? defaultCatalog;
  const now = options.now ?? new Date(result.scanned_at);
  const notice = `<div class="${alert({ variant: 'info' })}" role="note" id="legal-notice">${icon('info')}<span>${escapeHtml(LEGAL_NOTICE)}</span></div>`;
  const legal = result.legal;
  if (!legal) {
    return `${notice}<section class="${panel} mt-4"><h2 class="text-lg font-semibold tracking-tight">Not available for this report</h2><p class="mt-1.5 text-muted-foreground">This report was made before legal signals existed. Scan the store again to see them.</p></section>`;
  }
  const markets = marketsOf(legal);
  const marketList =
    legal.markets.length > 0
      ? `<ul class="mt-3 flex flex-wrap gap-2">${legal.markets
          .map(
            (item) =>
              `<li class="${card} px-3 py-2 text-sm"><span class="font-semibold">${escapeHtml(MARKET_LABEL[item.market])}</span><span class="block text-xs leading-5 text-muted-foreground">${escapeHtml(item.evidence.join(' · '))}</span></li>`,
          )
          .join('')}</ul>`
      : `<p class="mt-2 text-sm text-muted-foreground">No market was detected, so only the checks that apply in any market ran. A scan can name its markets (CLI <code class="${codeInline}">--markets eu,uk</code>, API and MCP <code class="${codeInline}">markets</code>).</p>`;
  const counts = legalCounts(legal);
  const summary = `<section class="${panel} mt-4" aria-label="Markets and counts"><div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2"><h2 class="text-base font-semibold tracking-tight">Markets ${legal.markets_source === 'chosen' ? 'chosen for this scan' : 'this store appears to sell to'}</h2><p class="flex flex-wrap gap-2">${STATUS_BADGE.found}<span class="text-sm font-bold tabular-nums">${String(counts.found)}</span>${STATUS_BADGE.review}<span class="text-sm font-bold tabular-nums">${String(counts.review)}</span>${STATUS_BADGE.not_found}<span class="text-sm font-bold tabular-nums">${String(counts.not_found)}</span></p></div>${marketList}<p class="mt-3 text-sm text-muted-foreground">${escapeHtml(legalCountsLine(legal))}.</p></section>`;
  const groups = catalog.legal.groups
    .map((group) => {
      const items = legal.results.filter((item) => item.group === group.id);
      if (items.length === 0) return '';
      const applicable = items.filter((item) => legalStatus(item) !== 'not_applicable');
      const meta =
        applicable.length === 0
          ? 'Nothing applied to the markets detected'
          : `${String(applicable.length)} of ${String(items.length)} applied`;
      return `<details class="result-section group/section ${card} overflow-hidden" data-group="${escapeHtml(group.id)}" id="group-${escapeHtml(group.id)}"${applicable.length > 0 ? ' open' : ''}><summary class="${LEGAL_SUMMARY_CLASS}"><span class="grid size-5 place-items-center text-muted-foreground transition-transform group-open/section:rotate-90">${icon('chevron-right', 'size-4')}</span><div class="min-w-0"><h2 class="flex flex-wrap items-center gap-2 text-base font-semibold leading-6 tracking-tight"><span class="min-w-0"><span class="${identifier}">${escapeHtml(group.id)}</span> · ${escapeHtml(group.title)}</span></h2><div class="mt-1 text-sm text-muted-foreground">${escapeHtml(meta)}</div></div></summary><ul class="divide-y divide-border py-1">${items.map((item) => renderLegalCheck(item, markets, options, now)).join('')}</ul></details>`;
    })
    .join('');
  return `${notice}${summary}<div class="mt-6 space-y-3">${groups}</div>`;
}

/** The legal-signals page, a document of its own beside the readiness report. */
export function renderLegalHtml(result: ScanResult, options: LegalReportOptions = {}): string {
  const appName = options.appName ?? 'Agentic Readiness Scanner';
  const host = new URL(result.target.url).hostname;
  const links = [
    options.reportUrl
      ? `<a class="underline underline-offset-4" href="${escapeHtml(options.reportUrl)}">Readiness report</a>`
      : '',
    options.jsonUrl
      ? `<a class="underline underline-offset-4" href="${escapeHtml(options.jsonUrl)}" rel="nofollow">JSON</a>`
      : '',
    options.markdownUrl
      ? `<a class="underline underline-offset-4" href="${escapeHtml(options.markdownUrl)}" rel="nofollow">Markdown</a>`
      : '',
  ].filter(Boolean);
  const hero = `<div class="hero-summary"><div class="min-w-0"><p class="hero-eyebrow">Legal signals · technical evaluation</p><h1 class="hero-title">${escapeHtml(host)}</h1><p class="hero-meta">Scanned ${escapeHtml(result.scanned_at.slice(0, 16).replace('T', ' '))} UTC · not legal advice</p></div>${links.length > 0 ? `<p class="hero-meta">${links.join(' · ')}</p>` : ''}</div>`;
  const body = `${renderLegalSectionHtml(result, options)}
${siteFooter(`Legal signals are reported, never scored. Catalog ${escapeHtml(result.catalog_version)} · scanner ${escapeHtml(result.scanner_version)}${options.footerHtml ? `<br>${options.footerHtml}` : ''}`)}`;
  return htmlDocument(
    {
      title: options.title ?? `Legal signals for ${host}`,
      headerHtml: siteHeader(appName, options.homeUrl),
      heroHtml: pageHero(hero),
      description: `Technical evaluation of public legal disclosures on ${host}. Not legal advice.`,
      head: `<meta name="robots" content="noindex, nofollow, noarchive">${options.head ?? ''}`,
    },
    body,
  );
}
