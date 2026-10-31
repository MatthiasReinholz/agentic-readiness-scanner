import {
  clampLimit,
  MalformedRowError,
  RowReader,
  SqlStore,
  type SqlDatabase,
} from '../store/sql-store.js';
import type { Baseline, Monitor, MonitorStatus, MonitorStore } from './types.js';

/** MySQL-compatible DDL for the D1-shaped broker in front of the Space's database. */
export const MONITORS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS monitors (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  host VARCHAR(255) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  status VARCHAR(16) NOT NULL,
  confirm_token_hash CHAR(64) NOT NULL,
  manage_token_hash CHAR(64) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  confirmed_at VARCHAR(32) NULL,
  unsubscribed_at VARCHAR(32) NULL,
  last_checked_at VARCHAR(32) NULL,
  last_notified_at VARCHAR(32) NULL,
  baseline MEDIUMTEXT NULL,
  UNIQUE KEY uq_monitors_email_host (email, host),
  INDEX idx_monitors_due (status, last_checked_at)
)`;

/** Rows one listing may return at most, for the due-run and the owner's export alike. */
export const MAX_MONITOR_ROWS = 1000;

const COLUMNS =
  'id, email, host, url, status, confirm_token_hash, manage_token_hash, created_at, confirmed_at, unsubscribed_at, last_checked_at, last_notified_at, baseline';

const STATUSES: readonly MonitorStatus[] = ['pending', 'active', 'unsubscribed'];

function rowToMonitor(row: Record<string, unknown>): Monitor {
  const reader = new RowReader('monitors', row);
  const status = reader.string('status');
  if (!STATUSES.some((known) => known === status)) {
    throw new MalformedRowError('monitors', 'status');
  }
  const baseline = reader.nullableString('baseline');
  return {
    id: reader.string('id'),
    email: reader.string('email'),
    host: reader.string('host'),
    url: reader.string('url'),
    status: status as MonitorStatus,
    confirmTokenHash: reader.string('confirm_token_hash'),
    manageTokenHash: reader.string('manage_token_hash'),
    createdAt: reader.string('created_at'),
    confirmedAt: reader.nullableString('confirmed_at'),
    unsubscribedAt: reader.nullableString('unsubscribed_at'),
    lastCheckedAt: reader.nullableString('last_checked_at'),
    lastNotifiedAt: reader.nullableString('last_notified_at'),
    baseline: baseline ? (JSON.parse(baseline) as Baseline) : null,
  };
}

export class SqlMonitorStore extends SqlStore implements MonitorStore {
  constructor(db: SqlDatabase) {
    super(db, MONITORS_SCHEMA_SQL);
  }

  async create(monitor: Monitor): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(`INSERT INTO monitors (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        monitor.id,
        monitor.email,
        monitor.host,
        monitor.url,
        monitor.status,
        monitor.confirmTokenHash,
        monitor.manageTokenHash,
        monitor.createdAt,
        monitor.confirmedAt,
        monitor.unsubscribedAt,
        monitor.lastCheckedAt,
        monitor.lastNotifiedAt,
        monitor.baseline ? JSON.stringify(monitor.baseline) : null,
      )
      .run();
  }

  async update(monitor: Monitor): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        'UPDATE monitors SET email = ?, host = ?, url = ?, status = ?, confirm_token_hash = ?, manage_token_hash = ?, confirmed_at = ?, unsubscribed_at = ?, last_checked_at = ?, last_notified_at = ?, baseline = ? WHERE id = ?',
      )
      .bind(
        monitor.email,
        monitor.host,
        monitor.url,
        monitor.status,
        monitor.confirmTokenHash,
        monitor.manageTokenHash,
        monitor.confirmedAt,
        monitor.unsubscribedAt,
        monitor.lastCheckedAt,
        monitor.lastNotifiedAt,
        monitor.baseline ? JSON.stringify(monitor.baseline) : null,
        monitor.id,
      )
      .run();
  }

  async get(id: string): Promise<Monitor | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM monitors WHERE id = ?`)
      .bind(id)
      .first();
    return row ? rowToMonitor(row) : null;
  }

  async findByEmailAndHost(email: string, host: string): Promise<Monitor | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM monitors WHERE email = ? AND host = ?`)
      .bind(email, host)
      .first();
    return row ? rowToMonitor(row) : null;
  }

  async listDue(before: string, limit: number): Promise<Monitor[]> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM monitors WHERE status = 'active' AND (last_checked_at IS NULL OR last_checked_at < ?) ORDER BY last_checked_at IS NULL DESC, last_checked_at ASC LIMIT ${clampLimit(limit, MAX_MONITOR_ROWS)}`,
      )
      .bind(before)
      .all();
    return results.map(rowToMonitor);
  }

  async countCreatedSince(email: string, sinceIso: string): Promise<number> {
    await this.ensureSchema();
    const row = await this.db
      .prepare('SELECT COUNT(*) AS n FROM monitors WHERE email = ? AND created_at >= ?')
      .bind(email, sinceIso)
      .first();
    // MySQL drivers hand COUNT(*) back as a number, a string or a bigint depending on the broker.
    return Number(row?.n ?? 0);
  }

  async deletePendingOlderThan(beforeIso: string): Promise<number> {
    await this.ensureSchema();
    const outcome = await this.db
      .prepare("DELETE FROM monitors WHERE status = 'pending' AND created_at < ?")
      .bind(beforeIso)
      .run();
    return outcome.meta?.changes ?? 0;
  }

  async list(limit: number): Promise<Monitor[]> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM monitors ORDER BY created_at DESC LIMIT ${clampLimit(limit, MAX_MONITOR_ROWS)}`,
      )
      .all();
    return results.map(rowToMonitor);
  }
}
