import { contentType, type FetchedResponse, type Fetcher } from '../http/types.js';
import { SCANNER_VERSION } from '../version.js';

/**
 * The one request the scanner sends with a body: a JSON-RPC `server/discover` to an MCP
 * endpoint the site itself advertises. It is the read-only method the 2026-07-28
 * specification makes mandatory; older servers answer it with a JSON-RPC error, which
 * proves the transport just as well. A server on the 2025 session transport may instead
 * refuse any method but `initialize` with a plain HTTP 400 ("Session ID required"); the
 * scanner then sends that handshake once, as every client does. Nothing is created or
 * changed on the server beyond the session the handshake opens.
 */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

export interface McpProbe {
  endpoint: string;
  method: string;
  status: number;
  content_type: string;
  www_authenticate: boolean;
  /** The body parsed as a JSON-RPC message (result or error). */
  jsonrpc: boolean;
  outcome: 'rpc' | 'auth' | 'none' | 'unreachable';
  detail: string;
}

/** The per-request metadata the 2026-07-28 transport carries instead of a session. */
function requestMeta(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': {
      name: 'AgenticReadinessScanner',
      version: SCANNER_VERSION,
    },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

function discoverBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'server/discover',
    params: { _meta: requestMeta() },
  });
}

/** The JSON-RPC message in a body, plain or in server-sent-event framing, or null. */
export function jsonRpcMessage(body: string): Record<string, unknown> | null {
  const text = body.trim();
  // SSE framing: the first data line carries the JSON-RPC message.
  const data =
    text.startsWith('event:') || text.startsWith('data:')
      ? (text.split('\n').find((line) => line.startsWith('data:')) ?? '').slice(5).trim()
      : text;
  if (!data.startsWith('{')) return null;
  try {
    // The fetcher caps bodies (2 MB by default). A tool list with full schemas can pass
    // 200 KB, so the whole body is parsed.
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === 'object' && parsed !== null && 'jsonrpc' in parsed ? parsed : null;
  } catch {
    return null;
  }
}

export function isJsonRpcBody(body: string): boolean {
  return jsonRpcMessage(body) !== null;
}

export function classifyMcpResponse(endpoint: string, response: FetchedResponse): McpProbe {
  const type = contentType(response);
  const challenge = Boolean(response.headers['www-authenticate']);
  const jsonrpc = isJsonRpcBody(response.body);
  const base = {
    endpoint,
    method: 'POST server/discover',
    status: response.status,
    content_type: type,
    www_authenticate: challenge,
    jsonrpc,
  };
  if (response.status === 0) {
    return { ...base, outcome: 'unreachable', detail: response.error ?? 'no response' };
  }
  if (jsonrpc || type === 'text/event-stream') {
    return { ...base, outcome: 'rpc', detail: `JSON-RPC answer with HTTP ${response.status}` };
  }
  if (response.status === 401 && challenge) {
    return { ...base, outcome: 'auth', detail: 'HTTP 401 with WWW-Authenticate' };
  }
  return {
    ...base,
    outcome: 'none',
    detail: `HTTP ${response.status} with ${type || 'no content type'} and no JSON-RPC body`,
  };
}

/** The 2025-06-18 handshake, for servers that accept nothing else before a session exists. */
export const MCP_LEGACY_PROTOCOL_VERSION = '2025-06-18';

function initializeBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'AgenticReadinessScanner', version: SCANNER_VERSION },
    },
  });
}

/**
 * POSTs server/discover to the endpoint and classifies the answer; after a plain HTTP 400
 * it tries the 2025 initialize handshake once and keeps that answer when it is JSON-RPC.
 */
export async function probeMcpEndpoint(fetcher: Fetcher, endpoint: string): Promise<McpProbe> {
  const discover = await discoverProbe(fetcher, endpoint);
  if (discover.outcome !== 'none' || discover.status !== 400) return discover;
  const response = await fetcher.fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_LEGACY_PROTOCOL_VERSION,
    },
    body: initializeBody(),
  });
  const handshake = classifyMcpResponse(endpoint, response);
  return handshake.outcome === 'rpc'
    ? {
        ...handshake,
        method: 'POST initialize',
        detail: `${handshake.detail} to initialize, after server/discover answered HTTP 400`,
      }
    : discover;
}

async function discoverProbe(fetcher: Fetcher, endpoint: string): Promise<McpProbe> {
  const response = await fetcher.fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
      'mcp-method': 'server/discover',
    },
    body: discoverBody(),
  });
  return classifyMcpResponse(endpoint, response);
}

export interface McpToolList {
  endpoint: string;
  /** How the list was obtained, or why it was not. */
  outcome: 'tools' | 'auth' | 'robots' | 'unreachable' | 'none';
  status: number;
  tools: string[];
  /** True when the server needed the 2025 initialize handshake and a session first. */
  session: boolean;
  detail: string;
}

function toolNames(message: Record<string, unknown> | null): string[] | null {
  const result = message?.result;
  if (typeof result !== 'object' || result === null) return null;
  const tools = (result as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) return null;
  return tools
    .map((tool) =>
      typeof tool === 'object' && tool !== null ? (tool as Record<string, unknown>).name : null,
    )
    .filter((name): name is string => typeof name === 'string');
}

/**
 * Lists the tools of an MCP server the site advertises, read-only: a stateless
 * tools/list as the 2026-07-28 transport allows, and when the server refuses that without
 * a session, the 2025 initialize handshake, the initialized notification and tools/list
 * in that session. At most four requests.
 */
export async function listMcpTools(fetcher: Fetcher, endpoint: string): Promise<McpToolList> {
  const base = { endpoint, session: false };
  const json = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  const first = await fetcher.fetch(endpoint, {
    method: 'POST',
    headers: { ...json, 'mcp-protocol-version': MCP_PROTOCOL_VERSION, 'mcp-method': 'tools/list' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: requestMeta() },
    }),
  });
  if (first.status === 0) {
    const robots = /robots\.txt/i.test(first.error ?? '');
    return {
      ...base,
      outcome: robots ? 'robots' : 'unreachable',
      status: 0,
      tools: [],
      detail: first.error ?? 'no response',
    };
  }
  const direct = toolNames(jsonRpcMessage(first.body));
  if (direct)
    return {
      ...base,
      outcome: 'tools',
      status: first.status,
      tools: direct,
      detail: `tools/list answered with ${direct.length} tool(s)`,
    };
  // A 401 asks for authorization, even when the server leaves out WWW-Authenticate.
  if (first.status === 401) {
    return {
      ...base,
      outcome: 'auth',
      status: 401,
      tools: [],
      detail: first.headers['www-authenticate'] ? 'HTTP 401 with WWW-Authenticate' : 'HTTP 401',
    };
  }
  const init = await fetcher.fetch(endpoint, {
    method: 'POST',
    headers: { ...json, 'mcp-protocol-version': MCP_LEGACY_PROTOCOL_VERSION },
    body: initializeBody(),
  });
  if (!jsonRpcMessage(init.body)) {
    return {
      ...base,
      outcome: 'none',
      status: first.status,
      tools: [],
      detail: `HTTP ${first.status} to tools/list and HTTP ${init.status} to initialize, neither with a JSON-RPC body`,
    };
  }
  const sessionId = init.headers['mcp-session-id'];
  const session: Record<string, string> = {
    ...json,
    'mcp-protocol-version': MCP_LEGACY_PROTOCOL_VERSION,
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
  };
  await fetcher.fetch(endpoint, {
    method: 'POST',
    headers: session,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  const listed = await fetcher.fetch(endpoint, {
    method: 'POST',
    headers: session,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  const names = toolNames(jsonRpcMessage(listed.body));
  return names
    ? {
        ...base,
        session: true,
        outcome: 'tools',
        status: listed.status,
        tools: names,
        detail: `tools/list answered with ${names.length} tool(s) after the initialize handshake`,
      }
    : {
        ...base,
        session: true,
        outcome: 'none',
        status: listed.status,
        tools: [],
        detail: `HTTP ${listed.status} to tools/list after the initialize handshake, without a tool list`,
      };
}
