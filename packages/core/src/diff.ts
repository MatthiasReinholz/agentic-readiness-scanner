/**
 * Compares two scans of the same target. Used by monitoring to decide whether a
 * subscriber hears about a rescan, and by anyone diffing reports over time. A snapshot
 * keeps only what a comparison needs, so it is cheap to store next to a subscription.
 */
import { getCheck, type ScanResult, type Verdict } from '@agentic-readiness/catalog';

export interface ResultSnapshot {
  level: number;
  ingestion: number;
  commerce: number | null;
  /** Verdict per check id. */
  verdicts: Record<string, Verdict>;
}

export interface ValueChange<T> {
  from: T;
  to: T;
}

export type VerdictOrAbsent = Verdict | 'absent';

export interface CheckChange {
  id: string;
  title: string;
  from: VerdictOrAbsent;
  to: VerdictOrAbsent;
}

export interface ResultDiff {
  changed: boolean;
  level: ValueChange<number> | null;
  ingestion: ValueChange<number> | null;
  commerce: ValueChange<number | null> | null;
  checks: CheckChange[];
}

export function snapshotOf(result: ScanResult): ResultSnapshot {
  const verdicts: Record<string, Verdict> = {};
  for (const item of result.results) verdicts[item.id] = item.verdict;
  return {
    level: result.level.value,
    ingestion: result.scores.ingestion,
    commerce: result.scores.commerce,
    verdicts,
  };
}

function change<T>(from: T, to: T): ValueChange<T> | null {
  return from === to ? null : { from, to };
}

export function diffSnapshots(before: ResultSnapshot, after: ResultSnapshot): ResultDiff {
  const ids = [
    ...new Set([...Object.keys(before.verdicts), ...Object.keys(after.verdicts)]),
  ].sort();
  const checks: CheckChange[] = [];
  for (const id of ids) {
    const from: VerdictOrAbsent = before.verdicts[id] ?? 'absent';
    const to: VerdictOrAbsent = after.verdicts[id] ?? 'absent';
    if (from !== to) checks.push({ id, title: getCheck(id)?.title ?? id, from, to });
  }
  const level = change(before.level, after.level);
  const ingestion = change(before.ingestion, after.ingestion);
  const commerce = change(before.commerce, after.commerce);
  return {
    changed: level !== null || ingestion !== null || commerce !== null || checks.length > 0,
    level,
    ingestion,
    commerce,
    checks,
  };
}

function scoreText(value: number | null): string {
  return value === null ? 'n/a' : String(value);
}

/** One plain line per change, in the order a reader cares about: level, scores, checks. */
export function describeDiff(diff: ResultDiff): string[] {
  const lines: string[] = [];
  if (diff.level) lines.push(`Level ${diff.level.from} → ${diff.level.to}`);
  if (diff.ingestion) lines.push(`Ingestion score ${diff.ingestion.from} → ${diff.ingestion.to}`);
  if (diff.commerce)
    lines.push(`Commerce score ${scoreText(diff.commerce.from)} → ${scoreText(diff.commerce.to)}`);
  for (const item of diff.checks) lines.push(`${item.id} ${item.title}: ${item.from} → ${item.to}`);
  return lines;
}
