import { RowReader, SqlStore, type SqlDatabase } from '../store/sql-store.js';
import type { ProgressFinal, ProgressRecord, ProgressStore } from './types.js';

/** One row per scan in flight; the cleanup cron removes rows older than an hour. */
export const PROGRESS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS scan_progress (
  token CHAR(32) NOT NULL PRIMARY KEY,
  events MEDIUMTEXT NOT NULL,
  final_json MEDIUMTEXT NULL,
  updated_at VARCHAR(32) NOT NULL,
  INDEX idx_progress_updated (updated_at)
)`;

export class SqlProgressStore extends SqlStore implements ProgressStore {
  constructor(db: SqlDatabase) {
    super(db, PROGRESS_SCHEMA_SQL);
  }

  async save(token: string, record: ProgressRecord): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT INTO scan_progress (token, events, final_json, updated_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE events = VALUES(events), final_json = VALUES(final_json), updated_at = VALUES(updated_at)`,
      )
      .bind(
        token,
        JSON.stringify(record.events),
        record.final ? JSON.stringify(record.final) : null,
        record.updatedAt,
      )
      .run();
  }

  async load(token: string): Promise<ProgressRecord | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare('SELECT token, events, final_json, updated_at FROM scan_progress WHERE token = ?')
      .bind(token)
      .first();
    if (!row) return null;
    const reader = new RowReader('scan_progress', row);
    const final = reader.nullableString('final_json');
    return {
      events: JSON.parse(reader.string('events')) as unknown[],
      final: final ? (JSON.parse(final) as ProgressFinal) : null,
      updatedAt: reader.string('updated_at'),
    };
  }

  async deleteOlderThan(isoTimestamp: string): Promise<number> {
    await this.ensureSchema();
    const outcome = await this.db
      .prepare('DELETE FROM scan_progress WHERE updated_at < ?')
      .bind(isoTimestamp)
      .run();
    return outcome.meta?.changes ?? 0;
  }
}
