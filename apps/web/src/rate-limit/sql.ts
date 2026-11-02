import { randomHex } from '../ids.js';
import { RowReader, SqlStore, type SqlDatabase } from '../store/sql-store.js';
import type { ScanLimiter, ScanLimit } from './types.js';

export const SCAN_LIMIT_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS scan_limits (
  host VARCHAR(255) NOT NULL PRIMARY KEY,
  next_at VARCHAR(32) NOT NULL,
  claim_token VARCHAR(32) NOT NULL,
  INDEX idx_scan_limits_next (next_at)
)`;

/** MySQL's conditional upsert is the lock: no read-then-write window across isolates. */
export class SqlScanLimiter extends SqlStore implements ScanLimiter {
  constructor(db: SqlDatabase) {
    super(db, SCAN_LIMIT_SCHEMA_SQL);
  }

  async acquire(host: string, now: Date, intervalSeconds: number): Promise<ScanLimit> {
    await this.ensureSchema();
    const token = randomHex(16);
    const time = now.toISOString();
    const next = new Date(now.getTime() + Math.max(60, intervalSeconds) * 1000).toISOString();
    // Assign the token before next_at so both conditions see the old reservation time.
    await this.db
      .prepare(
        `INSERT INTO scan_limits (host, next_at, claim_token) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        claim_token = IF(next_at <= ?, VALUES(claim_token), claim_token),
        next_at = IF(next_at <= ?, VALUES(next_at), next_at)`,
      )
      .bind(host, next, token, time, time)
      .run();
    const row = await this.db
      .prepare('SELECT next_at, claim_token FROM scan_limits WHERE host = ?')
      .bind(host)
      .first();
    // A missing or malformed claim fails closed, before any outbound scan request.
    if (!row) throw new Error('Scan reservation missing');
    const reader = new RowReader('scan_limits', row);
    const allowed = reader.string('claim_token') === token;
    const nextAt = Date.parse(reader.string('next_at'));
    if (!Number.isFinite(nextAt)) throw new Error('Invalid scan reservation time');
    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((nextAt - now.getTime()) / 1000)),
    };
  }

  async deleteOlderThan(isoTimestamp: string): Promise<number> {
    await this.ensureSchema();
    const result = await this.db
      .prepare('DELETE FROM scan_limits WHERE next_at < ?')
      .bind(isoTimestamp)
      .run();
    return result.meta?.changes ?? 0;
  }
}
