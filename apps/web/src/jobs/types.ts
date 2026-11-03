import type { ScanResult } from '@agentic-readiness/catalog';
import type { FetchedResponse, ScanState } from '@agentic-readiness/core';

/**
 * A hosted scan runs as a job: a row that holds the resumable scan state between steps.
 * Every request the platform gives the app must answer within 30 seconds, so a scan
 * that needs longer runs one step per request, and whichever request comes next (the
 * page, the app calling itself, the sweeper cron, the next visitor) runs the next step.
 */
export type ScanJobStatus = 'running' | 'done' | 'failed';

export interface ScanJob {
  /** Sixteen lower-case hex digits, like scan ids. */
  id: string;
  host: string;
  /** The URL being scanned, as the scope resolved it. */
  url: string;
  profile?: string;
  /** Root scans are stored as the host's profile; others stay one-time results. */
  persistent: boolean;
  status: ScanJobStatus;
  /** The resumable state after the last finished step; null before the first and once done. */
  state: ScanState | null;
  /** The page's progress token, so steps run by anyone show on the page that started it. */
  progressToken: string | null;
  /** Claims since the last saved step: a step the platform cut off saves nothing. */
  attempts: number;
  createdAt: string;
  updatedAt: string;
  /** The stored scan, once a root scan is done. */
  scanId: string | null;
  /** The result of a one-time scan, kept until it reached the person who asked; the hourly sweeper removes it once an hour old. */
  result: ScanResult | null;
  /** Why the scan failed, in words for the page. */
  error: string | null;
  /** HTTP status that goes with `error`. */
  errorStatus: number | null;
}

export interface ScanJobStore {
  create(job: ScanJob): Promise<void>;
  get(id: string): Promise<ScanJob | null>;
  /** The running job for a host, if any. */
  runningForHost(host: string): Promise<ScanJob | null>;
  /**
   * Takes the job's lease for one step when it is running and its lease is free (never
   * taken, released, or expired). Returns the lease token, or null when someone else
   * holds it. Counts an attempt.
   */
  claim(id: string, now: Date, leaseMs: number): Promise<string | null>;
  /**
   * Writes the job after a step and releases the lease. Only the lease holder writes:
   * a step whose lease expired and was taken over changes nothing.
   */
  save(job: ScanJob, leaseToken: string, options?: { keepAttempts?: boolean }): Promise<void>;
  /** Running jobs nobody advanced since `before` whose lease is free at `now`, oldest first. */
  stale(before: string, now: string, limit: number): Promise<ScanJob[]>;
  /** Marks running jobs created before the timestamp as failed; returns how many. */
  expireRunning(createdBefore: string, now: string): Promise<number>;
  /** Removes finished and failed jobs last written before the timestamp. */
  deleteOlderThan(isoTimestamp: string): Promise<number>;
  /** Removes a job and its cached responses: a one-time result once it reached the person. */
  delete(id: string): Promise<void>;
  /** Removes one-time jobs (running or not) last written before the timestamp, with their caches. */
  purgeDisposable(isoTimestamp: string): Promise<number>;

  /** Responses a job's steps fetched, so the next step reads them instead of the store. */
  cacheGet(jobId: string, key: string): Promise<FetchedResponse | undefined>;
  cacheSet(jobId: string, key: string, response: FetchedResponse, now: string): Promise<void>;
  cacheClear(jobId: string): Promise<void>;
  cacheDeleteOlderThan(isoTimestamp: string): Promise<number>;
}

/** Job ids are sixteen lower-case hex digits. */
export const JOB_ID = /^[0-9a-f]{16}$/;
