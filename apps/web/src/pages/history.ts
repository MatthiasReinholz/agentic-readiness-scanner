import { catalog } from '@agentic-readiness/catalog';
import {
  describeDiff,
  diffSnapshots,
  escapeHtml,
  scoreTone,
  type ResultDiff,
} from '@agentic-readiness/core';
import { badge, button, card, icon } from '@agentic-readiness/ui';

import type { AppConfig } from '../config.js';
import type { HistoryEntry } from '../history/types.js';
import { page } from './layout.js';

/** An entry together with what changed since the entry before it (older), when there is one. */
export interface HistoryStep {
  entry: HistoryEntry;
  previous: HistoryEntry | null;
  diff: ResultDiff | null;
  /** True when the catalog or scoring version changed between the two entries. */
  catalogChanged: boolean;
}

/** Pairs each entry (newest first) with the one before it and the comparison between them. */
export function historySteps(entries: readonly HistoryEntry[]): HistoryStep[] {
  return entries.map((entry, index) => {
    const previous = entries[index + 1] ?? null;
    return {
      entry,
      previous,
      diff: previous ? diffSnapshots(previous.snapshot, entry.snapshot) : null,
      catalogChanged: previous
        ? previous.catalogVersion !== entry.catalogVersion ||
          previous.scoringVersion !== entry.scoringVersion
        : false,
    };
  });
}

/** The JSON shape of /h/:host.json: entries newest first, each with its changes. */
export function historyJson(host: string, entries: readonly HistoryEntry[]) {
  return {
    host,
    states: historySteps(entries).map(({ entry, diff, catalogChanged }) => ({
      first_scan_id: entry.id,
      last_scan_id: entry.lastScanId,
      first_at: entry.firstAt,
      last_at: entry.lastAt,
      scans: entry.scans,
      url: entry.url,
      platform: entry.platform,
      profile: entry.profile,
      catalog_version: entry.catalogVersion,
      scoring_version: entry.scoringVersion,
      scanner_version: entry.scannerVersion,
      level: entry.snapshot.level,
      ingestion: entry.snapshot.ingestion,
      commerce: entry.snapshot.commerce,
      groups: entry.snapshot.groups ?? {},
      verdicts: entry.snapshot.verdicts,
      skips: entry.snapshot.skips ?? {},
      changes: diff
        ? { ...diff, catalog_changed: catalogChanged, lines: describeDiff(diff) }
        : null,
    })),
  };
}

function when(iso: string): string {
  return escapeHtml(iso.slice(0, 10));
}

function period(entry: HistoryEntry): string {
  const start = when(entry.firstAt);
  const end = when(entry.lastAt);
  const scans = `${entry.scans} scan${entry.scans === 1 ? '' : 's'}`;
  return start === end ? `${start} · ${scans}` : `${start} → ${end} · ${scans}`;
}

function score(value: number | null): string {
  return value === null
    ? '<span class="text-muted-foreground">n/a</span>'
    : `<b class="font-bold ${scoreTone(value)}">${value}</b>`;
}

function arrow(from: number | null, to: number | null): string {
  if (from === null || to === null || from === to) return '';
  const up = to > from;
  return `<span class="${up ? 'text-success' : 'text-destructive'} text-xs font-semibold">${up ? '▲' : '▼'} ${Math.abs(to - from)}</span>`;
}

/** Whether a report is still served for a scan that finished at `iso`. */
export function withinRetention(config: AppConfig, iso: string, now: Date): boolean {
  return now.getTime() - Date.parse(iso) < config.retentionDays * 86_400_000;
}

function changeList(step: HistoryStep): string {
  if (!step.diff) return '<span class="text-muted-foreground">First observed state</span>';
  const lines: string[] = [];
  if (step.catalogChanged && step.previous) {
    lines.push(
      `Catalog ${escapeHtml(step.previous.catalogVersion)} → ${escapeHtml(step.entry.catalogVersion)}, scoring ${escapeHtml(step.previous.scoringVersion)} → ${escapeHtml(step.entry.scoringVersion)}`,
    );
  }
  for (const line of describeDiff(step.diff)) lines.push(escapeHtml(line));
  if (lines.length === 0) return '<span class="text-muted-foreground">No change</span>';
  return `<ul class="space-y-0.5">${lines.map((line) => `<li>${line}</li>`).join('')}</ul>`;
}

/**
 * A step chart of the scores over time, drawn from the entries (oldest first). Pure SVG
 * strings, no library; the table underneath carries the same numbers for readers and
 * assistive technology, so the chart is decorative.
 */
export function trendChart(entries: readonly HistoryEntry[]): string {
  const ordered = [...entries].reverse();
  if (ordered.length < 2) return '';
  const width = 640;
  const height = 120;
  const pad = 6;
  const start = Date.parse(ordered[0]?.firstAt ?? '');
  const end = Date.parse(ordered[ordered.length - 1]?.lastAt ?? '');
  const span = Math.max(1, end - start);
  const x = (iso: string): number => pad + ((Date.parse(iso) - start) / span) * (width - 2 * pad);
  const y = (value: number): number => height - pad - (value / 100) * (height - 2 * pad);
  const path = (pick: (entry: HistoryEntry) => number | null): string => {
    const points: string[] = [];
    for (const entry of ordered) {
      const value = pick(entry);
      if (value === null) continue;
      points.push(`${x(entry.firstAt).toFixed(1)},${y(value).toFixed(1)}`);
      points.push(`${x(entry.lastAt).toFixed(1)},${y(value).toFixed(1)}`);
    }
    return points.join(' ');
  };
  const ingestion = path((entry) => entry.snapshot.ingestion);
  const commerce = path((entry) => entry.snapshot.commerce);
  return `<figure class="${card} p-4"><svg viewBox="0 0 ${width} ${height}" class="h-auto w-full" role="img" aria-label="Ingestion and commerce scores over time"><line x1="${pad}" y1="${y(50).toFixed(1)}" x2="${width - pad}" y2="${y(50).toFixed(1)}" class="stroke-border" stroke-dasharray="4 4"/><line x1="${pad}" y1="${y(80).toFixed(1)}" x2="${width - pad}" y2="${y(80).toFixed(1)}" class="stroke-border" stroke-dasharray="4 4"/>${ingestion ? `<polyline points="${ingestion}" fill="none" class="stroke-primary" stroke-width="2.5" stroke-linejoin="round"/>` : ''}${commerce ? `<polyline points="${commerce}" fill="none" class="stroke-success" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="7 4"/>` : ''}</svg><figcaption class="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground"><span><span class="mr-1.5 inline-block h-0.5 w-5 bg-primary align-middle"></span>Ingestion</span>${commerce ? '<span><span class="mr-1.5 inline-block h-0.5 w-5 bg-success align-middle"></span>Commerce</span>' : ''}<span>${when(ordered[0]?.firstAt ?? '')} → ${when(ordered[ordered.length - 1]?.lastAt ?? '')}</span></figcaption></figure>`;
}

export interface HistoryPageInput {
  host: string;
  entries: readonly HistoryEntry[];
  now: Date;
}

export function historyPage(config: AppConfig, input: HistoryPageInput): string {
  const { host, entries } = input;
  const steps = historySteps(entries);
  const latest = entries[0];
  const totalScans = entries.reduce((sum, entry) => sum + entry.scans, 0);
  const groupTitles = new Map(catalog.groups.map((group) => [group.id, group.title]));
  const rows = steps
    .map(({ entry, previous, diff, catalogChanged }) => {
      const groups = Object.entries(entry.snapshot.groups ?? {})
        .map(([id, value]) => {
          const from = previous?.snapshot.groups?.[id] ?? null;
          return `<span class="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs" title="${escapeHtml(groupTitles.get(id) ?? id)}"><span class="text-muted-foreground">${escapeHtml(id)}</span>${score(value)}${arrow(from, value)}</span>`;
        })
        .join(' ');
      const report = withinRetention(config, entry.lastAt, input.now)
        ? `<a class="text-primary hover:underline" href="/r/${escapeHtml(entry.lastScanId)}">Report</a>`
        : '<span class="text-muted-foreground" title="Full results are kept for a limited time; the state itself is kept for good">Report expired</span>';
      return `<tr class="align-top"><td class="whitespace-nowrap py-3 pr-4 text-sm">${period(entry)}<div class="mt-0.5 text-xs text-muted-foreground">catalog ${escapeHtml(entry.catalogVersion)}${catalogChanged ? ' · changed' : ''}</div></td><td class="py-3 pr-4 text-sm"><span class="${badge({ variant: 'secondary' })}">Level ${entry.snapshot.level}</span>${previous && diff?.level ? arrow(diff.level.from, diff.level.to) : ''}</td><td class="py-3 pr-4 text-sm tabular-nums">${score(entry.snapshot.ingestion)} ${arrow(previous?.snapshot.ingestion ?? null, entry.snapshot.ingestion)}</td><td class="py-3 pr-4 text-sm tabular-nums">${score(entry.snapshot.commerce)} ${arrow(previous?.snapshot.commerce ?? null, entry.snapshot.commerce)}</td><td class="py-3 pr-4"><div class="flex max-w-[320px] flex-wrap gap-1">${groups}</div></td><td class="py-3 pr-4 text-sm">${changeList({ entry, previous, diff, catalogChanged })}</td><td class="whitespace-nowrap py-3 text-sm">${report}</td></tr>`;
    })
    .join('');
  const body = `
<header class="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
<div class="min-w-0"><p class="text-sm text-muted-foreground">Agentic readiness history</p><h1 class="mt-1 break-all text-2xl font-bold tracking-tight sm:text-3xl">${escapeHtml(host)}</h1><p class="mt-1.5 text-sm text-muted-foreground">${entries.length} distinct state${entries.length === 1 ? '' : 's'} across ${totalScans} scan${totalScans === 1 ? '' : 's'}${latest ? ` · first scanned ${when(entries[entries.length - 1]?.firstAt ?? latest.firstAt)} · last scanned ${when(latest.lastAt)}` : ''}</p></div>
<p class="text-sm text-muted-foreground"><a href="/h/${escapeHtml(host)}.json">JSON</a> · <a href="/badge/${escapeHtml(host)}.svg">Badge</a></p>
</header>
${
  latest
    ? `<section class="${card} mt-6 grid gap-5 p-6 sm:grid-cols-[auto_1fr_auto] sm:items-center"><div class="inline-grid size-[88px] place-items-center rounded-2xl border border-primary/40 bg-primary/10 text-4xl font-extrabold leading-none text-primary"><small class="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">Level</small>${latest.snapshot.level}</div><div><h2 class="text-lg font-semibold tracking-tight">Current state</h2><p class="mt-1.5 text-muted-foreground">Ingestion ${score(latest.snapshot.ingestion)} · commerce ${score(latest.snapshot.commerce)} · held since ${when(latest.firstAt)} and confirmed by ${latest.scans} scan${latest.scans === 1 ? '' : 's'}.</p></div><form method="post" action="/scan"><input type="hidden" name="url" value="${escapeHtml(latest.url)}"><button type="submit" class="${button({ variant: 'outline' })}">Scan again</button></form></section>`
    : `<section class="${card} mt-6 p-6"><p class="text-muted-foreground">No scans recorded for this host yet.</p><form method="post" action="/scan" class="mt-3"><input type="hidden" name="url" value="https://${escapeHtml(host)}/"><button type="submit" class="${button()}">Scan it</button></form></section>`
}
${entries.length >= 2 ? `<div class="mt-6">${trendChart(entries)}</div>` : ''}
${
  entries.length > 0
    ? `<section class="mt-8"><h2 class="mb-3 text-lg font-semibold tracking-tight">States over time</h2><p class="mb-3 text-sm text-muted-foreground">Each row is one distinct state: a rescan that changed nothing extends the row, a rescan that changed any verdict or score starts a new one. Newest first.</p><div class="${card} overflow-x-auto"><table class="w-full min-w-[880px] border-collapse px-4 text-left"><thead><tr class="border-b border-border text-xs uppercase tracking-wider text-muted-foreground"><th class="px-4 py-3 font-semibold">Period</th><th class="py-3 pr-4 font-semibold">Level</th><th class="py-3 pr-4 font-semibold">Ingestion</th><th class="py-3 pr-4 font-semibold">Commerce</th><th class="py-3 pr-4 font-semibold">Sections</th><th class="py-3 pr-4 font-semibold">What changed</th><th class="py-3 pr-4 font-semibold"></th></tr></thead><tbody class="divide-y divide-border [&>tr>td:first-child]:pl-4">${rows}</tbody></table></div></section>`
    : ''
}
`;
  return page(
    config,
    {
      title: `History: ${host}`,
      description: latest
        ? `Agentic readiness of ${host} over time: currently Level ${latest.snapshot.level}, ingestion ${latest.snapshot.ingestion}.`
        : `Agentic readiness history of ${host}.`,
    },
    body,
  );
}

/**
 * The block on a report that compares it with the state before it. `entries` is the
 * host's history and `scan` the report being shown; when the report belongs to the
 * oldest entry it says so, otherwise it lists the differences to the previous state.
 */
export function sincePreviousPanel(
  host: string,
  entries: readonly HistoryEntry[],
  scan: { id: string; createdAt: string },
  current: HistoryEntry | null,
): string {
  const steps = historySteps(entries);
  const step = current ? steps.find((candidate) => candidate.entry.id === current.id) : undefined;
  const historyLink = `<a class="${button({ variant: 'outline', size: 'sm' })}" href="/h/${escapeHtml(host)}">${icon('chevron-right')}Full history</a>`;
  if (!step) return '';
  if (!step.previous || !step.diff) {
    const held =
      step.entry.scans > 1
        ? `This state has held since ${when(step.entry.firstAt)} and was confirmed by ${step.entry.scans} scans.`
        : `First scan of ${escapeHtml(host)}. Scan again later to see what changed.`;
    return `<section class="${card} mt-4 flex flex-wrap items-center justify-between gap-3 p-5" aria-labelledby="since-title"><div><h2 id="since-title" class="text-base font-semibold tracking-tight">Progress</h2><p class="mt-1 text-sm text-muted-foreground">${held}</p></div>${historyLink}</section>`;
  }
  const lines = describeDiff(step.diff).map((line) => `<li>${escapeHtml(line)}</li>`);
  const since = `Compared with the state observed ${when(step.previous.firstAt)}${step.previous.scans > 1 ? ` to ${when(step.previous.lastAt)}` : ''}${step.catalogChanged ? ` (catalog ${escapeHtml(step.previous.catalogVersion)} → ${escapeHtml(step.entry.catalogVersion)})` : ''}.`;
  return `<section class="${card} mt-4 p-5" aria-labelledby="since-title"><div class="flex flex-wrap items-start justify-between gap-3"><div><h2 id="since-title" class="text-base font-semibold tracking-tight">Since the previous state</h2><p class="mt-1 text-sm text-muted-foreground">${since}${scan.id !== step.entry.id ? ` This report confirms a state first seen ${when(step.entry.firstAt)}.` : ''}</p></div>${historyLink}</div>${lines.length > 0 ? `<ul class="mt-3 list-disc space-y-0.5 pl-5 text-sm">${lines.join('')}</ul>` : ''}</section>`;
}
