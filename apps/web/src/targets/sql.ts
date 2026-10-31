import { clampLimit, RowReader, SqlStore, type SqlDatabase } from '../store/sql-store.js';
import type { StoredScan } from '../store/types.js';
import { recordFromScan, type TargetRecord, type TargetRegistry } from './types.js';

export const TARGETS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS targets (
  host VARCHAR(255) NOT NULL PRIMARY KEY,
  url VARCHAR(2048) NOT NULL,
  first_seen_at VARCHAR(32) NOT NULL,
  last_seen_at VARCHAR(32) NOT NULL,
  scan_count INT NOT NULL,
  last_scan_id VARCHAR(32) NOT NULL,
  last_level INT NOT NULL,
  last_ingestion INT NOT NULL,
  last_commerce INT NULL,
  last_platform VARCHAR(32) NOT NULL,
  last_profile VARCHAR(64) NOT NULL,
  INDEX idx_targets_last_seen (last_seen_at)
)`;

/** Rows the owner's export may ask for at most; the route caps its own limit the same way. */
export const MAX_TARGET_ROWS = 5000;

function rowToRecord(row: Record<string, unknown>): TargetRecord {
  const reader = new RowReader('targets', row);
  return {
    host: reader.string('host'),
    url: reader.string('url'),
    firstSeenAt: reader.string('first_seen_at'),
    lastSeenAt: reader.string('last_seen_at'),
    scanCount: reader.number('scan_count'),
    lastScanId: reader.string('last_scan_id'),
    lastLevel: reader.number('last_level'),
    lastIngestion: reader.number('last_ingestion'),
    lastCommerce: reader.nullableNumber('last_commerce'),
    lastPlatform: reader.string('last_platform'),
    lastProfile: reader.string('last_profile'),
  };
}

export class SqlTargetRegistry extends SqlStore implements TargetRegistry {
  constructor(db: SqlDatabase) {
    super(db, TARGETS_SCHEMA_SQL);
  }

  async record(scan: StoredScan): Promise<void> {
    await this.ensureSchema();
    const next = recordFromScan(scan);
    await this.db
      .prepare(
        `INSERT INTO targets (host, url, first_seen_at, last_seen_at, scan_count, last_scan_id, last_level, last_ingestion, last_commerce, last_platform, last_profile)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE url = VALUES(url), last_seen_at = VALUES(last_seen_at), scan_count = scan_count + 1, last_scan_id = VALUES(last_scan_id), last_level = VALUES(last_level), last_ingestion = VALUES(last_ingestion), last_commerce = VALUES(last_commerce), last_platform = VALUES(last_platform), last_profile = VALUES(last_profile)`,
      )
      .bind(
        next.host,
        next.url,
        next.firstSeenAt,
        next.lastSeenAt,
        next.lastScanId,
        next.lastLevel,
        next.lastIngestion,
        next.lastCommerce,
        next.lastPlatform,
        next.lastProfile,
      )
      .run();
  }

  async list(limit: number): Promise<TargetRecord[]> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare(
        `SELECT * FROM targets ORDER BY last_seen_at DESC LIMIT ${clampLimit(limit, MAX_TARGET_ROWS)}`,
      )
      .all();
    return results.map(rowToRecord);
  }
}
