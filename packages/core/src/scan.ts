import {
  catalog as defaultCatalog,
  type Catalog,
  type ScanResult,
  RESULT_SCHEMA_ID,
} from '@agentic-readiness/catalog';

import { builtInChecks } from './checks/registry.js';
import type { Check } from './checks/types.js';
import { BudgetedFetcher, type FetchLike } from './http/budgeted-fetcher.js';
import { RobotsGatedFetcher } from './http/robots-gate.js';
import type { Fetcher } from './http/types.js';
import { runChecks } from './runner.js';
import { computeLevel, computeScores } from './scoring.js';
import { resolveTarget } from './target/resolver.js';
import { SCANNER_VERSION } from './version.js';

export interface ScanOptions {
  /** Supply a Fetcher (tests, fixtures) or let the scan build a BudgetedFetcher. */
  fetcher?: Fetcher;
  fetch?: FetchLike;
  budget?: number;
  timeoutMs?: number;
  userAgent?: string;
  /** Profile id override. */
  profile?: string;
  sampleSize?: number;
  checks?: readonly Check[];
  catalog?: Catalog;
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
    });
  // Every fetch after robots.txt is parsed honours the store's rules for the scanner.
  const fetcher = new RobotsGatedFetcher(inner);

  const target = await resolveTarget(inputUrl, fetcher, {
    ...(options.profile !== undefined ? { profile: options.profile } : {}),
    ...(options.sampleSize !== undefined ? { sampleSize: options.sampleSize } : {}),
  });
  const { results } = await runChecks({
    target,
    fetcher,
    checks: options.checks ?? builtInChecks,
    catalog,
  });

  return {
    schema: RESULT_SCHEMA_ID,
    catalog_version: catalog.version,
    scoring_version: catalog.scoring_version,
    scanner_version: SCANNER_VERSION,
    target: {
      input_url: inputUrl,
      url: target.origin,
      platform: target.platform,
      profile: target.profile.id,
      sampled: target.sampled,
    },
    scanned_at: now().toISOString(),
    requests: fetcher.requestCount,
    duration_ms: Date.now() - started,
    level: computeLevel(results, catalog, target.profile.max_level),
    scores: computeScores(results, catalog),
    results,
    warnings: [
      ...target.warnings,
      ...(fetcher.blocked.length > 0
        ? [
            `robots.txt disallows ${fetcher.blocked.length} URL(s) for the scanner's user agent; they were not fetched: ${fetcher.blocked.slice(0, 5).join(', ')}${fetcher.blocked.length > 5 ? ', …' : ''}`,
          ]
        : []),
    ],
  };
}
