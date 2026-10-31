/**
 * Compares two scans of the same target. Used by monitoring to decide whether a
 * subscriber hears about a rescan, and by anyone diffing reports over time. A snapshot
 * keeps only what a comparison needs, so it is cheap to store next to a subscription.
 */
import { getCheck, type ScanResult, type Verdict } from '@agentic-readiness/catalog';

import type { SkipReason } from './checks/types.js';

/**
 * The comparable core of a result: headline numbers and one verdict per check. Groups
 * and skip reasons are optional because snapshots stored before they existed lack them;
 * a comparison treats a missing map as empty.
 */
export interface ResultSnapshot {
  level: number;
  ingestion: number;
  commerce: number | null;
  /** Score per catalog group, null where nothing applied. */
  groups?: Record<string, number | null>;
  /** Verdict per check id. */
  verdicts: Record<string, Verdict>;
  /** Why a check was skipped, for the checks whose verdict is skip. */
  skips?: Record<string, SkipReason>;
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
  const skips: Record<string, SkipReason> = {};
  for (const item of result.results) {
    verdicts[item.id] = item.verdict;
    if (item.verdict === 'skip' && item.skip_reason) skips[item.id] = item.skip_reason;
  }
  return {
    level: result.level.value,
    ingestion: result.scores.ingestion,
    commerce: result.scores.commerce,
    groups: { ...result.scores.groups },
    verdicts,
    skips,
  };
}

/**
 * True when two snapshots describe the same state: same headline numbers, same group
 * scores and the same verdict (and skip reason) for every check. This is what decides
 * whether a rescan opens a new history entry or confirms the current one.
 */
export function sameSnapshot(a: ResultSnapshot, b: ResultSnapshot): boolean {
  if (a.level !== b.level || a.ingestion !== b.ingestion || a.commerce !== b.commerce) return false;
  return (
    sameRecord(a.groups ?? {}, b.groups ?? {}) &&
    sameRecord(a.verdicts, b.verdicts) &&
    sameRecord(a.skips ?? {}, b.skips ?? {})
  );
}

function sameRecord(
  a: Record<string, string | number | null>,
  b: Record<string, string | number | null>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => key in b && a[key] === b[key]);
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
