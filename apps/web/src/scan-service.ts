import { catalog, type ScanResult } from '@agentic-readiness/catalog';
import {
  BlockedUrlError,
  continueScan,
  ScanStateMismatchError,
  startScan,
  TargetUnreachableError,
  type FetchLike,
  type ResumableScanOptions,
  type ScanState,
  type ScanStep,
  levelLabel,
} from '@agentic-readiness/core';

import type { AppConfig } from './config.js';
import { MemoryScanJobStore } from './jobs/memory.js';
import { ProgressRecorder, type RecordedProgress } from './jobs/progress.js';
import type { ScanJob, ScanJobStore } from './jobs/types.js';
import { scanScope, isRootScan, siteProfilePath } from './scan-scope.js';
import { MemoryScanLimiter } from './rate-limit/memory.js';
import type { ScanLimiter } from './rate-limit/types.js';
import type { HistoryStore } from './history/types.js';
import type { ProgressStore } from './progress/types.js';
import { newScanId } from './ids.js';
import type { ResultStore, StoredScan } from './store/types.js';
import type { TargetRegistry } from './targets/types.js';

/** What running a scan on behalf of a request needs; the app and the MCP route share it. */
export interface ScanDependencies {
  config: AppConfig;
  store: ResultStore;
  /** Durable registry of every host scanned; optional so the app runs without it. */
  targets?: TargetRegistry;
  /** Durable per-host history of distinct states; optional for the same reason. */
  history?: HistoryStore;
  /** Progress of scans in flight, for pages that poll; optional. */
  progress?: ProgressStore;
  /** Production shares one atomic host reservation across HTTP, MCP and monitoring. */
  limiter?: ScanLimiter;
  /** Scans run in steps through durable jobs; in memory when absent (development, tests). */
  jobs?: ScanJobStore;
  /** Test seam: a platform fetch that answers from fixtures instead of the network. */
  fetchFactory?: () => FetchLike;
  /** Test seam: the pause between two requests of a scan; production keeps the scanner's. */
  minIntervalMs?: number;
  now?: () => Date;
}

export interface ScanRequest {
  url: string;
  profile?: string;
  /** The page's progress token: every step of the scan writes its events there. */
  progressToken?: string;
}

export class ScanRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ScanRequestError';
  }
}

const PROFILE_IDS = new Set(catalog.profiles.map((profile) => profile.id));

export function validateScanRequest(input: Record<string, unknown>): ScanRequest {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url) throw new ScanRequestError('A URL is required.', 400);
  const profile =
    typeof input.profile === 'string' && input.profile !== '' ? input.profile : undefined;
  if (profile !== undefined && !PROFILE_IDS.has(profile))
    throw new ScanRequestError(`Unknown profile "${profile}".`, 400);
  return { url, ...(profile !== undefined ? { profile } : {}) };
}

export type FinishedOutcome =
  | { persistence: 'stored'; scan: StoredScan; reused: boolean }
  | { persistence: 'disposable'; result: ScanResult; reused: false };

/** A scan that needs more steps; they run on the next trigger (see advanceJob). */
export interface PendingOutcome {
  persistence: 'pending';
  job: ScanJob;
  reused: boolean;
  /** True when another request held the job's step, so this one ran nothing. */
  busy: boolean;
  /** Checks decided so far, of `total`. */
  decided: number;
  total: number;
}

export type ScanOutcome = FinishedOutcome | PendingOutcome;

/** What a scan request receives as it runs: each new progress event, numbered. */
export type ProgressSink = (event: RecordedProgress) => void;

export interface ScanOrReuseOptions {
  /**
   * Serve a stored root result up to this old instead of scanning (never shorter than
   * the cooldown). Monitoring uses it to pick up a scan that finished after its run.
   */
  reuseWithinSeconds?: number;
}

/** A scan whose next step has not finished: monitoring and MCP say so instead of waiting. */
export class ScanPendingError extends Error {
  constructor(public readonly outcome: PendingOutcome) {
    super(
      `The scan of ${outcome.job.host} is still running (${String(Math.round((100 * outcome.decided) / Math.max(1, outcome.total)))}% of the checks decided). It continues on the server.`,
    );
    this.name = 'ScanPendingError';
  }
}

interface LocalScanState {
  /** First steps this isolate is running, by host, so a second request joins them. */
  starting: Map<string, { persistent: boolean; promise: Promise<ScanOutcome> }>;
  limiter: MemoryScanLimiter;
  jobs: MemoryScanJobStore;
  /** Steps this isolate runs right now. */
  active: number;
}
// Scope state to the result store: app instances and hosted MCP share it, tests stay isolated.
const localStates = new WeakMap<ScanDependencies['store'], LocalScanState>();
function stateFor(deps: ScanDependencies): LocalScanState {
  let state = localStates.get(deps.store);
  if (!state) {
    state = {
      starting: new Map(),
      limiter: new MemoryScanLimiter(),
      jobs: new MemoryScanJobStore(),
      active: 0,
    };
    localStates.set(deps.store, state);
  }
  return state;
}

export function jobsFor(deps: ScanDependencies): ScanJobStore {
  return deps.jobs ?? stateFor(deps).jobs;
}

/** Scan steps this isolate runs at once before answering 503. */
const MAX_CONCURRENT_SCANS = 4;
/** A lease outlives its step by this much, so a step the platform cut off frees it soon. */
const LEASE_MARGIN_MS = 15_000;
/** Claims without a saved step after which a job is given up. */
const MAX_ATTEMPTS = 3;
/** The longest a one-time scan's state or result stays on the server. */
const DISPOSABLE_JOB_MS = 3_600_000;

function retryAfter(createdAt: string, cooldownSeconds: number, now: Date): number {
  return Math.max(
    1,
    Math.ceil((Date.parse(createdAt) + cooldownSeconds * 1000 - now.getTime()) / 1000),
  );
}

/**
 * Root submissions may reuse a root result. Disposable submissions never reuse or
 * persist results. Every new scan reserves the host across scopes before fetching, then
 * runs its first step in this request; a scan that needs more steps comes back pending,
 * and a later request for the same root joins it by running its next step.
 */
export async function scanOrReuse(
  deps: ScanDependencies,
  request: ScanRequest,
  /** Receives the scan's new progress events; a reused result sends none. */
  onProgress?: ProgressSink,
  options: ScanOrReuseOptions = {},
): Promise<ScanOutcome> {
  let scope: ReturnType<typeof scanScope>;
  try {
    scope = scanScope(request.url);
  } catch (error) {
    if (error instanceof BlockedUrlError) throw new ScanRequestError(error.message, 400);
    throw new ScanRequestError('That does not look like a URL.', 400);
  }
  const { host, persistent } = scope;
  const now = deps.now ?? (() => new Date());
  const latest = await deps.store.latestForHost(host);
  // One scan per host per cooldown window, whatever the caller asks for: the window is
  // the only thing standing between this endpoint and a request amplifier, so a profile
  // override does not reopen it. Inside the window the stored result is served.
  const reuseSeconds = Math.max(deps.config.targetCooldownSeconds, options.reuseWithinSeconds ?? 0);
  if (
    persistent &&
    latest &&
    isRootScan(latest) &&
    now().getTime() - Date.parse(latest.createdAt) < reuseSeconds * 1000
  ) {
    return { persistence: 'stored', scan: latest, reused: true };
  }
  const state = stateFor(deps);
  const starting = state.starting.get(host);
  if (starting && persistent && starting.persistent) {
    const outcome = await starting.promise;
    return outcome.persistence === 'disposable' ? outcome : { ...outcome, reused: true };
  }
  if (starting)
    throw new ScanRequestError(
      'A scan of this host is already running. Try again in a minute.',
      429,
      60,
    );
  const jobs = jobsFor(deps);
  const running = await jobs.runningForHost(host);
  if (running) {
    if (persistent && running.persistent) {
      const outcome = await advanceJob(deps, running.id, onProgress, { deliver: true });
      return outcome.persistence === 'disposable' ? outcome : { ...outcome, reused: true };
    }
    throw new ScanRequestError(
      'A scan of this host is already running. Try again in a minute.',
      429,
      60,
    );
  }
  if (state.active >= MAX_CONCURRENT_SCANS) {
    throw new ScanRequestError('The scanner is busy. Try again in a minute.', 503);
  }
  // Reserve synchronously in local state before the first await, then atomically in SQL.
  const first = (async (): Promise<ScanOutcome> => {
    // Also respect an existing persisted scan during rollout from the old limiter.
    if (
      latest &&
      now().getTime() - Date.parse(latest.createdAt) < deps.config.targetCooldownSeconds * 1000
    ) {
      const retry = retryAfter(latest.createdAt, deps.config.targetCooldownSeconds, now());
      throw new ScanRequestError(
        `This host was scanned recently. Try again in ${retry} seconds.`,
        429,
        retry,
      );
    }
    const limit = await (deps.limiter ?? state.limiter).acquire(
      host,
      now(),
      deps.config.targetCooldownSeconds,
    );
    if (!limit.allowed)
      throw new ScanRequestError(
        `This host was scanned recently. Try again in ${limit.retryAfterSeconds} seconds.`,
        429,
        limit.retryAfterSeconds,
      );
    const created = now().toISOString();
    const job: ScanJob = {
      id: newScanId(),
      host,
      url: scope.url,
      ...(request.profile !== undefined ? { profile: request.profile } : {}),
      persistent,
      status: 'running',
      state: null,
      progressToken: request.progressToken ?? null,
      attempts: 0,
      createdAt: created,
      updatedAt: created,
      scanId: null,
      result: null,
      error: null,
      errorStatus: null,
    };
    await jobs.create(job);
    return advanceJob(deps, job.id, onProgress, { deliver: true });
  })();
  state.starting.set(host, { persistent, promise: first });
  try {
    return await first;
  } finally {
    state.starting.delete(host);
  }
}

/** Checks a job's state has decided, and how many the scan will decide. */
function decidedOf(state: ScanState | null): { decided: number; total: number } {
  const total =
    catalog.checks.length + (state?.settings.legal === false ? 0 : catalog.legal.checks.length);
  if (!state) return { decided: 0, total };
  return {
    decided: Object.keys(state.outcomes).length + Object.keys(state.legal_outcomes).length,
    total,
  };
}

/** A running job as a pending outcome. */
export function pendingOutcome(job: ScanJob, busy = false): PendingOutcome {
  return { persistence: 'pending', job, reused: false, busy, ...decidedOf(job.state) };
}

/** The outcome a finished or failed job stands for. */
async function finishedOutcome(
  deps: ScanDependencies,
  job: ScanJob,
  deliver: boolean,
): Promise<FinishedOutcome> {
  if (job.status === 'failed') {
    if (!job.persistent && deliver) await jobsFor(deps).delete(job.id);
    throw new ScanRequestError(
      job.error ?? 'The scan failed. Try again in a minute.',
      job.errorStatus ?? 500,
    );
  }
  if (!job.persistent) {
    if (!job.result) throw new ScanRequestError('This scan is no longer available.', 404);
    // A one-time result is not saved: it goes to the person who asked, then it is gone.
    if (deliver) await jobsFor(deps).delete(job.id);
    return { persistence: 'disposable', result: job.result, reused: false };
  }
  const stored = job.scanId ? await deps.store.get(job.scanId) : null;
  if (!stored) throw new ScanRequestError('This scan is no longer available.', 404);
  return { persistence: 'stored', scan: stored, reused: true };
}

/** The `done` payload pages receive, from the stream, the progress record or a job poll. */
export function donePayload(outcome: FinishedOutcome): Record<string, unknown> {
  const result = outcome.persistence === 'stored' ? outcome.scan.result : outcome.result;
  return {
    persistence: outcome.persistence,
    ...(outcome.persistence === 'stored'
      ? {
          id: outcome.scan.id,
          report_url: siteProfilePath(outcome.scan.host),
          host: outcome.scan.host,
        }
      : { result }),
    reused: outcome.reused,
    scanned_at: result.scanned_at,
    level: result.level,
    level_label: levelLabel(result),
    scores: {
      ingestion: result.scores.ingestion,
      commerce: result.scores.commerce,
      ...(result.scores.coverage ? { coverage: result.scores.coverage } : {}),
    },
    requests: result.requests,
    duration_ms: result.duration_ms,
    ...(result.steps !== undefined ? { steps: result.steps } : {}),
    platform: result.target.platform,
    results: result.results.map((item) => ({ id: item.id, verdict: item.verdict })),
  };
}

function runStep(
  deps: ScanDependencies,
  job: ScanJob,
  options: ResumableScanOptions,
): Promise<ScanStep> {
  const start = () =>
    startScan(job.url, {
      ...options,
      budget: deps.config.scanBudget,
      ...(job.profile !== undefined ? { profile: job.profile } : {}),
      ...(deps.minIntervalMs !== undefined ? { minIntervalMs: deps.minIntervalMs } : {}),
    });
  if (!job.state) return start();
  return continueScan(job.state, options).catch((error: unknown) => {
    // A deploy between two steps changed the scanner or catalog: start over, reading
    // what the earlier steps fetched from the job's cache instead of the store.
    if (error instanceof ScanStateMismatchError) return start();
    throw error;
  });
}

/**
 * Runs the next step of a job when nobody else is running it. Any request may call it:
 * the page that started the scan, the app calling itself after a step, the sweeper cron,
 * or a later request for the same host. The job's lease makes sure only one step runs
 * at a time; a caller that finds it taken gets the job back as pending and busy.
 */
export interface AdvanceOptions {
  /** Cap on this step's allowance, for a caller with less time left than a full step. */
  deadlineMs?: number;
  /**
   * The caller hands a one-time result to the person who asked, so the job is deleted
   * once it has one. Callers that only move the scan along (the app calling itself, the
   * sweeper, the page's continue calls) leave it for the request that shows it.
   */
  deliver?: boolean;
}

export async function advanceJob(
  deps: ScanDependencies,
  jobId: string,
  onProgress?: ProgressSink,
  options: AdvanceOptions = {},
): Promise<ScanOutcome> {
  const jobs = jobsFor(deps);
  const now = deps.now ?? (() => new Date());
  const job = await jobs.get(jobId);
  if (!job) throw new ScanRequestError('This scan is not known. It may have expired.', 404);
  if (job.status !== 'running') return finishedOutcome(deps, job, options.deliver === true);
  const stepMs = Math.min(deps.config.scanStepMs, options.deadlineMs ?? Infinity);
  const lease = await jobs.claim(job.id, now(), stepMs + LEASE_MARGIN_MS);
  if (!lease) return pendingOutcome(job, true);
  const local = stateFor(deps);
  local.active += 1;
  try {
    const recorder = await ProgressRecorder.open(deps.progress, job.progressToken);
    const fail = async (message: string, status: number): Promise<never> => {
      await jobs.save(
        {
          ...job,
          status: 'failed',
          state: null,
          error: message,
          errorStatus: status,
          updatedAt: now().toISOString(),
        },
        lease,
      );
      await jobs.cacheClear(job.id).catch(() => undefined);
      if (!job.persistent && options.deliver) await jobs.delete(job.id);
      await recorder.finish('failure', { message, status });
      throw new ScanRequestError(message, status);
    };
    // `attempts` was read before this claim counted one more.
    if (job.attempts + 1 > MAX_ATTEMPTS)
      return await fail('The scan stopped responding. Start it again in a minute.', 504);
    let step: ScanStep;
    try {
      step = await runStep(deps, job, {
        stepDeadlineMs: stepMs,
        maxSteps: deps.config.scanMaxSteps,
        maxActiveMs: deps.config.scanMaxActiveMs,
        cache: {
          get: (key) => jobs.cacheGet(job.id, key).catch(() => undefined),
          set: (key, response) =>
            jobs.cacheSet(job.id, key, response, now().toISOString()).catch((error: unknown) => {
              // Not fatal: the next step fetches the page again, uncounted.
              console.warn('[scan-cache]', error instanceof Error ? error.message : error);
            }),
        },
        onProgress: (progress) => {
          const event = recorder.emit(progress);
          if (event && onProgress) {
            try {
              onProgress(event);
            } catch {
              // A broken display never breaks a scan.
            }
          }
        },
        now,
        ...(deps.fetchFactory ? { fetch: deps.fetchFactory() } : {}),
      });
    } catch (error) {
      if (error instanceof TargetUnreachableError) return await fail(error.message, 422);
      if (error instanceof BlockedUrlError) return await fail(error.message, 400);
      // Anything else: free the step for the next trigger, which retries it.
      await jobs.save({ ...job, updatedAt: now().toISOString() }, lease, { keepAttempts: true });
      throw error;
    }
    if (!step.done) {
      const next: ScanJob = { ...job, state: step.state, updatedAt: now().toISOString() };
      await jobs.save(next, lease);
      await recorder.flush();
      return pendingOutcome(next);
    }
    const result = step.result;
    let outcome: FinishedOutcome;
    let finished: ScanJob;
    if (job.persistent) {
      const stored: StoredScan = {
        id: newScanId(),
        host: job.host,
        createdAt: now().toISOString(),
        result,
      };
      await deps.store.put(stored);
      await deps.targets?.record(stored);
      await deps.history?.record(stored);
      outcome = { persistence: 'stored', scan: stored, reused: false };
      finished = {
        ...job,
        status: 'done',
        state: null,
        scanId: stored.id,
        updatedAt: stored.createdAt,
      };
    } else {
      outcome = { persistence: 'disposable', result, reused: false };
      finished = { ...job, status: 'done', state: null, result, updatedAt: now().toISOString() };
    }
    await jobs.save(finished, lease);
    await jobs.cacheClear(job.id).catch(() => undefined);
    if (!job.persistent && options.deliver) await jobs.delete(job.id);
    await recorder.finish('done', donePayload(outcome));
    return outcome;
  } finally {
    local.active -= 1;
  }
}

export interface SweepReport {
  stale: number;
  advanced: number;
  finished: number;
  failed: number;
}

/**
 * The sweeper's run: steps for running jobs nobody advanced lately (the page closed, the
 * app could not call itself), oldest first, as many as fit in the time given.
 */
export async function sweepJobs(deps: ScanDependencies, budgetMs: number): Promise<SweepReport> {
  const jobs = jobsFor(deps);
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const at = now();
  const before = new Date(at.getTime() - deps.config.scanStepMs - 5_000).toISOString();
  // One-time scans older than an hour go, delivered or not (the sweeper runs hourly).
  await jobs.purgeDisposable(new Date(at.getTime() - DISPOSABLE_JOB_MS).toISOString());
  const stale = await jobs.stale(before, at.toISOString(), 5);
  const report: SweepReport = { stale: stale.length, advanced: 0, finished: 0, failed: 0 };
  for (const job of stale) {
    // Each step needs a few seconds beyond its allowance to store what it did.
    const left = budgetMs - (Date.now() - started) - 4_000;
    if (left < 5_000) break;
    try {
      const outcome = await advanceJob(deps, job.id, undefined, { deadlineMs: left });
      if (outcome.persistence === 'pending') {
        if (!outcome.busy) report.advanced += 1;
      } else report.finished += 1;
    } catch (error) {
      report.failed += 1;
      console.warn('[scan-sweep]', job.id, error instanceof Error ? error.message : error);
    }
  }
  return report;
}
