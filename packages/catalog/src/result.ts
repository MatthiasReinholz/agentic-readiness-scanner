/**
 * The scan result object: the only contract between the engine and every consumer
 * (reporters, the hosted app, the CLI, the MCP tools, the WordPress plugin).
 * It is versioned by `schema`; breaking changes bump the number.
 */
import { z } from 'zod';

import { CHECK_ID_PATTERN, FixSchema, VerdictSchema, WeightSchema } from './schema.js';

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
  /** Canonical origin after redirects, e.g. https://example.shop */
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
  /** False when the check was skipped because it does not apply to the profile or platform. */
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
  /** One score per catalog group, keyed by group id; null when no check in the group applied. */
  groups: z.record(z.string(), GroupScoreSchema),
});
export type Scores = z.infer<typeof ScoresSchema>;

export const ScanResultSchema = z.object({
  schema: z.literal(RESULT_SCHEMA_ID),
  catalog_version: z.string(),
  scoring_version: z.string(),
  scanner_version: z.string(),
  target: ResultTargetSchema,
  scanned_at: z.iso.datetime(),
  requests: z.number().int().min(0),
  duration_ms: z.number().int().min(0),
  level: LevelResultSchema,
  scores: ScoresSchema,
  results: z.array(CheckResultSchema),
  /** Non-fatal problems during the scan, for example a sitemap that timed out. */
  warnings: z.array(z.string()),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;
