import type { ScanResult } from '@agentic-readiness/catalog';
import type { FetchedResponse, ScanState } from '@agentic-readiness/core';

import { randomHex } from '../ids.js';
import { RowReader, SqlStore, clampLimit, type SqlDatabase } from '../store/sql-store.js';
import { attachFixes, stripFixes } from '../store/sql.js';
import { packJson, unpackJson } from './codec.js';
import { EXPIRED } from './memory.js';
import type { ScanJob, ScanJobStatus, ScanJobStore } from './types.js';

/** One row per scan in progress or recently finished; cleanup removes them after a day. */
export const SCAN_JOBS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS scan_jobs (
  id CHAR(16) NOT NULL PRIMARY KEY,
  host VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  profile VARCHAR(64) NULL,
  persistent TINYINT NOT NULL,
  status VARCHAR(16) NOT NULL,
  state_json MEDIUMTEXT NULL,
  progress_token CHAR(32) NULL,
  attempts INT NOT NULL DEFAULT 0,
  lease_token CHAR(32) NULL,
  lease_until VARCHAR(32) NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  scan_id CHAR(16) NULL,
  result_json MEDIUMTEXT NULL,
  error TEXT NULL,
  error_status INT NULL,
  INDEX idx_scan_jobs_host (host, status),
  INDEX idx_scan_jobs_status (status, updated_at)
)`;

/** Responses per job, gzipped; removed when the job ends and by cleanup after two hours. */
export const SCAN_JOB_CACHE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS scan_job_cache (
  job_id CHAR(16) NOT NULL,
  request_key VARCHAR(32) NOT NULL,
  response MEDIUMTEXT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (job_id, request_key),
  INDEX idx_scan_job_cache_created (created_at)
)`;

/** Larger packed responses are not cached: the next step fetches them again instead. */
const MAX_CACHED_CHARS = 1024 * 1024;

const COLUMNS =
  'id, host, url, profile, persistent, status, state_json, progress_token, attempts, created_at, updated_at, scan_id, result_json, error, error_status';

function toJob(row: Record<string, unknown>): ScanJob {
  const reader = new RowReader('scan_jobs', row);
  const profile = reader.nullableString('profile');
  const state = reader.nullableString('state_json');
  const result = reader.nullableString('result_json');
  return {
    id: reader.string('id'),
    host: reader.string('host'),
    url: reader.string('url'),
    ...(profile !== null ? { profile } : {}),
    persistent: reader.number('persistent') === 1,
    status: reader.string('status') as ScanJobStatus,
    state: state ? (JSON.parse(state) as ScanState) : null,
    progressToken: reader.nullableString('progress_token'),
    attempts: reader.number('attempts'),
    createdAt: reader.string('created_at'),
    updatedAt: reader.string('updated_at'),
    scanId: reader.nullableString('scan_id'),
    result: result ? attachFixes(JSON.parse(result) as ScanResult) : null,
    error: reader.nullableString('error'),
    errorStatus: reader.nullableNumber('error_status'),
  };
}

/**
 * Jobs in the Space's database. The lease is a conditional UPDATE followed by a read of
 * the token, the same pattern as the scan limiter: no read-then-write window across
 * isolates, and no reliance on affected-row counts.
 */
export class SqlScanJobStore extends SqlStore implements ScanJobStore {
  private readonly cacheTable: CacheTable;

  constructor(db: SqlDatabase) {
    super(db, SCAN_JOBS_SCHEMA_SQL);
    this.cacheTable = new CacheTable(db);
  }

  async create(job: ScanJob): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT INTO scan_jobs (id, host, url, profile, persistent, status, state_json, progress_token, attempts, created_at, updated_at, scan_id, result_json, error, error_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        job.id,
        job.host,
        job.url,
        job.profile ?? null,
        job.persistent ? 1 : 0,
        job.status,
        job.state ? JSON.stringify(job.state) : null,
        job.progressToken,
        job.attempts,
        job.createdAt,
        job.updatedAt,
        job.scanId,
        job.result ? JSON.stringify(stripFixes(job.result)) : null,
        job.error,
        job.errorStatus,
      )
      .run();
  }

  async get(id: string): Promise<ScanJob | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM scan_jobs WHERE id = ?`)
      .bind(id)
      .first();
    return row ? toJob(row) : null;
  }

  async runningForHost(host: string): Promise<ScanJob | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM scan_jobs WHERE host = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(host)
      .first();
    return row ? toJob(row) : null;
  }

  async claim(id: string, now: Date, leaseMs: number): Promise<string | null> {
    await this.ensureSchema();
    const token = randomHex(16);
    const time = now.toISOString();
    const until = new Date(now.getTime() + leaseMs).toISOString();
    await this.db
      .prepare(
        `UPDATE scan_jobs SET lease_token = ?, lease_until = ?, attempts = attempts + 1
         WHERE id = ? AND status = 'running' AND (lease_until IS NULL OR lease_until <= ?)`,
      )
      .bind(token, until, id, time)
      .run();
    const row = await this.db
      .prepare('SELECT lease_token FROM scan_jobs WHERE id = ?')
      .bind(id)
      .first();
    if (!row) return null;
    return new RowReader('scan_jobs', row).nullableString('lease_token') === token ? token : null;
  }

  async save(job: ScanJob, leaseToken: string, options: { keepAttempts?: boolean } = {}) {
    await this.ensureSchema();
    await this.db
      .prepare(
        `UPDATE scan_jobs SET status = ?, state_json = ?, attempts = ${options.keepAttempts ? 'attempts' : '0'},
           lease_token = NULL, lease_until = NULL, updated_at = ?, scan_id = ?, result_json = ?, error = ?, error_status = ?
         WHERE id = ? AND lease_token = ?`,
      )
      .bind(
        job.status,
        job.state ? JSON.stringify(job.state) : null,
        job.updatedAt,
        job.scanId,
        job.result ? JSON.stringify(stripFixes(job.result)) : null,
        job.error,
        job.errorStatus,
        job.id,
        leaseToken,
      )
      .run();
  }

  async stale(before: string, now: string, limit: number): Promise<ScanJob[]> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM scan_jobs
         WHERE status = 'running' AND updated_at < ? AND (lease_until IS NULL OR lease_until <= ?)
         ORDER BY updated_at ASC LIMIT ${clampLimit(limit, 20)}`,
      )
      .bind(before, now)
      .all();
    return results.map(toJob);
  }

  async expireRunning(createdBefore: string, now: string): Promise<number> {
    await this.ensureSchema();
    const outcome = await this.db
      .prepare(
        `UPDATE scan_jobs SET status = ?, error = ?, error_status = ?, state_json = NULL, lease_token = NULL, lease_until = NULL, updated_at = ?
         WHERE status = 'running' AND created_at < ?`,
      )
      .bind(EXPIRED.status, EXPIRED.error, EXPIRED.errorStatus, now, createdBefore)
      .run();
    return outcome.meta?.changes ?? 0;
  }

  async deleteOlderThan(isoTimestamp: string): Promise<number> {
    await this.ensureSchema();
    const outcome = await this.db
      .prepare(`DELETE FROM scan_jobs WHERE status <> 'running' AND updated_at < ?`)
      .bind(isoTimestamp)
      .run();
    return outcome.meta?.changes ?? 0;
  }

  async delete(id: string): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare('DELETE FROM scan_jobs WHERE id = ?').bind(id).run();
    await this.cacheTable.clear(id);
  }

  async purgeDisposable(isoTimestamp: string): Promise<number> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare('SELECT id FROM scan_jobs WHERE persistent = 0 AND updated_at < ? LIMIT 100')
      .bind(isoTimestamp)
      .all();
    for (const row of results) await this.delete(new RowReader('scan_jobs', row).string('id'));
    return results.length;
  }

  cacheGet(jobId: string, key: string): Promise<FetchedResponse | undefined> {
    return this.cacheTable.get(jobId, key);
  }

  cacheSet(jobId: string, key: string, response: FetchedResponse, now: string): Promise<void> {
    return this.cacheTable.set(jobId, key, response, now);
  }

  cacheClear(jobId: string): Promise<void> {
    return this.cacheTable.clear(jobId);
  }

  cacheDeleteOlderThan(isoTimestamp: string): Promise<number> {
    return this.cacheTable.deleteOlderThan(isoTimestamp);
  }
}

class CacheTable extends SqlStore {
  constructor(db: SqlDatabase) {
    super(db, SCAN_JOB_CACHE_SCHEMA_SQL);
  }

  async get(jobId: string, key: string): Promise<FetchedResponse | undefined> {
    await this.ensureSchema();
    const row = await this.db
      .prepare('SELECT response FROM scan_job_cache WHERE job_id = ? AND request_key = ?')
      .bind(jobId, key)
      .first();
    if (!row) return undefined;
    return (await unpackJson(new RowReader('scan_job_cache', row).string('response'))) as
      FetchedResponse | undefined;
  }

  async set(jobId: string, key: string, response: FetchedResponse, now: string): Promise<void> {
    await this.ensureSchema();
    const packed = await packJson(response);
    if (packed.length > MAX_CACHED_CHARS) return;
    await this.db
      .prepare(
        `INSERT INTO scan_job_cache (job_id, request_key, response, created_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE response = VALUES(response), created_at = VALUES(created_at)`,
      )
      .bind(jobId, key, packed, now)
      .run();
  }

  async clear(jobId: string): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare('DELETE FROM scan_job_cache WHERE job_id = ?').bind(jobId).run();
  }

  async deleteOlderThan(isoTimestamp: string): Promise<number> {
    await this.ensureSchema();
    const outcome = await this.db
      .prepare('DELETE FROM scan_job_cache WHERE created_at < ?')
      .bind(isoTimestamp)
      .run();
    return outcome.meta?.changes ?? 0;
  }
}
