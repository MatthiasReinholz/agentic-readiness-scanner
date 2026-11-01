import { elementText, HtmlDocument } from '../../parsers/html.js';
import { blockedByRobots, describeFailure, storeApiUrl } from '../shared.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';
import { contentType } from '../../http/types.js';
import { describeRefusal, isChallengePage, REFUSAL_STATUSES } from '../../http/bot-management.js';
import { type McpProbe, probeMcpEndpoint } from '../mcp.js';
import { isRecord, looksLikeHtml, nonEmptyString, parseJson, recordEntries } from '../json.js';
import { HEADLESS_SHOPIFY } from '../b1/shopify.js';

/** The Store API cart object, as far as this check dereferences it. */
interface StoreApiCart {
  items: unknown[];
  totals: Record<string, unknown>;
  items_count?: unknown;
}

function parseCart(body: string): StoreApiCart | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.items)) return null;
    if (!record.totals || typeof record.totals !== 'object' || Array.isArray(record.totals)) {
      return null;
    }
    return {
      items: record.items,
      totals: record.totals as Record<string, unknown>,
      items_count: record.items_count,
    };
  } catch {
    return null;
  }
}

/** The checkout page: the first same-origin home-page link to /checkout/, else the default. */
export function checkoutUrl(
  origin: string,
  anchors: { href: string }[],
): { url: string; source: 'home-link' | 'default' } {
  for (const anchor of anchors) {
    try {
      const url = new URL(anchor.href, origin);
      if (url.origin !== origin) continue;
      if (/^\/checkout\/?$/i.test(url.pathname)) {
        url.hash = '';
        url.search = '';
        return { url: url.href, source: 'home-link' };
      }
    } catch {
      // not a URL
    }
  }
  return { url: `${origin}/checkout/`, source: 'default' };
}

/**
 * The notices WooCommerce prints when guest checkout is disabled. Every alternative is a
 * fixed phrase, so matching stays linear on the capped notice text.
 */
const LOGIN_REQUIRED_NOTICE =
  /must be logged in to (?:checkout|check out|proceed)|log ?in to (?:checkout|check out|proceed)|please log ?in|sign in to (?:checkout|check out|proceed)/i;
const NOTICE_TEXT_LIMIT = 2_000;

export interface CheckoutLoginSignals {
  checkout_form: boolean;
  login_form: boolean;
  login_notice: boolean;
  login_required: boolean;
}

/**
 * Conservative reading of a checkout page: login is required only when a login notice or
 * login form is present and no checkout form is. A page that shows both (a login prompt
 * above a guest checkout form) still offers guest checkout.
 */
export function checkoutLoginSignals(doc: HtmlDocument): CheckoutLoginSignals {
  const checkoutForm =
    doc.find('form', 'class', /\bcheckout\b/).length > 0 ||
    doc.find('form', 'name', /^checkout$/i).length > 0 ||
    doc.find('*', 'class', /\bwp-block-woocommerce-checkout\b|\bwc-block-checkout\b/).length > 0;
  const loginForm = doc.find('form', 'class', /\bwoocommerce-form-login\b/).length > 0;
  const notices = doc.find(
    '*',
    'class',
    /\bwoocommerce-info\b|\bwoocommerce-message\b|\bwoocommerce-error\b|\bwc-block-components-notice-banner\b/,
  );
  const loginNotice = notices.some((notice) =>
    LOGIN_REQUIRED_NOTICE.test(elementText(notice).slice(0, NOTICE_TEXT_LIMIT)),
  );
  return {
    checkout_form: checkoutForm,
    login_form: loginForm,
    login_notice: loginNotice,
    login_required: (loginNotice || loginForm) && !checkoutForm,
  };
}

export const guestCheckoutAndCartApi = defineCheck('B5.7', async ({ target, fetcher }) => {
  const cartUrl = storeApiUrl(target, '/cart');
  const cartResponse = await fetcher.fetch(cartUrl);
  const evidence: Record<string, unknown> = {
    cart_url: cartUrl,
    cart_status: cartResponse.status,
  };
  if (cartResponse.status === 401 || cartResponse.status === 403) {
    return fail(`cart requires authentication (HTTP ${cartResponse.status})`, evidence);
  }
  if (cartResponse.status === 404) {
    return fail('Store API cart endpoint not found (HTTP 404)', evidence);
  }
  if (cartResponse.status !== 200) {
    return fail(
      cartResponse.status === 0
        ? `Store API cart could not be fetched: ${cartResponse.error ?? 'no response'}`
        : `Store API cart returned HTTP ${cartResponse.status}`,
      evidence,
    );
  }
  const cart = parseCart(cartResponse.body);
  if (!cart) {
    return fail('Store API cart is not a JSON object with items and totals', evidence);
  }
  evidence.cart_items = cart.items.length;
  evidence.cart_currency_code =
    typeof cart.totals.currency_code === 'string' ? cart.totals.currency_code : null;

  const checkout = checkoutUrl(target.origin, target.homeDoc.anchors());
  const checkoutResponse = await fetcher.fetch(checkout.url);
  evidence.checkout_url = checkout.url;
  evidence.checkout_url_source = checkout.source;
  evidence.checkout_status = checkoutResponse.status;
  if (checkoutResponse.status !== 200) {
    evidence.login_required = null;
    return pass(
      `anonymous cart API works; checkout page returned HTTP ${checkoutResponse.status}, so guest checkout was not verified`,
      evidence,
    );
  }
  const signals = checkoutLoginSignals(new HtmlDocument(checkoutResponse.body));
  Object.assign(evidence, signals);
  if (signals.login_required) {
    return warn(
      'anonymous cart API works, but the checkout page requires login (guest checkout disabled)',
      evidence,
    );
  }
  return pass('anonymous cart API works and the checkout page does not require login', evidence);
});

/** UCP entity versions are dates: 2026-08-25. */
const UCP_VERSION = /^\d{4}-\d{2}-\d{2}$/;
const UCP_SHOPPING_SERVICE = 'dev.ucp.shopping';
const UCP_CHECKOUT_CAPABILITY = 'dev.ucp.shopping.checkout';
/** The transport enum of the service binding; Shopify declares `embedded`. */
const UCP_TRANSPORTS = new Set(['rest', 'mcp', 'a2a', 'embedded']);
/** The release that renamed the top-level `signing_keys` array to `keys`. */
const UCP_KEYS_RENAME_VERSION = '2026-08-25';
const HEADER_LIMIT = 4_000;

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

/** Which key array the profile carries: `keys` (2026-08-25 and later), the older `signing_keys`, or none. */
function keysField(root: unknown, ucp: Record<string, unknown>): 'keys' | 'signing_keys' | null {
  const has = (value: unknown): boolean => Array.isArray(value) && value.length > 0;
  if (has(isRecord(root) ? root.keys : undefined) || has(ucp.keys)) return 'keys';
  if (has(isRecord(root) ? root.signing_keys : undefined) || has(ucp.signing_keys))
    return 'signing_keys';
  return null;
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
  // A refusal is not an absence: the profile may be there, but an agent cannot read it.
  if (REFUSAL_STATUSES.has(response.status) || isChallengePage(response)) {
    evidence.refused = describeRefusal(response);
    return fail(
      `/.well-known/ucp was refused (${describeRefusal(response)}): whether a profile exists cannot be told, and an agent cannot read it either`,
      evidence,
    );
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
  const keys = keysField(root, profile.raw);
  Object.assign(evidence, {
    version: profile.version,
    services: serviceIds,
    capabilities: capabilityIds,
    payment_handlers: handlerIds,
    keys_present: keys !== null,
    keys_field: keys,
    profile: profile.raw,
  });

  const warnings: string[] = [];
  if (response.redirects > 0) {
    warnings.push(`it was served through ${response.redirects} redirect(s)`);
  }
  // Dates compare as strings in YYYY-MM-DD form. 2026-04-08 profiles are not flagged on
  // the version alone: Google's guides still target that release.
  if (keys === 'signing_keys' && profile.version >= UCP_KEYS_RENAME_VERSION) {
    warnings.push(
      `it carries signing_keys but no keys, although the ${UCP_KEYS_RENAME_VERSION} release replaced signing_keys with keys`,
    );
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

/** A payment handler entry an agent can act on: UCP requires id and version; spec is optional. */
function isDeclaredHandler(entry: Record<string, unknown>): boolean {
  return nonEmptyString(entry.id) && nonEmptyString(entry.version);
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
  let handlersWithoutSpec = 0;
  for (const [key, value] of Object.entries(handlers)) {
    for (const entry of recordEntries(value)) {
      if (!isDeclaredHandler(entry)) continue;
      handlerIds.push(typeof entry.id === 'string' ? entry.id : key);
      if (!nonEmptyString(entry.spec)) handlersWithoutSpec += 1;
    }
  }

  const evidence: Record<string, unknown> = {
    checkout,
    checkout_capability: capabilityDeclared,
    shopping_transports: transports,
    handlers: handlerIds,
    handlers_without_spec: handlersWithoutSpec,
    endpoint: null,
    endpoint_status: null,
    endpoint_error: null,
  };

  // The REST base URL is probed for reachability only. A REST base has no GET resource of
  // its own, so 404 (ikea.com) or 405 there is the normal answer, not a finding; only a
  // host that does not answer or a 5xx says the agent would fail there.
  let endpointNote = '';
  let endpointProblem = '';
  const restEntry = shoppingEntries.find(
    (entry) =>
      typeof entry.transport === 'string' &&
      entry.transport.toLowerCase() === 'rest' &&
      nonEmptyString(entry.endpoint),
  );
  if (restEntry && typeof restEntry.endpoint === 'string') {
    const endpoint = restEntry.endpoint;
    evidence.endpoint = endpoint;
    const response = await fetcher.fetch(endpoint);
    evidence.endpoint_status = response.status;
    evidence.endpoint_error = response.error ?? null;
    if (blockedByRobots(response)) {
      endpointNote = ` (the REST endpoint ${endpoint} was not requested: ${describeFailure(response)})`;
    } else if (response.status === 0) {
      endpointProblem = `the REST endpoint ${endpoint} could not be reached (${describeFailure(response)})`;
    } else if (response.status >= 500) {
      endpointProblem = `the REST endpoint ${endpoint} answered ${describeFailure(response)}`;
    } else {
      endpointNote = ` (the REST endpoint ${endpoint} answered HTTP ${response.status})`;
    }
  }

  if (checkout && handlerIds.length > 0) {
    const summary = `UCP profile declares checkout and ${handlerIds.length} payment handler(s): ${handlerIds.join(', ')}`;
    return endpointProblem
      ? warn(`${summary}, but ${endpointProblem}`, evidence)
      : pass(`${summary}${endpointNote}`, evidence);
  }
  if (endpointProblem) endpointNote = `; ${endpointProblem}`;
  if (checkout) {
    return warn(
      `UCP profile declares checkout but no payment handler with id and version${endpointNote}`,
      evidence,
    );
  }
  if (handlerIds.length > 0) {
    return warn(
      `UCP profile declares ${handlerIds.length} payment handler(s) but no checkout capability or shopping service with a rest, mcp, a2a or embedded transport${endpointNote}`,
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
  const capabilities = isRecord(root.capabilities) ? root.capabilities : null;
  Object.assign(evidence, {
    protocol: {
      name: protocol.name ?? null,
      version: protocol.version ?? null,
      // The discovery RFC requires both; recorded so a reader can see what the store claims.
      supported_versions: Array.isArray(protocol.supported_versions)
        ? protocol.supported_versions
        : null,
    },
    api_base_url: typeof root.api_base_url === 'string' ? root.api_base_url : null,
    transports,
    capabilities,
    services: Array.isArray(capabilities?.services) ? capabilities.services : null,
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
    `ACP ${String(protocol.version)} discovery document with a REST API at ${String(root.api_base_url)} (the document is a merged proposal in the ACP repository; OpenAI does not document probing it)`,
    evidence,
  );
});

/**
 * The OpenAI product feed specification: nine required fields, the optional return fields,
 * the seller policy fields that checkout requires, and the eligibility flags. Each entry
 * lists the field and the aliases a feed may use for it.
 */
const OPENAI_REQUIRED: Record<string, readonly string[]> = {
  item_id: ['item_id', 'id', 'sku'],
  title: ['title'],
  description: ['description'],
  url: ['url', 'link'],
  brand: ['brand'],
  seller_name: ['seller_name'],
  image_url: ['image_url', 'image_link'],
  availability: ['availability'],
  price: ['price'],
};
const OPENAI_RETURN: Record<string, readonly string[]> = {
  return_policy: ['return_policy'],
  return_deadline_in_days: ['return_deadline_in_days', 'return_window'],
};
const OPENAI_CHECKOUT_POLICY: Record<string, readonly string[]> = {
  seller_privacy_policy: ['seller_privacy_policy'],
  seller_tos: ['seller_tos'],
};
const OPENAI_FLAGS: Record<string, readonly string[]> = {
  is_eligible_search: ['is_eligible_search', 'enable_search'],
  is_eligible_checkout: ['is_eligible_checkout', 'enable_checkout'],
};
const FEED_SAMPLE = 5;
const FEED_BODY_LIMIT = 200_000;
const FEED_LINE_LIMIT = 50;

interface FeedItemFields {
  /** Required fields that are absent, by their canonical name. */
  missing_required: string[];
  missing_return: string[];
  missing_checkout_policy: string[];
  /** The eligibility flags as written (true, false or null when absent). */
  flags: Record<string, boolean | null>;
  /** Every field read, by canonical name, true when present under any alias. */
  fields: Record<string, boolean>;
}

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'object';
}

function presentUnderAlias(item: Record<string, unknown>, aliases: readonly string[]): boolean {
  return aliases.some((alias) => present(item[alias]));
}

function flagOf(item: Record<string, unknown>, aliases: readonly string[]): boolean | null {
  for (const alias of aliases) {
    const value = item[alias];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && /^(true|false|yes|no|1|0)$/i.test(value.trim()))
      return /^(true|yes|1)$/i.test(value.trim());
  }
  return null;
}

function missingOf(
  item: Record<string, unknown>,
  group: Record<string, readonly string[]>,
): string[] {
  return Object.entries(group)
    .filter(([, aliases]) => !presentUnderAlias(item, aliases))
    .map(([name]) => name);
}

function fieldsOf(item: Record<string, unknown>): FeedItemFields {
  const fields: Record<string, boolean> = {};
  for (const group of [OPENAI_REQUIRED, OPENAI_RETURN, OPENAI_CHECKOUT_POLICY]) {
    for (const [name, aliases] of Object.entries(group))
      fields[name] = presentUnderAlias(item, aliases);
  }
  return {
    missing_required: missingOf(item, OPENAI_REQUIRED),
    missing_return: missingOf(item, OPENAI_RETURN),
    missing_checkout_policy: missingOf(item, OPENAI_CHECKOUT_POLICY),
    flags: Object.fromEntries(
      Object.entries(OPENAI_FLAGS).map(([name, aliases]) => [name, flagOf(item, aliases)]),
    ),
    fields,
  };
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

  const items_ = sample.map(fieldsOf);
  const countMissing = (pick: (item: FeedItemFields) => string[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const item of items_)
      for (const name of pick(item)) counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  };
  const missingRequired = countMissing((item) => item.missing_required);
  const missingReturn = countMissing((item) => item.missing_return);
  // The seller policy fields are required for checkout; an item that opts out of checkout
  // with is_eligible_checkout false (or enable_checkout false) does not need them.
  const missingCheckout = countMissing((item) =>
    item.flags.is_eligible_checkout === false ? [] : item.missing_checkout_policy,
  );
  evidence.items_sampled = sample.length;
  evidence.fields = items_.map((item) => item.fields);
  evidence.flags = items_.map((item) => item.flags);
  evidence.missing_required = missingRequired;
  evidence.missing_return = missingReturn;
  evidence.missing_checkout_policy = missingCheckout;
  const describe = (counts: Record<string, number>): string =>
    Object.entries(counts)
      .map(([name, count]) => `${name} (${count} of ${sample.length})`)
      .join(', ');
  if (Object.keys(missingRequired).length > 0) {
    return fail(
      `sampled feed items lack OpenAI's required fields: ${describe(missingRequired)}`,
      evidence,
    );
  }
  const gaps: string[] = [];
  if (Object.keys(missingReturn).length > 0)
    gaps.push(`the optional return fields ${describe(missingReturn)}`);
  if (Object.keys(missingCheckout).length > 0)
    gaps.push(`the seller policy fields checkout requires ${describe(missingCheckout)}`);
  if (gaps.length > 0) {
    return warn(
      `${sample.length} sampled feed item(s) carry the nine required OpenAI fields but lack ${gaps.join(' and ')}`,
      evidence,
    );
  }
  return pass(
    `${sample.length} sampled feed item(s) carry the nine required OpenAI fields, the return fields and the seller policy fields`,
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

export const shopifyAgenticStorefront = defineCheck('B5.8', async ({ target, fetcher }) => {
  if (target.platform !== 'shopify') {
    return skip('not_applicable', 'requires Shopify, which was not detected', {
      platform: target.platform,
    });
  }
  if (target.shopifyHosted === false) {
    return skip('not_applicable', HEADLESS_SHOPIFY, {
      platform: target.platform,
      shopify_hosted: false,
    });
  }
  const linkHeader = target.home.headers.link ?? null;
  const linkDeclared = linkHeader !== null && hasUcpLinkRelation(linkHeader);
  const endpoint = `${target.origin}/api/ucp/mcp`;
  const probe = await probeMcpEndpoint(fetcher, endpoint);
  const answers = probe.outcome === 'rpc' || probe.outcome === 'auth';
  // Shopify's stock robots.txt disallows /api/ for every crawler; the scanner honours it,
  // so on such a store the probe never leaves and the status is 0 with the gate's reason.
  const notRequested = blockedByRobots({ status: probe.status, error: probe.detail });
  const evidence = {
    link_header: linkHeader,
    link_declared: linkDeclared,
    endpoint,
    endpoint_status: probe.status,
    endpoint_answers: answers,
    endpoint_requested: !notRequested,
    probe: probe.detail,
  };
  if (linkDeclared && answers) {
    return pass(
      `agentic storefront active: the homepage links /.well-known/ucp and /api/ucp/mcp answers (HTTP ${probe.status})`,
      evidence,
    );
  }
  if (linkDeclared && notRequested) {
    return warn(
      `the homepage links /.well-known/ucp, but the scanner did not call /api/ucp/mcp because the store's robots.txt disallows it (${probe.detail}); the endpoint could not be verified`,
      evidence,
    );
  }
  if (linkDeclared) {
    return warn(
      `the homepage links /.well-known/ucp but /api/ucp/mcp ${probeAnswer(probe)}`,
      evidence,
    );
  }
  if (answers) {
    return warn(
      `/api/ucp/mcp answers (HTTP ${probe.status}) but the homepage sends no Link rel="ucp" header`,
      evidence,
    );
  }
  return fail(
    `no Link rel="ucp" header on the homepage and /api/ucp/mcp ${probeAnswer(probe)}`,
    evidence,
  );
});

/** How the MCP endpoint answered, for a message: the status, or the fetcher's reason when there was none. */
function probeAnswer(probe: McpProbe): string {
  if (probe.status === 0) return `could not be fetched (${probe.detail})`;
  return `returned ${describeFailure({ status: probe.status })}`;
}
