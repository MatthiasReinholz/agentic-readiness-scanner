import { catalog, type ScanResult } from '@agentic-readiness/catalog';
import {
  BlockedUrlError,
  scan,
  TargetUnreachableError,
  type Fetcher,
  type ScanOptions,
  type ScanProgress,
} from '@agentic-readiness/core';

import type { AppConfig } from './config.js';
import { scanScope, isRootScan } from './scan-scope.js';
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
  /** Test seam: supply a Fetcher factory to answer from fixtures instead of the network. */
  fetcherFactory?: () => Fetcher;
  now?: () => Date;
}

export interface ScanRequest {
  url: string;
  profile?: string;
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

export type ScanOutcome =
  | { persistence: 'stored'; scan: StoredScan; reused: boolean }
  | { persistence: 'disposable'; result: ScanResult; reused: false };

interface LocalScanState {
  running: Map<string, { persistent: boolean; promise: Promise<ScanOutcome> }>;
  limiter: MemoryScanLimiter;
}
// Scope state to the result store: app instances and hosted MCP share it, tests stay isolated.
const localStates = new WeakMap<ScanDependencies['store'], LocalScanState>();
function stateFor(deps: ScanDependencies): LocalScanState {
  let state = localStates.get(deps.store);
  if (!state) {
    state = { running: new Map(), limiter: new MemoryScanLimiter() };
    localStates.set(deps.store, state);
  }
  return state;
}
/** Scans this isolate runs at once before answering 503. */
const MAX_CONCURRENT_SCANS = 4;

/**
 * Root submissions may reuse a root result. Disposable submissions never reuse or
 * persist results. Every new scan reserves the host across scopes before fetching.
 */
export async function scanOrReuse(
  deps: ScanDependencies,
  request: ScanRequest,
  /** Receives the scan's progress events; a reused or shared scan sends none. */
  onProgress?: (progress: ScanProgress) => void,
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
  if (
    persistent &&
    latest &&
    isRootScan(latest) &&
    now().getTime() - Date.parse(latest.createdAt) < deps.config.targetCooldownSeconds * 1000
  ) {
    return { persistence: 'stored', scan: latest, reused: true };
  }
  const state = stateFor(deps);
  const inFlight = state.running.get(host);
  if (inFlight && persistent && inFlight.persistent) {
    const outcome = await inFlight.promise;
    return outcome.persistence === 'stored' ? { ...outcome, reused: true } : outcome;
  }
  if (inFlight)
    throw new ScanRequestError(
      'A scan of this host is already running. Try again in a minute.',
      429,
      60,
    );
  if (state.running.size >= MAX_CONCURRENT_SCANS) {
    throw new ScanRequestError('The scanner is busy; try again in a minute.', 503);
  }
  // Reserve synchronously in local state before the first await, then atomically in SQL.
  const running = (async (): Promise<ScanOutcome> => {
    // Also respect an existing persisted scan during rollout from the old limiter.
    if (
      latest &&
      now().getTime() - Date.parse(latest.createdAt) < deps.config.targetCooldownSeconds * 1000
    ) {
      const retry = Math.max(
        1,
        Math.ceil(
          (Date.parse(latest.createdAt) +
            deps.config.targetCooldownSeconds * 1000 -
            now().getTime()) /
            1000,
        ),
      );
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
    const result = await performScan(deps, { ...request, url: scope.url }, now, onProgress);
    if (!persistent) return { persistence: 'disposable', result, reused: false };
    const stored: StoredScan = { id: newScanId(), host, createdAt: now().toISOString(), result };
    await deps.store.put(stored);
    await deps.targets?.record(stored);
    await deps.history?.record(stored);
    return { persistence: 'stored', scan: stored, reused: false };
  })();
  state.running.set(host, { persistent, promise: running });
  try {
    return await running;
  } finally {
    state.running.delete(host);
  }
}

async function performScan(
  deps: ScanDependencies,
  request: ScanRequest,
  now: () => Date,
  onProgress?: (progress: ScanProgress) => void,
): Promise<ScanResult> {
  const options: ScanOptions = {
    ...(onProgress ? { onProgress } : {}),
    budget: deps.config.scanBudget,
    deadlineMs: deps.config.scanDeadlineMs,
    now,
    ...(deps.fetcherFactory ? { fetcher: deps.fetcherFactory() } : {}),
    ...(request.profile !== undefined ? { profile: request.profile } : {}),
  };
  let result: ScanResult;
  try {
    result = await scan(request.url, options);
  } catch (error) {
    if (error instanceof TargetUnreachableError) throw new ScanRequestError(error.message, 422);
    if (error instanceof BlockedUrlError) throw new ScanRequestError(error.message, 400);
    throw error;
  }
  return result;
}
