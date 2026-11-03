import type { Fetcher } from '../../http/types.js';
import { probeMcpEndpoint, type McpProbe } from '../mcp.js';
import { blockedByRobots } from '../shared.js';

/** Statuses that say nothing about the resource, as in A4.4. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/**
 * Probes a platform's documented MCP endpoint and says in a few words what came back:
 * a JSON-RPC answer or an authorization challenge proves a live server, robots.txt may
 * keep the scanner from asking, a rate limit or gateway error is inconclusive, and
 * anything else means no server answered.
 */
export async function probePlatformMcp(
  fetcher: Fetcher,
  endpoint: string,
): Promise<{ probe: McpProbe; state: 'live' | 'robots' | 'unreachable' | 'none' }> {
  const probe = await probeMcpEndpoint(fetcher, endpoint);
  if (probe.outcome === 'rpc' || probe.outcome === 'auth') return { probe, state: 'live' };
  if (probe.status === 0 && blockedByRobots({ status: 0, error: probe.detail }))
    return { probe, state: 'robots' };
  // A rate limit or a gateway failure says nothing about the server behind it.
  if (probe.outcome === 'unreachable' || TRANSIENT_STATUSES.has(probe.status))
    return { probe, state: 'unreachable' };
  return { probe, state: 'none' };
}
