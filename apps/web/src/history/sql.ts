import type { ResultSnapshot } from '@agentic-readiness/core';

import { clampLimit, RowReader, SqlStore, type SqlDatabase } from '../store/sql-store.js';
import type { StoredScan } from '../store/types.js';
import {
  confirmedEntry,
  confirmsEntry,
  entryFromScan,
  type HistoryEntry,
  type HistoryStore,
} from './types.js';

/**
 * One row per distinct state per host; see HistoryEntry. The snapshot columns hold small
 * JSON maps (a few hundred bytes), so a host's whole history is one indexed range read.
 * Per-check analytics across hosts can use MySQL's JSON functions on `verdicts`
 * (`JSON_EXTRACT(verdicts, '$."A2.3"')`) or the owner export.
 */
export const HISTORY_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS scan_history (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  host VARCHAR(255) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  first_at VARCHAR(32) NOT NULL,
  last_at VARCHAR(32) NOT NULL,
  scans INT NOT NULL,
  last_scan_id VARCHAR(32) NOT NULL,
  catalog_version VARCHAR(32) NOT NULL,
  scoring_version VARCHAR(32) NOT NULL,
  scanner_version VARCHAR(32) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  profile VARCHAR(64) NOT NULL,
  level INT NOT NULL,
  ingestion INT NOT NULL,
  commerce INT NULL,
  groups_json TEXT NOT NULL,
  verdicts_json TEXT NOT NULL,
  skips_json TEXT NOT NULL,
  INDEX idx_history_host_last (host, last_at)
)`;

/** Entries one listing may return at most. */
export const MAX_HISTORY_ROWS = 500;

const COLUMNS =
  'id, host, url, first_at, last_at, scans, last_scan_id, catalog_version, scoring_version, scanner_version, platform, profile, level, ingestion, commerce, groups_json, verdicts_json, skips_json';

function rowToEntry(row: Record<string, unknown>): HistoryEntry {
  const reader = new RowReader('scan_history', row);
  const snapshot: ResultSnapshot = {
    level: reader.number('level'),
    ingestion: reader.number('ingestion'),
    commerce: reader.nullableNumber('commerce'),
    groups: JSON.parse(reader.string('groups_json')) as NonNullable<ResultSnapshot['groups']>,
    verdicts: JSON.parse(reader.string('verdicts_json')) as ResultSnapshot['verdicts'],
    skips: JSON.parse(reader.string('skips_json')) as NonNullable<ResultSnapshot['skips']>,
  };
  return {
    id: reader.string('id'),
    host: reader.string('host'),
    url: reader.string('url'),
    firstAt: reader.string('first_at'),
    lastAt: reader.string('last_at'),
    scans: reader.number('scans'),
    lastScanId: reader.string('last_scan_id'),
    catalogVersion: reader.string('catalog_version'),
    scoringVersion: reader.string('scoring_version'),
    scannerVersion: reader.string('scanner_version'),
    platform: reader.string('platform'),
    profile: reader.string('profile'),
    snapshot,
  };
}

export class SqlHistoryStore extends SqlStore implements HistoryStore {
  constructor(db: SqlDatabase) {
    super(db, HISTORY_SCHEMA_SQL);
  }

  async record(scan: StoredScan): Promise<void> {
    await this.ensureSchema();
    const [latest] = await this.forHost(scan.host, 1);
    if (latest && confirmsEntry(latest, scan)) {
      const next = confirmedEntry(latest, scan);
      await this.db
        .prepare(
          'UPDATE scan_history SET url = ?, last_at = ?, scans = ?, last_scan_id = ?, scanner_version = ? WHERE id = ?',
        )
        .bind(next.url, next.lastAt, next.scans, next.lastScanId, next.scannerVersion, next.id)
        .run();
      return;
    }
    const entry = entryFromScan(scan);
    await this.db
      .prepare(
        `INSERT INTO scan_history (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.id,
        entry.host,
        entry.url,
        entry.firstAt,
        entry.lastAt,
        entry.scans,
        entry.lastScanId,
        entry.catalogVersion,
        entry.scoringVersion,
        entry.scannerVersion,
        entry.platform,
        entry.profile,
        entry.snapshot.level,
        entry.snapshot.ingestion,
        entry.snapshot.commerce,
        JSON.stringify(entry.snapshot.groups ?? {}),
        JSON.stringify(entry.snapshot.verdicts),
        JSON.stringify(entry.snapshot.skips ?? {}),
      )
      .run();
  }

  async forHost(host: string, limit: number): Promise<HistoryEntry[]> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM scan_history WHERE host = ? ORDER BY last_at DESC LIMIT ${clampLimit(limit, MAX_HISTORY_ROWS)}`,
      )
      .bind(host)
      .all();
    return results.map(rowToEntry);
  }
}
