import type { ScanResult } from '@agentic-readiness/catalog';

import { JSON_COLUMN_BUDGET, decodeJsonColumn, fitJsonColumn } from '../store/json-column.js';
import { shrinkResult } from '../store/sql.js';
import { RowReader, SqlStore, type SqlDatabase } from '../store/sql-store.js';
import type { ProgressFinal, ProgressRecord, ProgressStore } from './types.js';

/** What an event keeps when the record has to shrink: enough to place it, not its text. */
const EVENT_CORE = new Set(['seq', 'type', 'id', 'phase', 'verdict']);

/** The events without their text, or null when they already are. */
function shrinkEvents(events: unknown[]): unknown[] | null {
  let changed = false;
  const smaller = events.map((event) => {
    if (typeof event !== 'object' || event === null) return event;
    const entries = Object.entries(event);
    const kept = entries.filter(([key]) => EVENT_CORE.has(key));
    if (kept.length < entries.length) changed = true;
    return Object.fromEntries(kept);
  });
  return changed ? smaller : null;
}

/** A one-time scan's final event carries its result; that can shrink like a stored one. */
function shrinkFinal(final: ProgressFinal): ProgressFinal | null {
  const data = final.data as { result?: ScanResult } | null;
  if (!data || typeof data !== 'object' || !data.result) return null;
  const result = shrinkResult(data.result);
  return result ? { ...final, data: { ...data, result } } : null;
}

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

  /**
   * Both columns are packed and share one operation: the final event first, because the
   * page opens the report from it, and the events in what is left.
   */
  async save(token: string, record: ProgressRecord): Promise<void> {
    await this.ensureSchema();
    const final = record.final
      ? await fitJsonColumn(
          'scan_progress.final_json',
          record.final,
          JSON_COLUMN_BUDGET * 0.75,
          shrinkFinal,
        )
      : null;
    const events = await fitJsonColumn(
      'scan_progress.events',
      record.events,
      JSON_COLUMN_BUDGET - (final?.length ?? 0),
      shrinkEvents,
    );
    await this.db
      .prepare(
        `INSERT INTO scan_progress (token, events, final_json, updated_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE events = VALUES(events), final_json = VALUES(final_json), updated_at = VALUES(updated_at)`,
      )
      .bind(token, events, final, record.updatedAt)
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
      events: (await decodeJsonColumn(reader.string('events'))) as unknown[],
      final: final ? ((await decodeJsonColumn(final)) as ProgressFinal) : null,
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
