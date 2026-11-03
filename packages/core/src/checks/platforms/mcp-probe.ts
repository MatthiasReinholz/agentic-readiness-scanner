import type { Fetcher } from '../../http/types.js';
import { probeMcpEndpoint, type McpProbe } from '../mcp.js';
import { blockedByRobots } from '../shared.js';

/**
 * Probes a platform's documented MCP endpoint and says in a few words what came back:
 * a JSON-RPC answer or an authorization challenge proves a live server; robots.txt may
 * keep the scanner from asking; anything else means no server answered.
 */
export async function probePlatformMcp(
  fetcher: Fetcher,
  endpoint: string,
): Promise<{ probe: McpProbe; state: 'live' | 'robots' | 'unreachable' | 'none' }> {
  const probe = await probeMcpEndpoint(fetcher, endpoint);
  if (probe.outcome === 'rpc' || probe.outcome === 'auth') return { probe, state: 'live' };
  if (probe.status === 0 && blockedByRobots({ status: 0, error: probe.detail }))
    return { probe, state: 'robots' };
  if (probe.outcome === 'unreachable') return { probe, state: 'unreachable' };
  return { probe, state: 'none' };
}
