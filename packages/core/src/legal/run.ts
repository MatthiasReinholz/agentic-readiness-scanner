/**
 * The legal-signals pass: decide the markets, then run the legal checks against the
 * same target and fetcher as the readiness checks, after them. Pages the readiness checks
 * read are cached, so most legal checks cost no request; when the time or request budget
 * is gone, the remaining legal checks are reported as not run.
 */
import {
  catalog as defaultCatalog,
  legalCatalog,
  type Catalog,
  type LegalResult,
  type Market,
  type MarketDetection,
} from '@agentic-readiness/catalog';

import { legalChecks } from '../checks/legal/index.js';
import { productPages } from '../checks/shared.js';
import type { Check, CheckOutcome } from '../checks/types.js';
import { StepDeadlineError, type Fetcher } from '../http/types.js';
import { runChecks } from '../runner.js';
import type { Target } from '../target/types.js';
import { detectMarkets } from './markets.js';

export interface LegalRunOptions {
  target: Target;
  fetcher: Fetcher;
  /** Markets chosen by whoever started the scan; detection is skipped when given. */
  markets?: readonly Market[];
  checks?: readonly Check[];
  catalog?: Catalog;
}

export interface LegalStepOptions extends LegalRunOptions {
  /** Markets an earlier step decided, so every step judges the same ones. */
  decided?: Pick<LegalResult, 'markets' | 'markets_source'>;
  /** Legal outcomes an earlier step decided. */
  prior?: ReadonlyMap<string, CheckOutcome>;
}

export interface LegalStepOutput {
  legal: LegalResult;
  outcomes: Map<string, CheckOutcome>;
  interrupted: boolean;
}

export async function runLegalChecks(options: LegalRunOptions): Promise<LegalResult> {
  return (await runLegalStep(options)).legal;
}

/** The legal pass, resumable: it can start from earlier outcomes and stop at a step deadline. */
export async function runLegalStep(options: LegalStepOptions): Promise<LegalStepOutput> {
  const catalog = options.catalog ?? defaultCatalog;
  const { target, fetcher } = options;
  let markets: MarketDetection[];
  let source: LegalResult['markets_source'];
  if (options.decided) {
    source = options.decided.markets_source;
    markets = options.decided.markets;
  } else if (options.markets && options.markets.length > 0) {
    source = 'chosen';
    markets = options.markets.map((market) => ({ market, evidence: ['chosen for this scan'] }));
  } else {
    source = 'detected';
    let docs = [target.homeDoc];
    if (!target.blocked) {
      try {
        const pages = await productPages(target, fetcher);
        docs = [...docs, ...pages.filter((page) => page.readable).map((page) => page.doc)];
      } catch (error) {
        if (error instanceof StepDeadlineError) throw error;
        // Out of budget: the home page alone decides the markets.
      }
    }
    markets = detectMarkets(target.hostname, docs);
  }
  const legalTarget: Target = { ...target, markets: markets.map((item) => item.market) };
  const { results, outcomes, interrupted } = await runChecks({
    target: legalTarget,
    fetcher,
    checks: options.checks ?? legalChecks,
    catalog: legalCatalog(catalog),
    ...(options.prior ? { prior: options.prior } : {}),
  });
  return { legal: { markets_source: source, markets, results }, outcomes, interrupted };
}
