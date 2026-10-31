import { contentType, type FetchedResponse, type Fetcher } from '../http/types.js';
import { SCANNER_VERSION } from '../version.js';

/**
 * The one request the scanner sends with a body: a JSON-RPC `server/discover` to an MCP
 * endpoint the site itself advertises. It is the read-only method the 2026-07-28
 * specification makes mandatory; older servers answer it with a JSON-RPC error, which
 * proves the transport just as well. Nothing is created or changed on the server.
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

function discoverBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'server/discover',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientInfo': {
          name: 'AgenticReadinessScanner',
          version: SCANNER_VERSION,
        },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  });
}

export function isJsonRpcBody(body: string): boolean {
  const text = body.trim();
  // SSE framing: the first data line carries the JSON-RPC message.
  const data =
    text.startsWith('event:') || text.startsWith('data:')
      ? (text.split('\n').find((line) => line.startsWith('data:')) ?? '').slice(5).trim()
      : text;
  if (!data.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(data.slice(0, 200_000));
    return typeof parsed === 'object' && parsed !== null && 'jsonrpc' in parsed;
  } catch {
    return false;
  }
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

/** POSTs server/discover to the endpoint and classifies the answer. */
export async function probeMcpEndpoint(fetcher: Fetcher, endpoint: string): Promise<McpProbe> {
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
