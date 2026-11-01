import { catalog, type ScanResult } from '@agentic-readiness/catalog';
import {
  BlockedUrlError,
  normalizeInputUrl,
  scan,
  TargetUnreachableError,
  type Fetcher,
  type ScanOptions,
} from '@agentic-readiness/core';

import type { AppConfig } from './config.js';
import type { HistoryStore } from './history/types.js';
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

/** Scans in progress on this isolate, by host: parallel submissions share one scan. */
const inFlightScans = new Map<string, Promise<StoredScan>>();
/** Scans this isolate runs at once before answering 503. */
const MAX_CONCURRENT_SCANS = 4;

/**
 * Runs or reuses a scan. A target host is scanned at most once per cooldown window;
 * within it the stored result is returned so repeated submissions cost nothing.
 */
export async function scanOrReuse(
  deps: ScanDependencies,
  request: ScanRequest,
): Promise<{ scan: StoredScan; reused: boolean }> {
  let host: string;
  try {
    host = normalizeInputUrl(request.url).hostname.toLowerCase();
  } catch {
    throw new ScanRequestError('That does not look like a URL.', 400);
  }
  const now = deps.now ?? (() => new Date());
  const latest = await deps.store.latestForHost(host);
  // One scan per host per cooldown window, whatever the caller asks for: the window is
  // the only thing standing between this endpoint and a request amplifier, so a profile
  // override does not reopen it. Inside the window the stored result is served.
  if (
    latest &&
    now().getTime() - Date.parse(latest.createdAt) < deps.config.targetCooldownSeconds * 1000
  ) {
    return { scan: latest, reused: true };
  }
  const inFlight = inFlightScans.get(host);
  if (inFlight) return inFlight.then((scan) => ({ scan, reused: true }));
  if (inFlightScans.size >= MAX_CONCURRENT_SCANS) {
    throw new ScanRequestError('The scanner is busy; try again in a minute.', 503);
  }
  const running = performScan(deps, request, host, now);
  inFlightScans.set(host, running);
  try {
    return { scan: await running, reused: false };
  } finally {
    inFlightScans.delete(host);
  }
}

async function performScan(
  deps: ScanDependencies,
  request: ScanRequest,
  host: string,
  now: () => Date,
): Promise<StoredScan> {
  const options: ScanOptions = {
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
  const stored: StoredScan = { id: newScanId(), host, createdAt: now().toISOString(), result };
  await deps.store.put(stored);
  await deps.targets?.record(stored);
  await deps.history?.record(stored);
  return stored;
}
