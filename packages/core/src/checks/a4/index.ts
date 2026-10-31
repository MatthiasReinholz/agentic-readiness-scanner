import { contentType, type FetchedResponse, type Fetcher } from '../../http/types.js';
import { attribute, type HtmlDocument } from '../../parsers/html.js';
import { hasLinkRelation, parseLinkHeader } from '../../parsers/link-header.js';
import { parseLlmsTxt } from '../../parsers/llms-txt.js';
import { probeMcpEndpoint } from '../mcp.js';
import type { Target } from '../../target/types.js';
import { productPages } from '../shared.js';
import { defineCheck, fail, pass, skip, warn, type CheckOutcome, type Evidence } from '../types.js';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeHtml(body: string): boolean {
  return /<html|<!doctype/i.test(body.slice(0, 500));
}

/** The body as JSON, or undefined when it is empty, HTML or malformed. */
function parseJson(body: string): unknown {
  if (body.trim() === '' || looksLikeHtml(body)) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** `value` as an absolute http(s) URL resolved against `base`, or null. */
function httpUrl(value: unknown, base: string): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value, base);
    url.hash = '';
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

interface Probe {
  url: string;
  status: number;
}

/** Fetches and records the attempt, so evidence lists every URL tried with its status. */
async function probe(fetcher: Fetcher, url: string, tried: Probe[]): Promise<FetchedResponse> {
  const response = await fetcher.fetch(url);
  tried.push({ url, status: response.status });
  return response;
}

// A4.1 MCP server discoverable

export interface ServerCard {
  name: string;
  endpoint: string;
}

const ENDPOINT_LISTS = ['remotes', 'transports', 'endpoints'] as const;

/**
 * A server card parses when it names the server (`name`, or `serverInfo.name` as in an
 * initialize result) and lists at least one endpoint URL in one of the shapes seen in
 * the wild: `endpoint`, `url`, or `remotes[].url` / `transports[].url` / `endpoints[].url`.
 */
export function parseServerCard(value: unknown, base: string): ServerCard | null {
  if (!isRecord(value)) return null;
  const serverInfo = isRecord(value.serverInfo) ? value.serverInfo : null;
  const rawName =
    typeof value.name === 'string'
      ? value.name
      : typeof serverInfo?.name === 'string'
        ? serverInfo.name
        : '';
  const name = rawName.trim();
  if (name === '') return null;
  const candidates: unknown[] = [value.endpoint, value.url];
  for (const key of ENDPOINT_LISTS) {
    const list = value[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list.slice(0, 10)) {
      if (isRecord(entry)) candidates.push(entry.url);
    }
  }
  for (const candidate of candidates) {
    const endpoint = httpUrl(candidate, base);
    if (endpoint) return { name, endpoint };
  }
  return null;
}

const MCP_CARD_TYPE = 'application/mcp-server-card+json';
/** Requests one run of A4.1 may send; the last one is kept for the community path. */
const MAX_PROBES = 6;
const MAX_CATALOG_CARDS = 2;
const MAX_HINTS = 2;

/** `<endpoint>/server-card`, the location the Server Card extension recommends. */
export function serverCardUrl(endpoint: string): string {
  const url = new URL(endpoint);
  url.search = '';
  url.hash = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/server-card`;
  return url.href;
}

/**
 * MCP endpoint hints: a `Link: <...>; rel="mcp-server"` header on the home page, then
 * llms.txt links whose path mentions mcp. The llms.txt fetch is shared with A1.5.
 */
async function endpointHints(target: Target, fetcher: Fetcher, tried: Probe[]): Promise<string[]> {
  const hints = new Set<string>();
  // Only this site's own endpoints (same host or a subdomain of its registrable domain):
  // a documentation link to another host is not a hint.
  const site = target.hostname.split('.').slice(-2).join('.');
  const sameOrigin = (url: string | null): string | null => {
    if (!url) return null;
    const host = new URL(url).hostname;
    return host === target.hostname || host.endsWith(`.${site}`) ? url : null;
  };
  for (const link of parseLinkHeader(target.home.headers.link)) {
    if (!hasLinkRelation(link, 'mcp-server')) continue;
    const url = sameOrigin(httpUrl(link.href, target.home.finalUrl));
    if (url) hints.add(url);
  }
  const llms = await probe(fetcher, `${target.origin}/llms.txt`, tried);
  if (llms.status === 200 && !looksLikeHtml(llms.body)) {
    for (const link of parseLlmsTxt(llms.body).links) {
      const url = sameOrigin(httpUrl(link.url, target.origin));
      if (url && /mcp/i.test(new URL(url).pathname)) hints.add(url);
    }
  }
  return [...hints].slice(0, MAX_HINTS);
}

async function fetchServerCard(
  fetcher: Fetcher,
  url: string,
  tried: Probe[],
): Promise<ServerCard | null> {
  const response = await probe(fetcher, url, tried);
  if (response.status !== 200) return null;
  return parseServerCard(parseJson(response.body), url);
}

export const mcpServerDiscoverable = defineCheck('A4.1', async ({ target, fetcher }) => {
  const tried: Probe[] = [];
  const found = (
    card: ServerCard,
    source: 'ai-catalog' | 'server-card' | 'community',
    cardUrl: string,
  ): Evidence => ({
    tried,
    source,
    card_url: cardUrl,
    name: card.name,
    endpoint: card.endpoint,
  });

  // (1) The AI Catalog: entries of the server card type, inline or by URL.
  const catalogUrl = `${target.origin}/.well-known/ai-catalog.json`;
  const catalogResponse = await probe(fetcher, catalogUrl, tried);
  const catalog = catalogResponse.status === 200 ? parseJson(catalogResponse.body) : undefined;
  if (isRecord(catalog) && Array.isArray(catalog.entries)) {
    const entries = catalog.entries
      .filter((entry): entry is JsonRecord => isRecord(entry) && entry.type === MCP_CARD_TYPE)
      .slice(0, MAX_CATALOG_CARDS);
    for (const entry of entries) {
      const inline = parseServerCard(entry.data, catalogUrl);
      if (inline) {
        return pass(
          `MCP server "${inline.name}" at ${inline.endpoint} (card inline in ai-catalog.json)`,
          found(inline, 'ai-catalog', catalogUrl),
        );
      }
      const cardUrl = httpUrl(entry.url, catalogUrl);
      if (!cardUrl) continue;
      const card = await fetchServerCard(fetcher, cardUrl, tried);
      if (card) {
        return pass(
          `MCP server "${card.name}" at ${card.endpoint} (card listed in ai-catalog.json)`,
          found(card, 'ai-catalog', cardUrl),
        );
      }
    }
  }

  // (2) Endpoint hints, each probed at <endpoint>/server-card.
  const hints = await endpointHints(target, fetcher, tried);
  for (const hint of hints) {
    if (tried.length >= MAX_PROBES - 1) break;
    const cardUrl = serverCardUrl(hint);
    const card = await fetchServerCard(fetcher, cardUrl, tried);
    if (card) {
      return pass(`MCP server "${card.name}" at ${card.endpoint} (card at ${cardUrl})`, {
        ...found(card, 'server-card', cardUrl),
        hints,
      });
    }
  }

  // (3) The community path, which the specification does not define.
  const communityUrl = `${target.origin}/.well-known/mcp/server-card.json`;
  const community = await fetchServerCard(fetcher, communityUrl, tried);
  if (community) {
    return warn(
      `MCP server "${community.name}" at ${community.endpoint} is advertised only at the community path /.well-known/mcp/server-card.json`,
      { ...found(community, 'community', communityUrl), hints },
    );
  }
  return fail(
    'no MCP server card found via ai-catalog.json, an endpoint hint or the community path',
    { tried, hints },
  );
});

// A4.2 API catalog

const LINKSET_TYPE = 'application/linkset+json';

interface LinksetSummary {
  entries: number;
  entries_with_links: number;
  items: number;
  relations: string[];
  anchors: string[];
}

/** Counts the link contexts and relations of an RFC 9264 linkset (`item` is the api-catalog relation). */
export function summarizeLinkset(linkset: unknown[]): LinksetSummary {
  const summary: LinksetSummary = {
    entries: 0,
    entries_with_links: 0,
    items: 0,
    relations: [],
    anchors: [],
  };
  const relations = new Set<string>();
  for (const entry of linkset.slice(0, 50)) {
    if (!isRecord(entry)) continue;
    summary.entries += 1;
    if (typeof entry.anchor === 'string' && summary.anchors.length < 5) {
      summary.anchors.push(entry.anchor);
    }
    let links = 0;
    for (const [relation, targets] of Object.entries(entry)) {
      if (relation === 'anchor' || !Array.isArray(targets)) continue;
      links += targets.length;
      relations.add(relation);
      if (relation === 'item') summary.items += targets.length;
    }
    if (links > 0) summary.entries_with_links += 1;
  }
  summary.relations = [...relations].slice(0, 10);
  return summary;
}

export const apiCatalogPublished = defineCheck('A4.2', async ({ target, fetcher }) => {
  const url = `${target.origin}/.well-known/api-catalog`;
  const response = await fetcher.fetch(url);
  const type = contentType(response);
  const evidence: Evidence = { url, status: response.status, content_type: type };
  if (response.status !== 200) {
    return fail(`api-catalog returned HTTP ${response.status}`, evidence);
  }
  if (looksLikeHtml(response.body)) {
    return fail('api-catalog returned HTML (soft 404 or challenge page)', evidence);
  }
  const parsed = parseJson(response.body);
  const linkset = isRecord(parsed) && Array.isArray(parsed.linkset) ? parsed.linkset : null;
  if (!linkset) {
    return fail(
      type === LINKSET_TYPE
        ? 'api-catalog is served as application/linkset+json but carries no linkset array'
        : 'api-catalog is neither application/linkset+json nor a JSON linkset document',
      evidence,
    );
  }
  const summary = summarizeLinkset(linkset);
  Object.assign(evidence, summary);
  if (summary.entries_with_links === 0) {
    return fail('api-catalog linkset lists no links', evidence);
  }
  const served = type === LINKSET_TYPE ? '' : ` (served as ${type || 'no content type'})`;
  return pass(
    `api-catalog linkset with ${summary.entries_with_links} link context(s) and ${summary.items} item link(s)${served}`,
    evidence,
  );
});

// A4.3 and A4.4 read the endpoint A4.1 discovered.

/** The absolute http(s) endpoint A4.1 recorded, or null when it recorded none. */
function endpointFrom(outcomes: ReadonlyMap<string, CheckOutcome>): string | null {
  const endpoint = outcomes.get('A4.1')?.evidence.endpoint;
  if (typeof endpoint !== 'string') return null;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' || url.protocol === 'https:' ? endpoint : null;
  } catch {
    return null;
  }
}

const NO_ENDPOINT = 'no MCP endpoint was discovered by A4.1';

// A4.3 OAuth discovery for the MCP endpoint

/** The authorization servers of RFC 9728 metadata, or null when it is not such a document. */
function authorizationServersOf(value: unknown): string[] | null {
  if (!isRecord(value) || !Array.isArray(value.authorization_servers)) return null;
  const servers = value.authorization_servers.filter(
    (server): server is string => typeof server === 'string',
  );
  return servers.length > 0 ? servers.slice(0, 10) : null;
}

function isAuthorizationServerMetadata(value: unknown): value is JsonRecord & { issuer: string } {
  return (
    isRecord(value) &&
    typeof value.issuer === 'string' &&
    (typeof value.authorization_endpoint === 'string' || typeof value.token_endpoint === 'string')
  );
}

/** The resource_metadata URL a WWW-Authenticate challenge names (RFC 9728 section 5.1), or null. */
export function resourceMetadataUrl(header: string | undefined): string | null {
  if (!header) return null;
  const match = /resource_metadata\s*=\s*"?([^"\s,]{1,2048})/i.exec(header.slice(0, 4096));
  return match?.[1] ?? null;
}

const HEADER_EVIDENCE_LIMIT = 300;

export const oauthDiscoveryForMcp = defineCheck('A4.3', async ({ fetcher, outcomes }) => {
  const endpoint = endpointFrom(outcomes);
  if (!endpoint) return skip('dependency_failed', NO_ENDPOINT);
  const resource = new URL(endpoint);
  const path = resource.pathname.replace(/\/+$/, '');
  const tried: Probe[] = [];
  const evidence: Evidence = { endpoint, tried };

  const wellKnown = `${resource.origin}/.well-known/oauth-protected-resource`;
  const metadataUrls = path === '' ? [wellKnown] : [`${wellKnown}${path}`, wellKnown];
  for (const url of metadataUrls) {
    const response = await probe(fetcher, url, tried);
    const servers =
      response.status === 200 ? authorizationServersOf(parseJson(response.body)) : null;
    if (servers) {
      evidence.resource_metadata_url = url;
      evidence.authorization_servers = servers;
      return pass(
        `protected resource metadata at ${url} names ${servers.length} authorization server(s)`,
        evidence,
      );
    }
  }

  const endpointResponse = await probe(fetcher, endpoint, tried);
  const challenge = endpointResponse.headers['www-authenticate'];
  evidence.endpoint_status = endpointResponse.status;
  evidence.www_authenticate = challenge ? challenge.slice(0, HEADER_EVIDENCE_LIMIT) : null;
  const challengeUrl = resourceMetadataUrl(challenge);
  if (endpointResponse.status === 401 && challengeUrl) {
    evidence.resource_metadata_url = challengeUrl;
    return pass(`the endpoint answers 401 with WWW-Authenticate naming ${challengeUrl}`, evidence);
  }

  const serverUrl = `${resource.origin}/.well-known/oauth-authorization-server`;
  const serverResponse = await probe(fetcher, serverUrl, tried);
  const serverMetadata = serverResponse.status === 200 ? parseJson(serverResponse.body) : undefined;
  if (isAuthorizationServerMetadata(serverMetadata)) {
    evidence.issuer = serverMetadata.issuer;
    return warn(
      `only authorization server metadata (issuer ${serverMetadata.issuer}) was found; no protected resource metadata for the MCP endpoint`,
      evidence,
    );
  }
  return fail(
    'no protected resource metadata, resource_metadata challenge or authorization server metadata for the MCP endpoint',
    evidence,
  );
});

// A4.4 MCP endpoint reachable

export const mcpEndpointReachable = defineCheck('A4.4', async ({ fetcher, outcomes }) => {
  const endpoint = endpointFrom(outcomes);
  if (!endpoint) return skip('dependency_failed', NO_ENDPOINT);
  const probe = await probeMcpEndpoint(fetcher, endpoint);
  const evidence: Evidence = { ...probe };
  switch (probe.outcome) {
    case 'rpc':
      return pass(
        `the endpoint answers server/discover with a JSON-RPC message (HTTP ${probe.status})`,
        evidence,
      );
    case 'auth':
      return pass(
        'the endpoint requires authorization and names a scheme in WWW-Authenticate',
        evidence,
      );
    case 'unreachable':
      return fail(`the MCP endpoint could not be fetched: ${probe.detail}`, evidence);
    default:
      return fail(
        probe.status === 404
          ? 'the endpoint answers 404; the card points nowhere'
          : `the endpoint does not answer like an MCP server (${probe.detail})`,
        evidence,
      );
  }
});

// A4.5 A2A agent card

const A2A_REQUIRED_FIELDS = [
  'name',
  'description',
  'supportedInterfaces',
  'version',
  'capabilities',
  'defaultInputModes',
  'defaultOutputModes',
  'skills',
];

function agentCardFields(card: JsonRecord): { present: string[]; missing: string[] } {
  const present = A2A_REQUIRED_FIELDS.filter((field) => card[field] !== undefined);
  const missing = A2A_REQUIRED_FIELDS.filter((field) => card[field] === undefined);
  return { present, missing };
}

export const a2aAgentCard = defineCheck('A4.5', async ({ target, fetcher }) => {
  const currentPath = '/.well-known/agent-card.json';
  const legacyPath = '/.well-known/agent.json';
  const first = await fetcher.fetch(`${target.origin}${currentPath}`);
  const evidence: Evidence = {
    url: `${target.origin}${currentPath}`,
    status: first.status,
    content_type: contentType(first),
    path: null,
    present: [],
    missing: A2A_REQUIRED_FIELDS,
  };
  if (first.status === 200) {
    const card = parseJson(first.body);
    if (!isRecord(card)) {
      return fail('agent-card.json answered 200 but is not a JSON object', evidence);
    }
    const fields = agentCardFields(card);
    Object.assign(evidence, {
      path: currentPath,
      ...fields,
      name: typeof card.name === 'string' ? card.name : null,
    });
    if (fields.missing.length > 0) {
      return warn(`A2A agent card lacks ${fields.missing.join(', ')}`, evidence);
    }
    return pass(
      `A2A agent card "${typeof card.name === 'string' ? card.name : ''}" with every required field`,
      evidence,
    );
  }
  const second = await fetcher.fetch(`${target.origin}${legacyPath}`);
  evidence.legacy_status = second.status;
  const legacyCard = second.status === 200 ? parseJson(second.body) : undefined;
  if (isRecord(legacyCard)) {
    Object.assign(evidence, {
      path: legacyPath,
      ...agentCardFields(legacyCard),
      name: typeof legacyCard.name === 'string' ? legacyCard.name : null,
    });
    return warn('A2A agent card found only at the pre-0.3 path /.well-known/agent.json', evidence);
  }
  return fail(
    'no A2A agent card at /.well-known/agent-card.json or /.well-known/agent.json',
    evidence,
  );
});

// A4.6 WebMCP tool declarations

const MODEL_CONTEXT = /(?:document|navigator)\.modelContext\b/;
const SCRIPT_TEXT_LIMIT = 200_000;

export interface WebMcpSignals {
  /** toolname values of the declarative tools on the page. */
  tools: string[];
  /** Elements carrying toolparamdescription. */
  parameters: number;
  /** Inline scripts referencing document.modelContext or navigator.modelContext. */
  scripts: number;
}

export function webMcpSignals(doc: HtmlDocument): WebMcpSignals {
  const tools = doc
    .find('*', 'toolname', /\S/)
    .map((element) => (attribute(element, 'toolname') ?? '').trim());
  const parameters = doc.find('*', 'toolparamdescription', /\S/).length;
  const scripts = doc
    .inlineScripts()
    .filter((text) => MODEL_CONTEXT.test(text.slice(0, SCRIPT_TEXT_LIMIT))).length;
  return { tools, parameters, scripts };
}

export const webMcpToolDeclarations = defineCheck('A4.6', async ({ target, fetcher }) => {
  const pages = [
    { url: target.sampled.home, doc: target.homeDoc },
    ...(await productPages(target, fetcher)),
  ];
  const names = new Set<string>();
  const pagesWithDeclarations: string[] = [];
  let tools = 0;
  let parameters = 0;
  let scripts = 0;
  for (const page of pages) {
    const signals = webMcpSignals(page.doc);
    if (signals.tools.length > 0 || signals.scripts > 0) pagesWithDeclarations.push(page.url);
    tools += signals.tools.length;
    parameters += signals.parameters;
    scripts += signals.scripts;
    for (const name of signals.tools) names.add(name);
  }
  const evidence: Evidence = {
    pages_scanned: pages.length,
    declarative_tools: tools,
    tool_names: [...names].slice(0, 10),
    tool_param_descriptions: parameters,
    scripts_with_model_context: scripts,
    pages_with_declarations: pagesWithDeclarations,
  };
  if (tools === 0 && scripts === 0) {
    return pass('no WebMCP declarations (informational)', evidence);
  }
  const parts: string[] = [];
  if (tools > 0) parts.push(`${tools} declarative tool(s): ${[...names].slice(0, 10).join(', ')}`);
  if (scripts > 0) parts.push(`${scripts} inline script(s) using modelContext`);
  return pass(`WebMCP declarations found: ${parts.join('; ')}`, evidence);
});
