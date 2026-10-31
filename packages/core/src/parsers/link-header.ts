/**
 * RFC 8288 Link header values. One linear pass over the header: commas separate values
 * only outside angle brackets and quoted strings, semicolons separate parameters only
 * outside quoted strings. Checks read relations and media types from here and never
 * split a Link header themselves.
 */
export interface LinkValue {
  /** The link target as written between the angle brackets, not resolved. */
  href: string;
  /** Relation types from the first rel parameter, lower-cased and split on whitespace. */
  rel: string[];
  /** Media type from the type parameter, lower-cased and without parameters. */
  type?: string;
  title?: string;
  /** Every parameter as written, names lower-cased; the first occurrence of a name wins. */
  params: Record<string, string>;
}

/** Characters of a Link header examined; real headers are a few hundred bytes. */
const HEADER_LIMIT = 16_384;

/**
 * Splits `text` on `separator` outside angle brackets and quoted strings. Inside a
 * quoted string a backslash escapes the next character (RFC 8288 quoted-pair).
 */
function splitOutside(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let inAngle = false;
  let inQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inAngle) {
      if (char === '>') inAngle = false;
    } else if (inQuote) {
      if (char === '\\') index += 1;
      else if (char === '"') inQuote = false;
    } else if (char === '<') {
      inAngle = true;
    } else if (char === '"') {
      inQuote = true;
    } else if (char === separator) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** A parameter value without its quotes and quoted-pair escapes. */
function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  let result = '';
  const inner = value.slice(1, -1);
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index] ?? '';
    if (char === '\\' && index + 1 < inner.length) {
      result += inner[index + 1] ?? '';
      index += 1;
    } else {
      result += char;
    }
  }
  return result;
}

/** The media type of a `type` parameter or content-type value: lower-cased, parameters removed. */
export function mediaTypeOf(value: string | undefined | null): string {
  return (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export function parseLinkHeader(header: string | null | undefined): LinkValue[] {
  if (!header) return [];
  const links: LinkValue[] = [];
  for (const raw of splitOutside(header.slice(0, HEADER_LIMIT), ',')) {
    const value = raw.trim();
    if (!value.startsWith('<')) continue;
    const close = value.indexOf('>');
    if (close === -1) continue;
    const href = value.slice(1, close).trim();
    const params: Record<string, string> = {};
    for (const part of splitOutside(value.slice(close + 1), ';')) {
      const equals = part.indexOf('=');
      const name = (equals === -1 ? part : part.slice(0, equals)).trim().toLowerCase();
      if (!name) continue;
      const rawValue = equals === -1 ? '' : part.slice(equals + 1).trim();
      if (!Object.hasOwn(params, name)) params[name] = unquote(rawValue);
    }
    const rel = (params.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const type = params.type === undefined ? '' : mediaTypeOf(params.type);
    const title = params.title;
    links.push({
      href,
      rel,
      ...(type !== '' ? { type } : {}),
      ...(title !== undefined ? { title } : {}),
      params,
    });
  }
  return links;
}

/** True when the link carries the relation type (case-insensitive, any position). */
export function hasLinkRelation(link: LinkValue, relation: string): boolean {
  return link.rel.includes(relation.toLowerCase());
}
