/**
 * The scan result object: the only contract between the engine and every consumer
 * (reporters, the hosted app, the CLI, the MCP tools, external consumers).
 * It is versioned by `schema`; breaking changes bump the number.
 */
import { z } from 'zod';

import {
  CHECK_ID_PATTERN,
  FixSchema,
  MarketSchema,
  VerdictSchema,
  WeightSchema,
} from './schema.js';

export const RESULT_SCHEMA_ID = 'agentic-readiness-scanner/1';

export const PlatformSchema = z.enum(['woocommerce', 'wordpress', 'shopify', 'unknown']);
export type Platform = z.infer<typeof PlatformSchema>;

export const PolicyKindSchema = z.enum([
  'returns',
  'shipping',
  'privacy',
  'terms',
  'imprint',
  'contact',
]);
export type PolicyKind = z.infer<typeof PolicyKindSchema>;

export const SampledPagesSchema = z.object({
  home: z.url(),
  listing: z.url().optional(),
  products: z.array(z.url()),
  policies: z.partialRecord(PolicyKindSchema, z.url()),
});
export type SampledPages = z.infer<typeof SampledPagesSchema>;

export const ResultTargetSchema = z.object({
  input_url: z.string().min(1),
  /** Canonical origin after redirects, e.g. https://example.com */
  url: z.url(),
  platform: PlatformSchema,
  profile: z.string().min(1),
  sampled: SampledPagesSchema,
});
export type ResultTarget = z.infer<typeof ResultTargetSchema>;

export const CheckResultSchema = z.object({
  id: z.string().regex(CHECK_ID_PATTERN),
  group: z.string(),
  title: z.string(),
  weight: WeightSchema,
  verdict: VerdictSchema,
  /**
   * False exactly when `skip_reason` is `not_applicable`: the check had nothing to evaluate
   * on this target, because of the profile, the platform, or the target's shape (for
   * example no product pages were sampled). Every other skip (dependency failed, not
   * implemented, budget, error) is a check that applied but could not be answered.
   */
  applies: z.boolean(),
  /** Why a check was skipped, when it was. */
  skip_reason: z
    .enum(['not_applicable', 'dependency_failed', 'not_implemented', 'budget_exhausted', 'error'])
    .optional(),
  /** Human-readable one-liner about what decided the verdict. */
  message: z.string().optional(),
  /** The URLs and values that decided the verdict. Shape is check-specific but JSON-safe. */
  evidence: z.record(z.string(), z.unknown()),
  /** Present for warn and fail verdicts. */
  fix: FixSchema.optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const LevelResultSchema = z.object({
  value: z.number().int().min(0).max(5),
  name: z.string(),
  /** Check ids standing between the target and the next level. Empty at level 5. */
  next_gate: z.array(z.string().regex(CHECK_ID_PATTERN)),
});
export type LevelResult = z.infer<typeof LevelResultSchema>;

export const GroupScoreSchema = z.number().int().min(0).max(100).nullable();

export const ScoresSchema = z.object({
  ingestion: z.number().int().min(0).max(100),
  /** Null for profiles without the commerce dimension. */
  commerce: z.number().int().min(0).max(100).nullable(),
  /**
   * One score per catalog group, keyed by group id; null when no check in the group applied
   * or when fewer than half of its applicable weight could be answered.
   */
  groups: z.record(z.string(), GroupScoreSchema),
  /**
   * Share of each dimension's applicable weight that the scan answered, 0 to 100. A check
   * counts as unanswered when it applied but could not run (time or request budget, an
   * error, not implemented, or a parent that could not run). Below 50 the dimension is
   * incomplete: commerce is null and ingestion is reported but must not be read as a
   * result. Null when nothing in the dimension applied. Absent on results written before
   * scoring 0.5.0.
   */
  coverage: z
    .object({
      ingestion: z.number().int().min(0).max(100).nullable(),
      commerce: z.number().int().min(0).max(100).nullable(),
    })
    .optional(),
});
export type Scores = z.infer<typeof ScoresSchema>;

/** A market the store appears to sell to, with what showed it. */
export const MarketDetectionSchema = z.object({
  market: MarketSchema,
  /** Human-readable signals: ".de domain", "prices in EUR", "lang de-DE". */
  evidence: z.array(z.string()),
});
export type MarketDetection = z.infer<typeof MarketDetectionSchema>;

/**
 * Legal signals: a technical evaluation of public legal disclosures, never scored and
 * never part of the level. Kept beside `results` so readiness consumers are unaffected.
 */
export const LegalResultSchema = z.object({
  /** Detected from public signals, or chosen by whoever started the scan. */
  markets_source: z.enum(['detected', 'chosen']),
  markets: z.array(MarketDetectionSchema),
  results: z.array(CheckResultSchema),
});
export type LegalResult = z.infer<typeof LegalResultSchema>;

/** Shown with every rendering of legal signals. */
export const LEGAL_NOTICE =
  'Legal signals are a technical evaluation, not legal advice. They show what this scan could read on the store\'s public pages: whether certain disclosures, links and machine-readable signals are present. They cannot tell whether the content is correct or complete, whether a law applies to this business (its size, where it sells, whether it sells to consumers), or anything shown only after JavaScript runs, after signing in or during checkout. Results can be wrong when pages fail to load, render in the browser, block automated access, differ by region or language, or use a setup the scanner does not recognise. "Found" does not mean compliant and "not found" does not mean a breach. Ask a qualified lawyer before relying on them.';

export const ScanResultSchema = z.object({
  schema: z.literal(RESULT_SCHEMA_ID),
  catalog_version: z.string(),
  scoring_version: z.string(),
  scanner_version: z.string(),
  target: ResultTargetSchema,
  scanned_at: z.iso.datetime(),
  requests: z.number().int().min(0),
  /** Active scanning time; for a resumable scan, the sum of its steps without the gaps. */
  duration_ms: z.number().int().min(0),
  /** Resumable scans: the number of steps the scan took. Absent for a scan run in one call. */
  steps: z.number().int().min(1).optional(),
  level: LevelResultSchema,
  scores: ScoresSchema,
  results: z.array(CheckResultSchema),
  /** Non-fatal problems during the scan, for example a sitemap that timed out. */
  warnings: z.array(z.string()),
  /** Legal signals; absent on results written before they existed. */
  legal: LegalResultSchema.optional(),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;
