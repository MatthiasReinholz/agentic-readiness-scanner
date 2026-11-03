import {
  catalog as defaultCatalog,
  type Catalog,
  type CheckResult,
  type LegalResult,
  type Market,
  type ScanResult,
  RESULT_SCHEMA_ID,
} from '@agentic-readiness/catalog';

import { builtInChecks } from './checks/registry.js';
import type { Check } from './checks/types.js';
import { BudgetedFetcher, type FetchLike } from './http/budgeted-fetcher.js';
import { RobotsGatedFetcher } from './http/robots-gate.js';
import type { FetchFailure, Fetcher } from './http/types.js';
import { runLegalChecks } from './legal/run.js';
import { runChecks } from './runner.js';
import { computeLevel, computeScores } from './scoring.js';
import { resolveTarget } from './target/resolver.js';
import type { Target } from './target/types.js';
import { SCANNER_VERSION } from './version.js';
import { emitProgress, type ProgressListener, type ScanProgress } from './progress.js';

export interface ScanOptions {
  /** Supply a Fetcher (tests, fixtures) or let the scan build a BudgetedFetcher. */
  fetcher?: Fetcher;
  fetch?: FetchLike;
  budget?: number;
  timeoutMs?: number;
  userAgent?: string;
  /** Minimum time between two network requests; see BudgetedFetcherOptions. */
  minIntervalMs?: number;
  /** Wall-clock budget for the whole scan in milliseconds; remaining checks are skipped once it is used up. */
  deadlineMs?: number;
  /** Receives progress events with the running request count and elapsed time. */
  onProgress?: (progress: ScanProgress) => void;
  /** Profile id override. */
  profile?: string;
  sampleSize?: number;
  checks?: readonly Check[];
  catalog?: Catalog;
  /** Run the legal-signals checks after the readiness checks (default true). */
  legal?: boolean;
  /** Markets to evaluate legal signals for; detected from public signals when omitted. */
  markets?: readonly Market[];
  /** Override the legal-signals implementations (tests). */
  legalChecks?: readonly Check[];
  now?: () => Date;
}

/**
 * Scans one URL and returns the versioned result object. Deterministic for the same
 * responses: sampling is seeded by hostname and checks run in a fixed order.
 */
export async function scan(inputUrl: string, options: ScanOptions = {}): Promise<ScanResult> {
  const now = options.now ?? (() => new Date());
  const started = Date.now();
  const catalog = options.catalog ?? defaultCatalog;
  const inner: Fetcher =
    options.fetcher ??
    new BudgetedFetcher({
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.budget !== undefined ? { budget: options.budget } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
      ...(options.minIntervalMs !== undefined ? { minIntervalMs: options.minIntervalMs } : {}),
      ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
    });
  // Every fetch after robots.txt is parsed honours the store's rules for the scanner.
  const fetcher = new RobotsGatedFetcher(inner);

  const budget = options.budget ?? 40;
  const listener: ProgressListener | undefined = options.onProgress
    ? (event) => {
        options.onProgress?.({
          ...event,
          requests: fetcher.requestCount,
          budget,
          elapsed_ms: Date.now() - started,
        });
      }
    : undefined;
  const target = await resolveTarget(inputUrl, fetcher, {
    ...(listener ? { onProgress: listener } : {}),
    ...(options.profile !== undefined ? { profile: options.profile } : {}),
    ...(options.sampleSize !== undefined ? { sampleSize: options.sampleSize } : {}),
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
  const { results } = await runChecks({
    ...(listener ? { onProgress: listener } : {}),
    target,
    fetcher,
    checks: options.checks ?? builtInChecks,
    catalog,
  });
  const legal =
    options.legal === false || catalog.legal.checks.length === 0
      ? undefined
      : await runLegalChecks({
          target,
          fetcher,
          catalog,
          ...(options.markets ? { markets: options.markets } : {}),
          ...(options.legalChecks ? { checks: options.legalChecks } : {}),
        });

  return assembleResult({
    inputUrl,
    target,
    catalog,
    results,
    ...(legal ? { legal } : {}),
    requests: fetcher.requestCount,
    durationMs: Date.now() - started,
    scannedAt: now().toISOString(),
    blocked: fetcher.blocked,
    failures: fetcher.failures,
  });
}

/** Everything a finished scan reports, whether it ran in one call or in steps. */
export interface ResultParts {
  inputUrl: string;
  target: Target;
  catalog: Catalog;
  results: CheckResult[];
  legal?: LegalResult;
  requests: number;
  durationMs: number;
  scannedAt: string;
  /** URLs robots.txt kept the scanner from fetching. */
  blocked: readonly string[];
  failures: readonly FetchFailure[];
  /** Resumable scans: how many steps it took. */
  steps?: number;
}

export function assembleResult(parts: ResultParts): ScanResult {
  const { target, catalog, results, blocked } = parts;
  return {
    schema: RESULT_SCHEMA_ID,
    catalog_version: catalog.version,
    scoring_version: catalog.scoring_version,
    scanner_version: SCANNER_VERSION,
    target: {
      input_url: parts.inputUrl,
      url: target.origin,
      platform: target.platform,
      profile: target.profile.id,
      sampled: target.sampled,
    },
    scanned_at: parts.scannedAt,
    requests: parts.requests,
    duration_ms: parts.durationMs,
    ...(parts.steps !== undefined ? { steps: parts.steps } : {}),
    level: computeLevel(results, catalog, target.profile),
    scores: computeScores(results, catalog),
    results,
    warnings: [
      ...target.warnings,
      ...(blocked.length > 0
        ? [
            `robots.txt disallows ${blocked.length} URL(s) for the scanner's user agent; they were not fetched: ${listSome(blocked)}`,
          ]
        : []),
      ...failureWarnings(parts.failures),
    ],
    ...(parts.legal ? { legal: parts.legal } : {}),
  };
}

function listSome(urls: readonly string[], limit = 5): string {
  return `${urls.slice(0, limit).join(', ')}${urls.length > limit ? ', …' : ''}`;
}

/**
 * One warning per request that did not succeed, and one summary when the store rate
 * limited the scan, so a report never stays silent about verdicts taken from a 429 or
 * from an empty response.
 */
function failureWarnings(failures: readonly FetchFailure[]): string[] {
  const warnings = failures.map((failure) => `request failed: ${failure.url} (${failure.reason})`);
  const rateLimited = [...new Set(failures.filter((f) => f.status === 429).map((f) => f.url))];
  if (rateLimited.length > 0) {
    warnings.push(
      `the store answered 429 Too Many Requests on ${rateLimited.length} URL(s); verdicts for those pages reflect the rate limit, not the page: ${listSome(rateLimited)}`,
    );
  }
  return warnings;
}
