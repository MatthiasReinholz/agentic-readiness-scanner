/**
 * Large JSON columns: a scan's result, its resumable state between steps, and a page's
 * progress record. Spacefast's database broker refuses any operation above 64 KiB, and
 * these grow with the evidence a scan collects: a finished scan of reynborg.de is 72 KB as
 * plain JSON, so its INSERT was refused and the scan could never finish. Packed (gzip,
 * base64) the same result is about a sixth of that.
 *
 * Values are written packed behind a prefix and read in either form, so rows written as
 * plain JSON before keep working. Base64 never contains the prefix's colon and JSON never
 * starts with a letter, so the two cannot be confused.
 */
import { packJson, unpackJson } from './codec.js';
import { MAX_OPERATION_BYTES } from './sql-store.js';

const PACKED_PREFIX = 'gz:';

/**
 * Characters one packed column may take: the operation limit less room for the SQL text
 * and the statement's other values. Base64 is one byte per character and needs no JSON
 * escaping, so characters are bytes here. Statements carry at most one such column at a
 * time, except the progress record, which splits this budget between its two.
 */
export const JSON_COLUMN_BUDGET = MAX_OPERATION_BYTES - 8 * 1024;

/** A value that does not fit its column even packed and shrunk as far as it goes. */
export class JsonColumnTooLargeError extends Error {
  constructor(column: string, chars: number, budget: number) {
    super(`${column} is ${chars} characters packed; the column takes at most ${budget}`);
    this.name = 'JsonColumnTooLargeError';
  }
}

export async function encodeJsonColumn(value: unknown): Promise<string> {
  return PACKED_PREFIX + (await packJson(value));
}

export async function decodeJsonColumn(text: string): Promise<unknown> {
  if (text.startsWith(PACKED_PREFIX)) return unpackJson(text.slice(PACKED_PREFIX.length));
  return JSON.parse(text) as unknown;
}

/**
 * Packs a value for a column of `budget` characters. While it does not fit, `shrink`
 * returns a smaller version (or null when nothing more can go), so a pathological scan is
 * stored with less evidence instead of not at all. Throws when even that does not fit, so
 * the broker is never sent a statement it would refuse.
 */
export async function fitJsonColumn<T>(
  column: string,
  value: T,
  budget: number = JSON_COLUMN_BUDGET,
  shrink?: (value: T) => T | null,
): Promise<string> {
  let current = value;
  for (;;) {
    const packed = await encodeJsonColumn(current);
    if (packed.length <= budget) return packed;
    const smaller = shrink?.(current) ?? null;
    if (smaller === null) throw new JsonColumnTooLargeError(column, packed.length, budget);
    console.warn(`[sql] ${column} is ${packed.length} characters packed; storing less evidence`);
    current = smaller;
  }
}

/** Evidence that was dropped to fit, with the size it had, so a reader sees it was there. */
export interface OmittedEvidence {
  omitted: string;
}

interface WithEvidence {
  evidence: Record<string, unknown>;
}

function isOmitted(evidence: Record<string, unknown>): boolean {
  return Object.keys(evidence).length === 1 && typeof evidence.omitted === 'string';
}

/**
 * Replaces the largest evidence among the given outcomes, in place on a copy the caller
 * made, with a note of its size. Returns false when every evidence is already a note.
 * Verdicts and messages always stay; only the details behind them go.
 */
export function omitLargestEvidence(items: readonly WithEvidence[]): boolean {
  let largest: WithEvidence | null = null;
  let largestSize = 0;
  for (const item of items) {
    if (isOmitted(item.evidence)) continue;
    const size = JSON.stringify(item.evidence).length;
    if (size > largestSize) {
      largest = item;
      largestSize = size;
    }
  }
  if (largest === null || largestSize <= 2) return false;
  const note: OmittedEvidence = {
    omitted: `The evidence was too large to store (${largestSize} characters).`,
  };
  largest.evidence = { ...note };
  return true;
}
