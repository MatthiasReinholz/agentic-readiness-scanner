import type { SqlDatabase } from '../store/sql.js';
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

interface TargetRow {
  host: string;
  url: string;
  first_seen_at: string;
  last_seen_at: string;
  scan_count: number;
  last_scan_id: string;
  last_level: number;
  last_ingestion: number;
  last_commerce: number | null;
  last_platform: string;
  last_profile: string;
}

function rowToRecord(row: TargetRow): TargetRecord {
  return {
    host: row.host,
    url: row.url,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    scanCount: row.scan_count,
    lastScanId: row.last_scan_id,
    lastLevel: row.last_level,
    lastIngestion: row.last_ingestion,
    lastCommerce: row.last_commerce,
    lastPlatform: row.last_platform,
    lastProfile: row.last_profile,
  };
}

export class SqlTargetRegistry implements TargetRegistry {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly db: SqlDatabase) {}

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.db
      .prepare(TARGETS_SCHEMA_SQL)
      .run()
      .then(() => undefined);
    return this.schemaReady;
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
    const safeLimit = Math.max(1, Math.min(5000, Math.trunc(limit)));
    const { results } = await this.db
      .prepare(`SELECT * FROM targets ORDER BY last_seen_at DESC LIMIT ${safeLimit}`)
      .all();
    return results.map((row) => rowToRecord(row as unknown as TargetRow));
  }
}
