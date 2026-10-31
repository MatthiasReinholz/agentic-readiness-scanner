/**
 * HTTP Link header fields (RFC 8288). One forward scan per header, so a hostile value
 * cannot trigger backtracking; malformed members are skipped rather than thrown on.
 */
export interface LinkHeaderEntry {
  /** The URI reference between the angle brackets, as written (not resolved). */
  url: string;
  /** The rel parameter, lower-cased; empty when absent. */
  rel: string;
  /** Every parameter, lower-cased names, quotes removed. */
  params: Record<string, string>;
}

const HEADER_LIMIT = 8192;

/** Splits on `separator` outside double quotes and outside `<...>`. */
function splitOutside(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let bracketed = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && !bracketed) quoted = !quoted;
    else if (char === '<' && !quoted) bracketed = true;
    else if (char === '>' && !quoted) bracketed = false;
    else if (char === separator && !quoted && !bracketed) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function parseParams(parts: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const part of parts) {
    const equals = part.indexOf('=');
    const name = (equals === -1 ? part : part.slice(0, equals)).trim().toLowerCase();
    if (!name) continue;
    let value = equals === -1 ? '' : part.slice(equals + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    params[name] = value;
  }
  return params;
}

export function parseLinkHeader(header: string | undefined): LinkHeaderEntry[] {
  if (!header) return [];
  const entries: LinkHeaderEntry[] = [];
  for (const member of splitOutside(header.slice(0, HEADER_LIMIT), ',')) {
    const [target = '', ...rest] = splitOutside(member, ';');
    const open = target.indexOf('<');
    const close = target.indexOf('>', open + 1);
    if (open === -1 || close === -1) continue;
    const url = target.slice(open + 1, close).trim();
    if (!url) continue;
    const params = parseParams(rest);
    entries.push({ url, rel: (params.rel ?? '').toLowerCase(), params });
  }
  return entries;
}

/** Entries whose rel list (space-separated per RFC 8288) contains `rel`. */
export function linksWithRel(entries: LinkHeaderEntry[], rel: string): LinkHeaderEntry[] {
  const wanted = rel.toLowerCase();
  return entries.filter((entry) => entry.rel.split(/\s+/).includes(wanted));
}
