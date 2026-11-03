/**
 * Resumable scans: one scan run as several short steps, for hosts that must answer each
 * invocation within a fixed time and can store a small state in between. Each step
 * resolves the target again (deterministic for the same responses), takes the outcomes
 * earlier steps decided as they are, and runs the remaining checks until its own time or
 * request allowance is used up. A check cut off by a step allowance is not skipped: it
 * runs again in the next step. Only the scan's overall limits (request budget, number of
 * steps, active time) end checks with the usual `budget_exhausted` skip.
 *
 * The state is plain JSON of a few KiB: versions, settings, counted requests, decided
 * outcomes, politeness and failures. No response bodies; a step re-reads the pages it
 * needs (never counted twice against the budget), or takes them from a ResponseCache
 * the host provides. Split into steps over the same responses, a scan yields the same
 * result as one call to `scan()`, apart from timing and the `steps` count.
 */
import {
  catalog as defaultCatalog,
  type Catalog,
  type LegalResult,
  type Market,
  type ScanResult,
} from '@agentic-readiness/catalog';

import { builtInChecks } from './checks/registry.js';
import type { Check, CheckOutcome } from './checks/types.js';
import { BudgetedFetcher, type FetchLike, type PolitenessState } from './http/budgeted-fetcher.js';
import { RobotsGatedFetcher } from './http/robots-gate.js';
import { StepDeadlineError, type FetchFailure, type ResponseCache } from './http/types.js';
import { runLegalStep } from './legal/run.js';
import { emitProgress, type ProgressListener, type ScanProgress } from './progress.js';
import { runChecks } from './runner.js';
import { assembleResult } from './scan.js';
import { resolveTarget } from './target/resolver.js';
import { SCANNER_VERSION } from './version.js';

export const SCAN_STATE_FORMAT = 'agentic-readiness-scan-state/1';

/** The settings that shape a result; fixed at the first step and kept in the state. */
export interface ResumableSettings {
  budget: number;
  profile?: string;
  sampleSize?: number;
  legal: boolean;
  markets?: Market[];
  timeoutMs?: number;
  minIntervalMs?: number;
  userAgent?: string;
}

/** What a host stores between steps. JSON-serializable; never edit it. */
export interface ScanState {
  format: typeof SCAN_STATE_FORMAT;
  scanner_version: string;
  catalog_version: string;
  scoring_version: string;
  input_url: string;
  settings: ResumableSettings;
  started_at: string;
  /** Active scanning time of the finished steps, in milliseconds. */
  active_ms: number;
  /** Steps finished so far. */
  steps: number;
  /** Consecutive steps that decided no check and sent no new request; see `maxStalledSteps`. */
  stalled_steps: number;
  /** Requests counted so far, by request key, with the sends each took. */
  requests: Record<string, number>;
  politeness: PolitenessState;
  failures: FetchFailure[];
  /** URLs robots.txt kept the scanner from fetching. */
  blocked: string[];
  /** Readiness outcomes decided so far, by check id. */
  outcomes: Record<string, CheckOutcome>;
  /** Legal outcomes decided so far, by check id. */
  legal_outcomes: Record<string, CheckOutcome>;
  /** The markets the legal pass judges, once decided. */
  legal_markets?: Pick<LegalResult, 'markets' | 'markets_source'>;
}

export type ScanStep = { done: false; state: ScanState } | { done: true; result: ScanResult };

export interface ResumableScanOptions {
  /** This step's wall-clock allowance in milliseconds. Leave time to store the state. */
  stepDeadlineMs: number;
  /** Optional: the most requests one step may send (refills included). */
  stepBudget?: number;
  /** Steps after which the scan finishes with the usual skip semantics. Default 10. */
  maxSteps?: number;
  /** Active time across steps after which the scan finishes the same way. */
  maxActiveMs?: number;
  /**
   * Consecutive steps that decide no check and send no new request after which the next step finishes the scan
   * with the usual skip semantics. Without a cache every step re-reads the pages it needs;
   * on a store slow enough that one check cannot fit in a step, more steps would not help.
   * Default 2.
   */
  maxStalledSteps?: number;
  /** Where responses are kept between steps; without one, a step re-reads what it needs. */
  cache?: ResponseCache;
  fetch?: FetchLike;
  checks?: readonly Check[];
  legalChecks?: readonly Check[];
  catalog?: Catalog;
  now?: () => Date;
  /**
   * Receives the step's progress events, with requests and active time counted across
   * steps. Every step resolves the target again and replays the outcomes earlier steps
   * decided, so a host that shows events across steps keeps the first of each.
   */
  onProgress?: (progress: ScanProgress) => void;
}

export interface StartScanOptions extends ResumableScanOptions {
  /** Request budget across all steps. Default 40. */
  budget?: number;
  profile?: string;
  sampleSize?: number;
  legal?: boolean;
  markets?: readonly Market[];
  timeoutMs?: number;
  minIntervalMs?: number;
  userAgent?: string;
}

/** The state was written by another scanner, catalog or scoring version, or is not a state. */
export class ScanStateMismatchError extends Error {
  constructor(reason: string) {
    super(`cannot continue this scan: ${reason}. Start it again`);
    this.name = 'ScanStateMismatchError';
  }
}

const DEFAULT_MAX_STEPS = 10;

/** Starts a resumable scan and runs its first step. */
export async function startScan(inputUrl: string, options: StartScanOptions): Promise<ScanStep> {
  const catalog = options.catalog ?? defaultCatalog;
  const now = options.now ?? (() => new Date());
  const settings: ResumableSettings = {
    budget: options.budget ?? 40,
    legal: options.legal !== false,
    ...(options.profile !== undefined ? { profile: options.profile } : {}),
    ...(options.sampleSize !== undefined ? { sampleSize: options.sampleSize } : {}),
    ...(options.markets ? { markets: [...options.markets] } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.minIntervalMs !== undefined ? { minIntervalMs: options.minIntervalMs } : {}),
    ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
  };
  const state: ScanState = {
    format: SCAN_STATE_FORMAT,
    scanner_version: SCANNER_VERSION,
    catalog_version: catalog.version,
    scoring_version: catalog.scoring_version,
    input_url: inputUrl,
    settings,
    started_at: now().toISOString(),
    active_ms: 0,
    steps: 0,
    stalled_steps: 0,
    requests: {},
    politeness: { interval_ms: settings.minIntervalMs ?? 150, rate_limits: 0, last_sent_at: 0 },
    failures: [],
    blocked: [],
    outcomes: {},
    legal_outcomes: {},
  };
  return runStep(state, options);
}

/** Runs the next step of a scan from the state the previous step returned. */
export async function continueScan(
  state: ScanState,
  options: ResumableScanOptions,
): Promise<ScanStep> {
  const catalog = options.catalog ?? defaultCatalog;
  if (state.format !== SCAN_STATE_FORMAT) throw new ScanStateMismatchError('unknown state format');
  if (state.scanner_version !== SCANNER_VERSION) {
    throw new ScanStateMismatchError(
      `it was started by scanner ${state.scanner_version}, this is ${SCANNER_VERSION}`,
    );
  }
  if (
    state.catalog_version !== catalog.version ||
    state.scoring_version !== catalog.scoring_version
  ) {
    throw new ScanStateMismatchError(
      `it was started with catalog ${state.catalog_version} and scoring ${state.scoring_version}`,
    );
  }
  return runStep(structuredClone(state), options);
}

function unique<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runStep(state: ScanState, options: ResumableScanOptions): Promise<ScanStep> {
  const catalog = options.catalog ?? defaultCatalog;
  const now = options.now ?? (() => new Date());
  const started = Date.now();
  const { settings } = state;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const remainingActive =
    options.maxActiveMs === undefined ? Infinity : options.maxActiveMs - state.active_ms;
  // The last step the limits allow finishes the scan with the usual deadline semantics,
  // and the checks it cannot reach say which limit that was.
  const finalReason =
    state.steps + 1 >= maxSteps
      ? `the scan's limit of ${maxSteps} steps was reached`
      : remainingActive <= options.stepDeadlineMs
        ? `the scan's time budget of ${Math.round((options.maxActiveMs ?? 0) / 1000)} s was used up`
        : state.stalled_steps >= (options.maxStalledSteps ?? 2)
          ? 'the store answered too slowly for the scan to make progress'
          : null;
  // Progress is a newly decided check or a newly counted request: with a cache, a check
  // too long for one step still advances, because what it read is there next time.
  const progress = (): number =>
    Object.keys(state.outcomes).length +
    Object.keys(state.legal_outcomes).length +
    Object.keys(state.requests).length;
  const progressBefore = progress();
  const inner = new BudgetedFetcher({
    budget: settings.budget,
    counted: state.requests,
    politeness: state.politeness,
    failures: state.failures,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
    ...(settings.timeoutMs !== undefined ? { timeoutMs: settings.timeoutMs } : {}),
    ...(settings.minIntervalMs !== undefined ? { minIntervalMs: settings.minIntervalMs } : {}),
    ...(settings.userAgent !== undefined ? { userAgent: settings.userAgent } : {}),
    ...(finalReason !== null
      ? {
          deadlineMs: Math.max(1, Math.min(options.stepDeadlineMs, remainingActive)),
          deadlineReason: finalReason,
        }
      : {
          stepDeadlineMs: options.stepDeadlineMs,
          ...(options.stepBudget !== undefined ? { stepBudget: options.stepBudget } : {}),
        }),
  });
  const fetcher = new RobotsGatedFetcher(inner);
  fetcher.blocked.push(...state.blocked);
  const listener: ProgressListener | undefined = options.onProgress
    ? (event) => {
        options.onProgress?.({
          ...event,
          requests: inner.requestCount,
          budget: settings.budget,
          elapsed_ms: state.active_ms + (Date.now() - started),
        });
      }
    : undefined;

  const pause = (): ScanStep => {
    state.steps += 1;
    state.requests = inner.countedRequests();
    state.stalled_steps = progress() > progressBefore ? 0 : state.stalled_steps + 1;
    state.active_ms += Date.now() - started;
    state.requests = inner.countedRequests();
    state.politeness = inner.politenessState();
    state.failures = [...inner.failures];
    state.blocked = unique([...fetcher.blocked], (url) => url);
    return { done: false, state };
  };

  try {
    const target = await resolveTarget(state.input_url, fetcher, {
      ...(listener ? { onProgress: listener } : {}),
      ...(settings.profile !== undefined ? { profile: settings.profile } : {}),
      ...(settings.sampleSize !== undefined ? { sampleSize: settings.sampleSize } : {}),
    });
    emitProgress(listener, {
      type: 'target',
      origin: target.origin,
      platform: target.platform,
      profile: target.profile.id,
      products: target.sampled.products.length,
      policies: Object.keys(target.sampled.policies).length,
      checks: catalog.checks.length,
    });
    const run = await runChecks({
      ...(listener ? { onProgress: listener } : {}),
      target,
      fetcher,
      checks: options.checks ?? builtInChecks,
      catalog,
      prior: new Map(Object.entries(state.outcomes)),
    });
    state.outcomes = Object.fromEntries(run.outcomes);
    if (run.interrupted) return pause();

    let legal: LegalResult | undefined;
    if (settings.legal && catalog.legal.checks.length > 0) {
      const step = await runLegalStep({
        target,
        fetcher,
        catalog,
        prior: new Map(Object.entries(state.legal_outcomes)),
        ...(state.legal_markets ? { decided: state.legal_markets } : {}),
        ...(settings.markets ? { markets: settings.markets } : {}),
        ...(options.legalChecks ? { checks: options.legalChecks } : {}),
      });
      state.legal_markets = {
        markets: step.legal.markets,
        markets_source: step.legal.markets_source,
      };
      state.legal_outcomes = Object.fromEntries(step.outcomes);
      if (step.interrupted) return pause();
      legal = step.legal;
    }

    const steps = state.steps + 1;
    return {
      done: true,
      result: assembleResult({
        inputUrl: state.input_url,
        target,
        catalog,
        results: run.results,
        ...(legal ? { legal } : {}),
        requests: inner.requestCount,
        durationMs: state.active_ms + (Date.now() - started),
        scannedAt: now().toISOString(),
        blocked: unique([...fetcher.blocked], (url) => url),
        failures: inner.failures,
        steps,
      }),
    };
  } catch (error) {
    if (error instanceof StepDeadlineError) return pause();
    throw error;
  }
}
