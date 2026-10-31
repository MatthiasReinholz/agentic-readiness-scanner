import { sameSnapshot, snapshotOf, type ResultSnapshot } from '@agentic-readiness/core';

import type { StoredScan } from '../store/types.js';

/**
 * One distinct state of a host: the headline numbers, the group scores and every
 * check's verdict, together with the period during which scans kept confirming it.
 * A rescan that changes nothing extends the current entry; a rescan that changes any
 * verdict, score or the catalog version opens a new one. History therefore grows with
 * what changed on the site (or in the catalog), not with how often it was scanned, and
 * it is never purged, unlike the full results with their evidence.
 */
export interface HistoryEntry {
  /** Id of the first scan that observed this state. */
  id: string;
  host: string;
  url: string;
  /** When the state was first and last observed. */
  firstAt: string;
  lastAt: string;
  /** Scans that observed this state, the first one included. */
  scans: number;
  /** The most recent scan in this state; its report is available while retention lasts. */
  lastScanId: string;
  catalogVersion: string;
  scoringVersion: string;
  scannerVersion: string;
  platform: string;
  profile: string;
  snapshot: ResultSnapshot;
}

export interface HistoryStore {
  /** Appends the scan to the host's history, or confirms the current entry when nothing changed. */
  record(scan: StoredScan): Promise<void>;
  /** Entries for a host, newest first. */
  forHost(host: string, limit: number): Promise<HistoryEntry[]>;
}

export function entryFromScan(scan: StoredScan): HistoryEntry {
  return {
    id: scan.id,
    host: scan.host,
    url: scan.result.target.url,
    firstAt: scan.createdAt,
    lastAt: scan.createdAt,
    scans: 1,
    lastScanId: scan.id,
    catalogVersion: scan.result.catalog_version,
    scoringVersion: scan.result.scoring_version,
    scannerVersion: scan.result.scanner_version,
    platform: scan.result.target.platform,
    profile: scan.result.target.profile,
    snapshot: snapshotOf(scan.result),
  };
}

/** True when the scan observed the state the entry describes, under the same catalog and scoring. */
export function confirmsEntry(entry: HistoryEntry, scan: StoredScan): boolean {
  return (
    entry.host === scan.host &&
    entry.catalogVersion === scan.result.catalog_version &&
    entry.scoringVersion === scan.result.scoring_version &&
    entry.profile === scan.result.target.profile &&
    sameSnapshot(entry.snapshot, snapshotOf(scan.result))
  );
}

/** The entry after the scan confirmed it. */
export function confirmedEntry(entry: HistoryEntry, scan: StoredScan): HistoryEntry {
  return {
    ...entry,
    url: scan.result.target.url,
    lastAt: scan.createdAt,
    scans: entry.scans + 1,
    lastScanId: scan.id,
    scannerVersion: scan.result.scanner_version,
  };
}

/** The entry that holds a scan: the one whose period contains it, by id first, then by time. */
export function entryContaining(
  entries: readonly HistoryEntry[],
  scan: Pick<StoredScan, 'id' | 'createdAt'>,
): HistoryEntry | null {
  return (
    entries.find((entry) => entry.id === scan.id || entry.lastScanId === scan.id) ??
    entries.find((entry) => entry.firstAt <= scan.createdAt && scan.createdAt <= entry.lastAt) ??
    null
  );
}
