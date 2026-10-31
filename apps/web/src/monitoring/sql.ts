import type { SqlDatabase } from '../store/sql.js';
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

interface MonitorRow {
  id: string;
  email: string;
  host: string;
  url: string;
  status: MonitorStatus;
  confirm_token_hash: string;
  manage_token_hash: string;
  created_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  last_checked_at: string | null;
  last_notified_at: string | null;
  baseline: string | null;
}

const COLUMNS =
  'id, email, host, url, status, confirm_token_hash, manage_token_hash, created_at, confirmed_at, unsubscribed_at, last_checked_at, last_notified_at, baseline';

function rowToMonitor(row: MonitorRow): Monitor {
  return {
    id: row.id,
    email: row.email,
    host: row.host,
    url: row.url,
    status: row.status,
    confirmTokenHash: row.confirm_token_hash,
    manageTokenHash: row.manage_token_hash,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    unsubscribedAt: row.unsubscribed_at,
    lastCheckedAt: row.last_checked_at,
    lastNotifiedAt: row.last_notified_at,
    baseline: row.baseline ? (JSON.parse(row.baseline) as Baseline) : null,
  };
}

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(1000, Math.trunc(limit)));
}

export class SqlMonitorStore implements MonitorStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly db: SqlDatabase) {}

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.db
      .prepare(MONITORS_SCHEMA_SQL)
      .run()
      .then(() => undefined);
    return this.schemaReady;
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
    return row ? rowToMonitor(row as unknown as MonitorRow) : null;
  }

  async findByEmailAndHost(email: string, host: string): Promise<Monitor | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM monitors WHERE email = ? AND host = ?`)
      .bind(email, host)
      .first();
    return row ? rowToMonitor(row as unknown as MonitorRow) : null;
  }

  async listDue(before: string, limit: number): Promise<Monitor[]> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM monitors WHERE status = 'active' AND (last_checked_at IS NULL OR last_checked_at < ?) ORDER BY last_checked_at IS NULL DESC, last_checked_at ASC LIMIT ${clampLimit(limit)}`,
      )
      .bind(before)
      .all();
    return results.map((row) => rowToMonitor(row as unknown as MonitorRow));
  }

  async list(limit: number): Promise<Monitor[]> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM monitors ORDER BY created_at DESC LIMIT ${clampLimit(limit)}`,
      )
      .all();
    return results.map((row) => rowToMonitor(row as unknown as MonitorRow));
  }
}
