/**
 * Guarded JSON helpers for checks that read machine-readable endpoints. A malformed body
 * is a verdict, never a thrown error, so every parse goes through here.
 */

/** The parsed value, or undefined when the body is not JSON (JSON itself has no undefined). */
export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** A plain JSON object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the body starts like an HTML page (an error page or a theme answering a JSON URL). */
export function looksLikeHtml(body: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(body.slice(0, 500));
}

/** The entries of a registry value that is an object or an array of objects. */
export function recordEntries(value: unknown): Record<string, unknown>[] {
  if (isRecord(value)) return [value];
  if (Array.isArray(value)) return value.filter(isRecord);
  return [];
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
