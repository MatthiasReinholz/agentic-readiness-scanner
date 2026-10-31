import type { CheckDefinition, Verdict } from '@agentic-readiness/catalog';

import type { Fetcher } from '../http/types.js';
import type { Target } from '../target/types.js';

export type SkipReason =
  'not_applicable' | 'dependency_failed' | 'not_implemented' | 'budget_exhausted' | 'error';

export type Evidence = Record<string, unknown>;

export interface CheckOutcome {
  verdict: Verdict;
  message?: string;
  evidence: Evidence;
  skipReason?: SkipReason;
}

export interface CheckContext {
  target: Target;
  fetcher: Fetcher;
  definition: CheckDefinition;
  /** Outcomes of checks that already ran, by id. */
  outcomes: ReadonlyMap<string, CheckOutcome>;
}

/**
 * One check: one question, one verdict, one fix. The definition (title, weight, fix,
 * dependencies) lives in the catalog; the implementation only produces an outcome.
 */
export interface Check {
  readonly id: string;
  run(context: CheckContext): Promise<CheckOutcome>;
}

export function pass(message: string, evidence: Evidence = {}): CheckOutcome {
  return { verdict: 'pass', message, evidence };
}

export function warn(message: string, evidence: Evidence = {}): CheckOutcome {
  return { verdict: 'warn', message, evidence };
}

export function fail(message: string, evidence: Evidence = {}): CheckOutcome {
  return { verdict: 'fail', message, evidence };
}

export function skip(
  skipReason: SkipReason,
  message: string,
  evidence: Evidence = {},
): CheckOutcome {
  return { verdict: 'skip', message, evidence, skipReason };
}

/** Checks that need no fetch may return the outcome directly; the runner always awaits. */
export function defineCheck(
  id: string,
  run: (context: CheckContext) => CheckOutcome | Promise<CheckOutcome>,
): Check {
  return { id, run: async (context) => await run(context) };
}

/** Verdict from a pass ratio: all pass, most warn, otherwise fail. */
export function verdictForRatio(passed: number, total: number, warnAbove = 0.5): Verdict {
  if (total === 0) return 'fail';
  const ratio = passed / total;
  if (ratio >= 1) return 'pass';
  if (ratio > warnAbove) return 'warn';
  return 'fail';
}

/** The outcome for a pass ratio with one message, so ratio checks share the mapping. */
export function outcomeForRatio(
  passed: number,
  total: number,
  message: string,
  evidence: Evidence = {},
  warnAbove = 0.5,
): CheckOutcome {
  return { verdict: verdictForRatio(passed, total, warnAbove), message, evidence };
}
