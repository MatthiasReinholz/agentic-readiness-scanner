import { getCheck, type ScanResult } from '@agentic-readiness/catalog';
import { computeScores } from '@agentic-readiness/core';

import { RowReader, SqlStore, type SqlDatabase } from './sql-store.js';
import type { ResultStore, StoredScan } from './types.js';

export type { SqlDatabase, SqlStatement } from './sql-store.js';

/**
 * Fix text is the bulk of a result and lives in the catalog, so it is stripped before
 * storage and re-attached on read. Keeps rows small on brokers with tight payload caps.
 */
export function stripFixes(result: ScanResult): ScanResult {
  return {
    ...result,
    results: result.results.map((item) => {
      const copy = { ...item };
      delete copy.fix;
      return copy;
    }),
  };
}

export function attachFixes(result: ScanResult): ScanResult {
  return {
    ...result,
    results: result.results.map((item) => {
      if (item.verdict !== 'fail' && item.verdict !== 'warn') return item;
      const definition = getCheck(item.id);
      return definition ? { ...item, fix: definition.fix } : item;
    }),
  };
}

/**
 * MySQL-compatible DDL; the Space's database is MySQL behind the D1-shaped broker.
 * The level, ingestion and commerce columns are never read by the app: they exist so the
 * owner can query and chart results in the SQL console without parsing the JSON column.
 */
export const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS scans (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  host VARCHAR(255) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  level INT NOT NULL,
  ingestion INT NOT NULL,
  commerce INT NULL,
  result MEDIUMTEXT NOT NULL,
  INDEX idx_scans_host_created (host, created_at)
)`;

export class SqlResultStore extends SqlStore implements ResultStore {
  constructor(db: SqlDatabase) {
    super(db, SCHEMA_SQL);
  }

  async put(scan: StoredScan): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        'INSERT INTO scans (id, host, created_at, level, ingestion, commerce, result) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        scan.id,
        scan.host,
        scan.createdAt,
        scan.result.level.value,
        scan.result.scores.ingestion,
        scan.result.scores.commerce,
        JSON.stringify(stripFixes(scan.result)),
      )
      .run();
  }

  async get(id: string): Promise<StoredScan | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare('SELECT id, host, created_at, result FROM scans WHERE id = ?')
      .bind(id)
      .first();
    return row ? rowToScan(row) : null;
  }

  async latestForHost(host: string): Promise<StoredScan | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare(
        'SELECT id, host, created_at, result FROM scans WHERE host = ? ORDER BY created_at DESC LIMIT 1',
      )
      .bind(host)
      .first();
    return row ? rowToScan(row) : null;
  }

  async deleteOlderThan(isoTimestamp: string): Promise<number> {
    await this.ensureSchema();
    const outcome = await this.db
      .prepare('DELETE FROM scans WHERE created_at < ?')
      .bind(isoTimestamp)
      .run();
    return outcome.meta?.changes ?? 0;
  }
}

function rowToScan(row: Record<string, unknown>): StoredScan {
  const reader = new RowReader('scans', row);
  const parsed = JSON.parse(reader.string('result')) as ScanResult;
  // Rows stored before scores.groups existed get it recomputed; it is a pure function of results.
  const result = (parsed.scores as Partial<typeof parsed.scores>).groups
    ? parsed
    : { ...parsed, scores: computeScores(parsed.results) };
  return {
    id: reader.string('id'),
    host: reader.string('host'),
    createdAt: reader.string('created_at'),
    result: attachFixes(result),
  };
}
