import { contentType } from '../../http/types.js';
import { isRecord, looksLikeHtml, nonEmptyString, parseJson, recordEntries } from '../json.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';

/** UCP entity versions are dates: 2026-08-25. */
const UCP_VERSION = /^\d{4}-\d{2}-\d{2}$/;
const UCP_SHOPPING_SERVICE = 'dev.ucp.shopping';
const UCP_CHECKOUT_CAPABILITY = 'dev.ucp.shopping.checkout';
const UCP_TRANSPORTS = new Set(['rest', 'mcp', 'a2a']);
const HEADER_LIMIT = 4_000;
const SNIPPET_LIMIT = 200;

interface UcpProfile {
  version: string;
  services: Record<string, unknown>;
  payment_handlers: Record<string, unknown>;
  capabilities: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

/** The `ucp` object when it has the required shape, otherwise the part that is missing. */
function ucpProfileOf(root: unknown): { profile: UcpProfile } | { missing: string } {
  if (!isRecord(root)) return { missing: 'a top-level JSON object' };
  const ucp = root.ucp;
  if (!isRecord(ucp)) return { missing: 'the ucp object' };
  if (typeof ucp.version !== 'string' || !UCP_VERSION.test(ucp.version)) {
    return { missing: 'a ucp.version in YYYY-MM-DD form' };
  }
  if (!isRecord(ucp.services)) return { missing: 'a ucp.services object' };
  if (!isRecord(ucp.payment_handlers)) return { missing: 'a ucp.payment_handlers object' };
  return {
    profile: {
      version: ucp.version,
      services: ucp.services,
      payment_handlers: ucp.payment_handlers,
      capabilities: isRecord(ucp.capabilities) ? ucp.capabilities : null,
      raw: ucp,
    },
  };
}

/** UCP requires shared caching: `public` with a max-age of at least 60 seconds. */
export function allowsSharedCaching(cacheControl: string | null): boolean {
  if (!cacheControl) return false;
  const value = cacheControl.slice(0, HEADER_LIMIT);
  if (!/\bpublic\b/i.test(value)) return false;
  if (/\b(?:private|no-store|no-cache)\b/i.test(value)) return false;
  const maxAge = /\bmax-age=(\d{1,10})/i.exec(value);
  return maxAge !== null && Number(maxAge[1]) >= 60;
}

function hasKeys(root: unknown, ucp: Record<string, unknown>): boolean {
  const candidates = [
    isRecord(root) ? root.keys : undefined,
    isRecord(root) ? root.signing_keys : undefined,
    ucp.keys,
    ucp.signing_keys,
  ];
  return candidates.some((value) => Array.isArray(value) && value.length > 0);
}

export const ucpBusinessProfile = defineCheck('B5.1', async ({ target, fetcher }) => {
  const url = `${target.origin}/.well-known/ucp`;
  const response = await fetcher.fetch(url);
  const type = contentType(response);
  const cacheControl = response.headers['cache-control'] ?? null;
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: type,
    redirects: response.redirects,
    cache_control: cacheControl,
  };
  if (response.status === 404) {
    return fail('no UCP business profile at /.well-known/ucp (HTTP 404)', evidence);
  }
  if (response.status !== 200) {
    return fail(`/.well-known/ucp returned HTTP ${response.status}`, evidence);
  }
  if (looksLikeHtml(response.body)) {
    return fail('/.well-known/ucp returned an HTML page, not a JSON profile', evidence);
  }
  const root = parseJson(response.body);
  if (root === undefined) {
    return fail('/.well-known/ucp is not valid JSON', evidence);
  }
  const shape = ucpProfileOf(root);
  if ('missing' in shape) {
    return fail(`UCP profile is missing ${shape.missing}`, evidence);
  }
  const { profile } = shape;
  const serviceIds = Object.keys(profile.services);
  const capabilityIds = profile.capabilities ? Object.keys(profile.capabilities) : [];
  const handlerIds = Object.keys(profile.payment_handlers);
  Object.assign(evidence, {
    version: profile.version,
    services: serviceIds,
    capabilities: capabilityIds,
    payment_handlers: handlerIds,
    keys_present: hasKeys(root, profile.raw),
    profile: profile.raw,
  });

  const warnings: string[] = [];
  if (response.redirects > 0) {
    warnings.push(`it was served through ${response.redirects} redirect(s)`);
  }
  if (type !== 'application/json') {
    warnings.push(`the content type is ${type || 'missing'}, not application/json`);
  }
  if (!allowsSharedCaching(cacheControl)) {
    warnings.push('Cache-Control lacks public with a max-age of at least 60');
  }
  const summary = `UCP profile version ${profile.version} with ${serviceIds.length} service(s), ${capabilityIds.length} capability set(s) and ${handlerIds.length} payment handler(s)`;
  if (warnings.length > 0) {
    return warn(`${summary}, but ${warnings.join('; ')}`, evidence);
  }
  return pass(summary, evidence);
});

/** A payment handler entry an agent can act on: it names what it is and which spec it follows. */
function isDeclaredHandler(entry: Record<string, unknown>): boolean {
  return nonEmptyString(entry.id) && nonEmptyString(entry.version) && nonEmptyString(entry.spec);
}

export const ucpCheckoutDeclared = defineCheck('B5.2', async ({ fetcher, outcomes }) => {
  const profile = outcomes.get('B5.1')?.evidence.profile;
  if (!isRecord(profile)) {
    return skip('error', 'B5.1 recorded no UCP profile to inspect', {});
  }
  const capabilities = isRecord(profile.capabilities) ? profile.capabilities : {};
  const checkoutCapability = capabilities[UCP_CHECKOUT_CAPABILITY];
  const capabilityDeclared = Array.isArray(checkoutCapability) && checkoutCapability.length > 0;
  const services = isRecord(profile.services) ? profile.services : {};
  const shoppingEntries = recordEntries(services[UCP_SHOPPING_SERVICE]);
  const transports = shoppingEntries
    .map((entry) => entry.transport)
    .filter((transport): transport is string => typeof transport === 'string')
    .map((transport) => transport.toLowerCase());
  const serviceDeclared = transports.some((transport) => UCP_TRANSPORTS.has(transport));
  const checkout = capabilityDeclared || serviceDeclared;

  const handlers = isRecord(profile.payment_handlers) ? profile.payment_handlers : {};
  const handlerIds: string[] = [];
  for (const [key, value] of Object.entries(handlers)) {
    for (const entry of recordEntries(value)) {
      if (isDeclaredHandler(entry)) handlerIds.push(typeof entry.id === 'string' ? entry.id : key);
    }
  }

  const evidence: Record<string, unknown> = {
    checkout,
    checkout_capability: capabilityDeclared,
    shopping_transports: transports,
    handlers: handlerIds,
    endpoint: null,
    endpoint_status: null,
  };

  let endpointNote = '';
  const restEntry = shoppingEntries.find(
    (entry) =>
      typeof entry.transport === 'string' &&
      entry.transport.toLowerCase() === 'rest' &&
      nonEmptyString(entry.endpoint),
  );
  if (restEntry && typeof restEntry.endpoint === 'string') {
    evidence.endpoint = restEntry.endpoint;
    const response = await fetcher.fetch(restEntry.endpoint);
    evidence.endpoint_status = response.status;
    if (response.status === 404 || response.status >= 500) {
      endpointNote = ` (endpoint answered HTTP ${response.status})`;
    }
  }

  if (checkout && handlerIds.length > 0) {
    const message = `UCP profile declares checkout and ${handlerIds.length} payment handler(s): ${handlerIds.join(', ')}${endpointNote}`;
    return endpointNote ? warn(message, evidence) : pass(message, evidence);
  }
  if (checkout) {
    return warn(
      `UCP profile declares checkout but no payment handler with id, version and spec${endpointNote}`,
      evidence,
    );
  }
  if (handlerIds.length > 0) {
    return warn(
      `UCP profile declares ${handlerIds.length} payment handler(s) but no checkout capability or shopping service${endpointNote}`,
      evidence,
    );
  }
  return fail('UCP profile declares neither checkout nor a payment handler', evidence);
});

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export const acpDiscoveryDocument = defineCheck('B5.3', async ({ target, fetcher }) => {
  const url = `${target.origin}/.well-known/acp.json`;
  const response = await fetcher.fetch(url);
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: contentType(response),
  };
  if (response.status === 404) {
    return fail('no ACP discovery document at /.well-known/acp.json (HTTP 404)', evidence);
  }
  if (response.status !== 200) {
    return fail(`/.well-known/acp.json returned HTTP ${response.status}`, evidence);
  }
  if (looksLikeHtml(response.body)) {
    return fail('/.well-known/acp.json returned an HTML page, not JSON', evidence);
  }
  const root = parseJson(response.body);
  if (!isRecord(root)) {
    return fail('/.well-known/acp.json is not a JSON object', evidence);
  }
  const protocol = isRecord(root.protocol) ? root.protocol : {};
  const transports = Array.isArray(root.transports)
    ? root.transports.filter((item): item is string => typeof item === 'string')
    : null;
  const capabilities = isRecord(root.capabilities) ? root.capabilities : {};
  Object.assign(evidence, {
    protocol: { name: protocol.name ?? null, version: protocol.version ?? null },
    api_base_url: typeof root.api_base_url === 'string' ? root.api_base_url : null,
    transports,
    services: Array.isArray(capabilities.services) ? capabilities.services : null,
  });

  const missing: string[] = [];
  if (protocol.name !== 'acp') missing.push('protocol.name "acp"');
  if (!nonEmptyString(protocol.version)) missing.push('a protocol.version string');
  if (!isHttpsUrl(root.api_base_url)) missing.push('an https api_base_url');
  if (!transports?.includes('rest')) {
    missing.push('a transports array containing "rest"');
  }
  if (missing.length > 0) {
    return fail(`ACP discovery document is missing ${missing.join(', ')}`, evidence);
  }
  return pass(
    `ACP ${String(protocol.version)} discovery document with a REST API at ${String(root.api_base_url)}`,
    evidence,
  );
});

/** The OpenAI/ACP feed fields that name the seller and its return and legal terms. */
type FieldPresence = Record<
  | 'seller_name'
  | 'seller_url'
  | 'return_policy'
  | 'return_deadline_in_days'
  | 'return_window'
  | 'seller_privacy_policy'
  | 'seller_tos',
  boolean
>;
const FEED_SAMPLE = 5;
const FEED_BODY_LIMIT = 200_000;
const FEED_LINE_LIMIT = 50;

function presenceOf(item: Record<string, unknown>): FieldPresence {
  return {
    seller_name: present(item.seller_name),
    seller_url: present(item.seller_url),
    return_policy: present(item.return_policy),
    return_deadline_in_days: present(item.return_deadline_in_days),
    return_window: present(item.return_window),
    seller_privacy_policy: present(item.seller_privacy_policy),
    seller_tos: present(item.seller_tos),
  };
}

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'object';
}

/** One CSV row, honouring double quotes; a single linear pass over the line. */
function splitCsvLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

function itemsOfJson(root: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(root)) return root.filter(isRecord);
  if (!isRecord(root)) return null;
  for (const key of ['items', 'products', 'data', 'entries']) {
    const value = root[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return null;
}

/**
 * The first items of a JSON, JSON Lines or CSV feed, enough to sample fields from. Returns
 * null when the body is in none of those shapes; XML feeds are handled by the caller.
 */
export function sampleFeedItems(body: string): Record<string, unknown>[] | null {
  const capped = body.slice(0, FEED_BODY_LIMIT);
  // Strip a UTF-8 byte order mark, which CSV exports often carry.
  const text = capped.charCodeAt(0) === 0xfeff ? capped.slice(1) : capped;
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const whole = parseJson(body);
    if (whole !== undefined) return itemsOfJson(whole);
    // JSON Lines: one object per line.
    const items: Record<string, unknown>[] = [];
    for (const line of trimmed.split(/\r?\n/, FEED_LINE_LIMIT)) {
      const parsed = parseJson(line);
      if (isRecord(parsed)) items.push(parsed);
      if (items.length >= FEED_SAMPLE) break;
    }
    return items.length > 0 ? items : null;
  }
  if (trimmed.startsWith('<')) return null;
  const lines = trimmed.split(/\r?\n/, FEED_LINE_LIMIT).filter((line) => line.trim().length > 0);
  const header = lines[0];
  if (!header) return null;
  const separator = header.includes('\t') ? '\t' : header.includes(';') ? ';' : ',';
  const columns = splitCsvLine(header, separator);
  if (columns.length < 2) return null;
  return lines.slice(1, FEED_SAMPLE + 1).map((line) => {
    const cells = splitCsvLine(line, separator);
    const item: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      item[column.toLowerCase()] = cells[index] ?? '';
    });
    return item;
  });
}

function isXmlFormat(format: string | null): boolean {
  return format !== null && /xml|google|rss|atom/i.test(format);
}

export const acpFeedFields = defineCheck('B5.4', async ({ fetcher, outcomes }) => {
  const feed = outcomes.get('B1.5')?.evidence ?? {};
  const feedUrl = typeof feed.feed_url === 'string' ? feed.feed_url : null;
  const format = typeof feed.format === 'string' ? feed.format : null;
  const evidence: Record<string, unknown> = { feed_url: feedUrl, format };
  if (!feedUrl) {
    return skip('not_applicable', 'no product feed was found to inspect', evidence);
  }
  if (isXmlFormat(format)) {
    return skip(
      'not_applicable',
      `the ${format ?? 'XML'} feed uses Google attributes, not ACP seller fields`,
      evidence,
    );
  }

  let items = Array.isArray(feed.items) ? feed.items.filter(isRecord) : null;
  if (items === null) {
    const response = await fetcher.fetch(feedUrl);
    evidence.feed_status = response.status;
    if (response.status !== 200) {
      return skip('error', `the feed at ${feedUrl} answered HTTP ${response.status}`, evidence);
    }
    if (response.body.trimStart().startsWith('<')) {
      return skip('not_applicable', 'the XML feed carries no ACP seller fields', evidence);
    }
    items = sampleFeedItems(response.body);
    if (items === null) {
      return skip(
        'error',
        `the feed at ${feedUrl} could not be parsed as JSON, JSON Lines or CSV`,
        evidence,
      );
    }
  }
  const sample = items.slice(0, FEED_SAMPLE);
  if (sample.length === 0) {
    return skip('error', `the feed at ${feedUrl} has no items to sample`, evidence);
  }

  const fields = sample.map(presenceOf);
  evidence.items_sampled = sample.length;
  evidence.fields = fields;
  const withSeller = fields.filter((item) => item.seller_name).length;
  const complete = fields.filter(
    (item) =>
      item.seller_name &&
      ((item.return_policy && (item.return_deadline_in_days || item.return_window)) ||
        (item.seller_privacy_policy && item.seller_tos)),
  ).length;
  if (withSeller === 0) {
    return fail(
      `none of ${sample.length} sampled feed item(s) carries seller_name or the return and policy fields`,
      evidence,
    );
  }
  if (complete === sample.length) {
    return pass(
      `${sample.length} sampled feed item(s) carry seller_name with return or seller policy fields`,
      evidence,
    );
  }
  return warn(
    `${withSeller} of ${sample.length} sampled feed item(s) carry seller_name, but only ${complete} carry the return or seller policy fields`,
    evidence,
  );
});

/**
 * True when a Link header carries a `/.well-known/ucp` target with rel="ucp". Each link is
 * `<target>; param; param`, so the scan is one pass over bounded segments.
 */
export function hasUcpLinkRelation(header: string): boolean {
  const value = header.slice(0, HEADER_LIMIT);
  const link = /<([^>]{0,2000})>((?:\s*;[^;,<]{0,500})*)/g;
  let match: RegExpExecArray | null;
  while ((match = link.exec(value)) !== null) {
    const [, uri = '', params = ''] = match;
    if (!uri.includes('/.well-known/ucp')) continue;
    const rel = /;\s*rel\s*=\s*"?([^";]{0,200})/i.exec(params);
    if (rel?.[1]?.toLowerCase().split(/\s+/).includes('ucp')) return true;
  }
  return false;
}

/** Whether a GET on a POST-only MCP endpoint shows that something is listening. */
function mcpEndpointAnswers(status: number, body: string): boolean {
  if (status === 405 || status === 401 || status === 200) return true;
  if (status !== 400) return false;
  const parsed = parseJson(body);
  return isRecord(parsed) && ('jsonrpc' in parsed || 'error' in parsed);
}

export const shopifyAgenticStorefront = defineCheck('B5.8', async ({ target, fetcher }) => {
  if (target.platform !== 'shopify') {
    return skip('not_applicable', 'requires Shopify, which was not detected', {
      platform: target.platform,
    });
  }
  const linkHeader = target.home.headers.link ?? null;
  const linkDeclared = linkHeader !== null && hasUcpLinkRelation(linkHeader);
  const endpoint = `${target.origin}/api/ucp/mcp`;
  const response = await fetcher.fetch(endpoint);
  const answers = mcpEndpointAnswers(response.status, response.body);
  const evidence = {
    link_header: linkHeader,
    link_declared: linkDeclared,
    endpoint,
    endpoint_status: response.status,
    endpoint_answers: answers,
    body_snippet: response.body.slice(0, SNIPPET_LIMIT),
  };
  if (linkDeclared && answers) {
    return pass(
      `agentic storefront active: the homepage links /.well-known/ucp and /api/ucp/mcp answers (HTTP ${response.status})`,
      evidence,
    );
  }
  if (linkDeclared) {
    return warn(
      `the homepage links /.well-known/ucp but /api/ucp/mcp returned HTTP ${response.status}`,
      evidence,
    );
  }
  if (answers) {
    return warn(
      `/api/ucp/mcp answers (HTTP ${response.status}) but the homepage sends no Link rel="ucp" header`,
      evidence,
    );
  }
  return fail(
    `no Link rel="ucp" header on the homepage and /api/ucp/mcp returned HTTP ${response.status}`,
    evidence,
  );
});
