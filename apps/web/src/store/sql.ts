import { getCheck, type ScanResult } from '@agentic-readiness/catalog';
import { computeScores } from '@agentic-readiness/core';

import type { ResultStore, StoredScan } from './types.js';

/**
 * The subset of the D1 binding shape that Spacefast Functions expose as env.DB.
 * Declared locally so the app does not depend on a platform type package.
 */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first(): Promise<Record<string, unknown> | null>;
  all(): Promise<{ results: Record<string, unknown>[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
}

interface ScanRow {
  id: string;
  host: string;
  created_at: string;
  result: string;
}

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

/** MySQL-compatible DDL; the Space's database is MySQL behind the D1-shaped broker. */
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

export class SqlResultStore implements ResultStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly db: SqlDatabase) {}

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.db
      .prepare(SCHEMA_SQL)
      .run()
      .then(() => undefined);
    return this.schemaReady;
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
    return row ? rowToScan(row as unknown as ScanRow) : null;
  }

  async latestForHost(host: string): Promise<StoredScan | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare(
        'SELECT id, host, created_at, result FROM scans WHERE host = ? ORDER BY created_at DESC LIMIT 1',
      )
      .bind(host)
      .first();
    return row ? rowToScan(row as unknown as ScanRow) : null;
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

function rowToScan(row: ScanRow): StoredScan {
  const parsed = JSON.parse(row.result) as ScanResult;
  // Rows stored before scores.groups existed get it recomputed; it is a pure function of results.
  const result = (parsed.scores as Partial<typeof parsed.scores>).groups
    ? parsed
    : { ...parsed, scores: computeScores(parsed.results) };
  return {
    id: row.id,
    host: row.host,
    createdAt: row.created_at,
    result: attachFixes(result),
  };
}
