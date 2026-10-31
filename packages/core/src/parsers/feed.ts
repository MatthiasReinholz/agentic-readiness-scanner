/**
 * Product feed parsing: sniff the format of a fetched body (Google/RSS/Atom XML, CSV, TSV,
 * JSON, JSON Lines), read a bounded number of items as flat string records and pick up a
 * feed-level timestamp. Checks never parse feed bodies themselves; they decide on the
 * ParsedFeed this module returns.
 */
import { XMLParser } from 'fast-xml-parser';

export type FeedFormat = 'xml' | 'csv' | 'tsv' | 'json' | 'jsonl' | 'unknown';

export interface ParsedFeed {
  format: FeedFormat;
  /** The first items, each flattened to string values. */
  items: Record<string, string>[];
  /** Column headers (CSV/TSV) or the union of keys seen on the parsed items. */
  fields: string[];
  /** True when the XML declares the Google Merchant namespace. */
  namespaceGoogle: boolean;
  /** lastBuildDate/pubDate (RSS), updated (Atom) or updated_at/generated_at (JSON). */
  lastModifiedInFeed?: string;
  error?: string;
}

export const DEFAULT_FEED_ITEMS = 20;
const GOOGLE_NAMESPACE = /xmlns:g\s*=\s*["']http:\/\/base\.google\.com\/ns\/1\.0\/?["']/i;
const VALUE_LIMIT = 500;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  isArray: (name) => name === 'item' || name === 'entry',
});

function stripBom(body: string): string {
  return body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
}

function headerLineOf(body: string): string {
  const end = body.indexOf('\n');
  return (end === -1 ? body : body.slice(0, end)).replace(/\r$/, '');
}

/** The feed format from the Content-Type header when it is specific, else from the body. */
export function sniffFeedFormat(body: string, contentType = ''): FeedFormat {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (/^(?:application|text)\/(?:[\w.+-]*\+)?xml$|^application\/(?:rss|atom)\+xml$/.test(type))
    return 'xml';
  if (type === 'text/csv' || type === 'application/csv') return 'csv';
  if (type === 'text/tab-separated-values' || type === 'text/tsv') return 'tsv';
  if (
    type === 'application/x-ndjson' ||
    type === 'application/jsonl' ||
    type === 'application/x-jsonlines'
  )
    return 'jsonl';
  const text = stripBom(body).trimStart();
  if (text.startsWith('<')) return 'xml';
  if (text.startsWith('[')) return 'json';
  if (text.startsWith('{')) {
    const header = headerLineOf(text).trim();
    const rest = text.slice(header.length).trim();
    return header.endsWith('}') && rest.startsWith('{') ? 'jsonl' : 'json';
  }
  if (type === 'application/json') return 'json';
  const header = headerLineOf(text);
  if (header.includes('\t')) return 'tsv';
  if (header.includes(',')) return 'csv';
  return 'unknown';
}

function flatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim().slice(0, VALUE_LIMIT);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['#text'] === 'string' || typeof record['#text'] === 'number') {
      return String(record['#text']).trim().slice(0, VALUE_LIMIT);
    }
    try {
      return JSON.stringify(value).slice(0, VALUE_LIMIT);
    } catch {
      return null;
    }
  }
  return null;
}

function flatRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('@_')) continue;
    const flat = flatValue(entry);
    if (flat !== null) record[key] = flat;
  }
  return record;
}

function fieldsOf(items: Record<string, string>[]): string[] {
  const fields = new Set<string>();
  for (const item of items) for (const key of Object.keys(item)) fields.add(key);
  return [...fields];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const flat = flatValue(record[key]);
    if (flat) return flat;
  }
  return undefined;
}

function parseXmlFeed(body: string, maxItems: number): ParsedFeed {
  const namespaceGoogle = GOOGLE_NAMESPACE.test(body);
  let document: unknown;
  try {
    document = xmlParser.parse(body);
  } catch (error) {
    return {
      format: 'xml',
      items: [],
      fields: [],
      namespaceGoogle,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const root = asRecord(document);
  const rss = asRecord(root?.rss);
  const channel = asRecord(rss?.channel) ?? asRecord(root?.channel);
  const atom = asRecord(root?.feed);
  const rawItems: unknown[] = Array.isArray(channel?.item)
    ? channel.item
    : Array.isArray(atom?.entry)
      ? atom.entry
      : [];
  const items = rawItems
    .slice(0, maxItems)
    .map(flatRecord)
    .filter((item): item is Record<string, string> => item !== null);
  const lastModifiedInFeed =
    firstString(channel, ['lastBuildDate', 'pubDate']) ??
    firstString(atom, ['updated']) ??
    firstString(asRecord(rawItems[0]), ['pubDate', 'updated']);
  return {
    format: 'xml',
    items,
    fields: fieldsOf(items),
    namespaceGoogle,
    ...(lastModifiedInFeed ? { lastModifiedInFeed } : {}),
    ...(rawItems.length === 0 && !channel && !atom ? { error: 'no rss or feed root' } : {}),
  };
}

/**
 * Reads up to `maxRows` rows of delimiter-separated text with one forward scan, honouring
 * double-quoted fields (with "" escapes and embedded newlines). Linear in the input.
 */
export function parseDelimitedRows(text: string, delimiter: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;
  const pushRow = (): void => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  while (index < text.length && rows.length < maxRows) {
    const char = text[index] ?? '';
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
      } else {
        field += char;
      }
      index += 1;
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      pushRow();
    } else if (char !== '\r') {
      field += char;
    }
    index += 1;
  }
  if (rows.length < maxRows && (field !== '' || row.length > 0)) pushRow();
  return rows;
}

function parseDelimitedFeed(body: string, format: 'csv' | 'tsv', maxItems: number): ParsedFeed {
  const rows = parseDelimitedRows(stripBom(body), format === 'tsv' ? '\t' : ',', maxItems + 1);
  const header = rows[0];
  if (!header) {
    return { format, items: [], fields: [], namespaceGoogle: false, error: 'empty file' };
  }
  const fields = header.map((name) => name.trim().toLowerCase()).filter(Boolean);
  const items: Record<string, string>[] = [];
  for (const row of rows.slice(1)) {
    const item: Record<string, string> = {};
    fields.forEach((name, column) => {
      const value = row[column];
      if (value !== undefined && value !== '') item[name] = value.trim().slice(0, VALUE_LIMIT);
    });
    if (Object.keys(item).length > 0) items.push(item);
  }
  return { format, items, fields, namespaceGoogle: false };
}

function parseJsonValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function parseJsonFeed(body: string, maxItems: number): ParsedFeed {
  const parsed = parseJsonValue(stripBom(body));
  if (parsed === undefined) {
    return { format: 'json', items: [], fields: [], namespaceGoogle: false, error: 'invalid JSON' };
  }
  const root = asRecord(parsed);
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root?.items)
      ? root.items
      : Array.isArray(root?.products)
        ? root.products
        : [];
  const items = list
    .slice(0, maxItems)
    .map(flatRecord)
    .filter((item): item is Record<string, string> => item !== null);
  const lastModifiedInFeed = firstString(root, [
    'updated_at',
    'generated_at',
    'last_updated',
    'updated',
  ]);
  return {
    format: 'json',
    items,
    fields: fieldsOf(items),
    namespaceGoogle: false,
    ...(lastModifiedInFeed ? { lastModifiedInFeed } : {}),
    ...(!Array.isArray(parsed) && list.length === 0 ? { error: 'no items or products array' } : {}),
  };
}

function parseJsonLinesFeed(body: string, maxItems: number): ParsedFeed {
  const items: Record<string, string>[] = [];
  let lines = 0;
  for (const line of stripBom(body).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lines += 1;
    const item = flatRecord(parseJsonValue(trimmed));
    if (item) items.push(item);
    if (items.length >= maxItems || lines >= maxItems * 2) break;
  }
  return {
    format: 'jsonl',
    items,
    fields: fieldsOf(items),
    namespaceGoogle: false,
    ...(items.length === 0 ? { error: 'no JSON object per line' } : {}),
  };
}

/** Parses a fetched feed body, reading at most `maxItems` items. Never throws. */
export function parseFeed(
  body: string,
  contentType = '',
  maxItems = DEFAULT_FEED_ITEMS,
): ParsedFeed {
  const format = sniffFeedFormat(body, contentType);
  switch (format) {
    case 'xml':
      return parseXmlFeed(stripBom(body), maxItems);
    case 'csv':
    case 'tsv':
      return parseDelimitedFeed(body, format, maxItems);
    case 'json':
      return parseJsonFeed(body, maxItems);
    case 'jsonl':
      return parseJsonLinesFeed(body, maxItems);
    default:
      return {
        format,
        items: [],
        fields: [],
        namespaceGoogle: false,
        error: 'unrecognised format',
      };
  }
}

function hasAll(item: Record<string, string>, required: readonly (readonly string[])[]): boolean {
  return required.every((alternatives) =>
    alternatives.some((key) => key in item && item[key] !== ''),
  );
}

const TABULAR_FIELDS = [['id'], ['title'], ['link', 'url'], ['price']] as const;

/**
 * Whether the parsed body is a product feed: Google-namespaced XML or RSS items with g:id or
 * g:price; CSV/TSV with id, title, link (or url) and price columns; JSON whose items carry
 * id, title, url (or link) and price.
 */
export function isProductFeed(feed: ParsedFeed): boolean {
  switch (feed.format) {
    case 'xml':
      return feed.namespaceGoogle || feed.items.some((item) => 'g:id' in item || 'g:price' in item);
    case 'csv':
    case 'tsv':
      return TABULAR_FIELDS.every((alternatives) =>
        alternatives.some((name) => feed.fields.includes(name)),
      );
    case 'json':
    case 'jsonl':
      return feed.items.some((item) => hasAll(item, TABULAR_FIELDS));
    default:
      return false;
  }
}

/** Why a parsed body does not qualify, for evidence. */
export function feedRejection(feed: ParsedFeed): string {
  if (feed.error) return `${feed.format}: ${feed.error}`;
  switch (feed.format) {
    case 'xml':
      return 'XML without the Google Merchant namespace or g:id/g:price items';
    case 'csv':
    case 'tsv':
      return `${feed.format.toUpperCase()} header lacks id, title, link/url or price`;
    case 'json':
    case 'jsonl':
      return 'JSON items lack id, title, url/link or price';
    default:
      return 'unrecognised format';
  }
}

const FEED_HINT = /feed/i;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>)]+/g;

/**
 * Feed URLs hinted at in robots.txt: Sitemap records whose URL mentions "feed" and URLs in
 * comment lines that mention "feed". Linear in the file size.
 */
export function robotsFeedHints(robotsTxt: string): string[] {
  const hints: string[] = [];
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !FEED_HINT.test(line)) continue;
    const isComment = line.startsWith('#');
    const separator = line.indexOf(':');
    const field =
      isComment || separator === -1 ? '' : line.slice(0, separator).trim().toLowerCase();
    if (!isComment && field !== 'sitemap') continue;
    URL_IN_TEXT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_IN_TEXT.exec(line)) !== null) {
      if (FEED_HINT.test(match[0])) hints.push(match[0]);
    }
  }
  return hints;
}
