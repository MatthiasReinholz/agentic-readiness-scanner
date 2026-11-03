import type { FetchedResponse } from '@agentic-readiness/core';

import { randomHex } from '../ids.js';
import type { ScanJob, ScanJobStore } from './types.js';

interface Row {
  job: ScanJob;
  leaseToken: string | null;
  leaseUntil: string | null;
}

/** In-process jobs for development and tests, with the same lease rules as SQL. */
export class MemoryScanJobStore implements ScanJobStore {
  private readonly rows = new Map<string, Row>();
  private readonly cache = new Map<string, { response: FetchedResponse; createdAt: string }>();

  create(job: ScanJob): Promise<void> {
    this.rows.set(job.id, { job: structuredClone(job), leaseToken: null, leaseUntil: null });
    return Promise.resolve();
  }

  get(id: string): Promise<ScanJob | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? structuredClone(row.job) : null);
  }

  runningForHost(host: string): Promise<ScanJob | null> {
    for (const row of this.rows.values()) {
      if (row.job.host === host && row.job.status === 'running')
        return Promise.resolve(structuredClone(row.job));
    }
    return Promise.resolve(null);
  }

  claim(id: string, now: Date, leaseMs: number): Promise<string | null> {
    const row = this.rows.get(id);
    const time = now.toISOString();
    if (row?.job.status !== 'running') return Promise.resolve(null);
    if (row.leaseUntil !== null && row.leaseUntil > time) return Promise.resolve(null);
    row.leaseToken = randomHex(16);
    row.leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
    row.job.attempts += 1;
    return Promise.resolve(row.leaseToken);
  }

  save(job: ScanJob, leaseToken: string, options: { keepAttempts?: boolean } = {}): Promise<void> {
    const row = this.rows.get(job.id);
    if (row?.leaseToken !== leaseToken) return Promise.resolve();
    row.job = structuredClone({
      ...job,
      attempts: options.keepAttempts ? row.job.attempts : 0,
    });
    row.leaseToken = null;
    row.leaseUntil = null;
    return Promise.resolve();
  }

  stale(before: string, now: string, limit: number): Promise<ScanJob[]> {
    const jobs = [...this.rows.values()]
      .filter(
        (row) =>
          row.job.status === 'running' &&
          row.job.updatedAt < before &&
          (row.leaseUntil === null || row.leaseUntil <= now),
      )
      .map((row) => structuredClone(row.job))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    return Promise.resolve(jobs.slice(0, limit));
  }

  expireRunning(createdBefore: string, now: string): Promise<number> {
    let expired = 0;
    for (const row of this.rows.values()) {
      if (row.job.status === 'running' && row.job.createdAt < createdBefore) {
        row.job = { ...row.job, ...EXPIRED, state: null, updatedAt: now };
        expired += 1;
      }
    }
    return Promise.resolve(expired);
  }

  deleteOlderThan(isoTimestamp: string): Promise<number> {
    let removed = 0;
    for (const [id, row] of this.rows) {
      if (row.job.status !== 'running' && row.job.updatedAt < isoTimestamp) {
        this.rows.delete(id);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
    await this.cacheClear(id);
  }

  async purgeDisposable(isoTimestamp: string): Promise<number> {
    let removed = 0;
    for (const [id, row] of this.rows) {
      if (!row.job.persistent && row.job.updatedAt < isoTimestamp) {
        await this.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  cacheGet(jobId: string, key: string): Promise<FetchedResponse | undefined> {
    return Promise.resolve(this.cache.get(`${jobId}:${key}`)?.response);
  }

  cacheSet(jobId: string, key: string, response: FetchedResponse, now: string): Promise<void> {
    this.cache.set(`${jobId}:${key}`, { response, createdAt: now });
    return Promise.resolve();
  }

  cacheClear(jobId: string): Promise<void> {
    for (const key of this.cache.keys()) if (key.startsWith(`${jobId}:`)) this.cache.delete(key);
    return Promise.resolve();
  }

  cacheDeleteOlderThan(isoTimestamp: string): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (entry.createdAt < isoTimestamp) {
        this.cache.delete(key);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }
}

/** What a job that ran too long without finishing turns into. */
export const EXPIRED = {
  status: 'failed',
  error: 'The scan did not finish in time. Start it again.',
  errorStatus: 504,
} as const;
