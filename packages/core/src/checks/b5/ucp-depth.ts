/**
 * Two checks that look deeper into a UCP profile B5.1 found: whether its signing keys are
 * usable public keys, and whether the MCP binding it declares offers the tools for the
 * capabilities it declares.
 */
import { isRecord, nonEmptyString, recordEntries } from '../json.js';
import { listMcpTools } from '../mcp.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';

/** JWK members that only a private or symmetric key carries (RFC 7517, RFC 7518). */
const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'] as const;
/** Public members UCP requires per key type, besides kid and kty. */
const REQUIRED_BY_TYPE: Record<string, readonly string[]> = {
  EC: ['crv', 'x', 'y'],
  OKP: ['crv', 'x'],
};

export const ucpSigningKeys = defineCheck('B5.10', ({ outcomes }) => {
  const keys = outcomes.get('B5.1')?.evidence.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    return skip(
      'not_applicable',
      'the UCP profile publishes no signing keys (they are optional)',
      {},
    );
  }
  const exposed: string[] = [];
  const incomplete: string[] = [];
  const kids: string[] = [];
  keys.forEach((key, index) => {
    const label = isRecord(key) && nonEmptyString(key.kid) ? key.kid : `key ${index + 1}`;
    if (!isRecord(key)) {
      incomplete.push(`${label} is not a JSON object`);
      return;
    }
    const secret = PRIVATE_MEMBERS.filter((member) => key[member] !== undefined);
    if (secret.length > 0 || key.kty === 'oct') {
      exposed.push(`${label} (${key.kty === 'oct' ? 'a symmetric secret' : secret.join(', ')})`);
    }
    const kty = typeof key.kty === 'string' ? key.kty : '';
    const missing = ['kid', 'kty', ...(REQUIRED_BY_TYPE[kty] ?? [])].filter(
      (member) => !nonEmptyString(key[member]),
    );
    if (missing.length > 0) incomplete.push(`${label} lacks ${missing.join(', ')}`);
    if (nonEmptyString(key.kid)) kids.push(key.kid);
  });
  const duplicates = [...new Set(kids.filter((kid, index) => kids.indexOf(kid) !== index))];
  const evidence = { keys: keys.length, kids, exposed, incomplete, duplicate_kids: duplicates };
  if (exposed.length > 0) {
    return fail(
      `the UCP profile publishes private key material: ${exposed.join(', ')}. Anyone can sign as this store with it, so the key must be replaced, not only removed`,
      evidence,
    );
  }
  const problems = [
    ...incomplete,
    ...(duplicates.length > 0 ? [`kid ${duplicates.join(', ')} is used more than once`] : []),
  ];
  if (problems.length > 0) {
    return warn(`the UCP signing keys cannot all be used: ${problems.join(', ')}`, evidence);
  }
  return pass(
    `${keys.length} UCP signing key(s), all public and complete (${kids.join(', ')})`,
    evidence,
  );
});

/** The MCP tools UCP's bindings define for each capability. */
export const UCP_MCP_TOOLS: Record<string, readonly string[]> = {
  'dev.ucp.shopping.checkout': [
    'create_checkout',
    'get_checkout',
    'update_checkout',
    'complete_checkout',
    'cancel_checkout',
  ],
  'dev.ucp.shopping.cart': ['create_cart', 'get_cart', 'update_cart', 'cancel_cart'],
};

export const ucpMcpTools = defineCheck('B5.11', async ({ fetcher, outcomes }) => {
  const profile = outcomes.get('B5.1')?.evidence.profile;
  if (!isRecord(profile)) return skip('error', 'B5.1 recorded no UCP profile to inspect', {});
  const services = isRecord(profile.services) ? profile.services : {};
  const endpoint = recordEntries(services['dev.ucp.shopping'])
    .filter((entry) => entry.transport === 'mcp')
    .map((entry) => entry.endpoint)
    .find(nonEmptyString);
  if (!endpoint) {
    return skip('not_applicable', 'the UCP profile declares no MCP binding for shopping', {});
  }
  const capabilities = isRecord(profile.capabilities) ? profile.capabilities : {};
  const declared = Object.keys(UCP_MCP_TOOLS).filter(
    (id) => Array.isArray(capabilities[id]) && (capabilities[id] as unknown[]).length > 0,
  );
  if (declared.length === 0) {
    return skip(
      'not_applicable',
      'the UCP profile declares neither the checkout nor the cart capability',
      {
        endpoint,
      },
    );
  }
  const listing = await listMcpTools(fetcher, endpoint);
  const evidence: Record<string, unknown> = { ...listing, declared };
  switch (listing.outcome) {
    case 'robots':
      return warn(
        `the scanner did not call the MCP endpoint ${endpoint} because robots.txt disallows it, so its tools could not be listed`,
        evidence,
      );
    case 'unreachable':
      return skip(
        'error',
        `the MCP endpoint ${endpoint} could not be reached (${listing.detail})`,
        evidence,
      );
    case 'auth':
      return skip(
        'error',
        `the MCP endpoint ${endpoint} requires authorization before it lists its tools, so they could not be compared`,
        evidence,
      );
    case 'none':
      return fail(
        `the MCP endpoint the UCP profile declares does not list tools (${listing.detail})`,
        evidence,
      );
    default:
      break;
  }
  const available = new Set(listing.tools);
  const missing = Object.fromEntries(
    declared
      .map((id) => [id, (UCP_MCP_TOOLS[id] ?? []).filter((tool) => !available.has(tool))] as const)
      .filter(([, tools]) => tools.length > 0),
  );
  evidence.missing = missing;
  const expected = declared.flatMap((id) => UCP_MCP_TOOLS[id] ?? []);
  const found = expected.filter((tool) => available.has(tool));
  const named = `${declared.join(' and ')} ${declared.length > 1 ? 'capabilities' : 'capability'}`;
  if (found.length === 0) {
    return fail(
      `the MCP endpoint lists ${listing.tools.length} tool(s) but none of the UCP tools for the declared ${named}`,
      evidence,
    );
  }
  if (Object.keys(missing).length > 0) {
    const detail = Object.entries(missing)
      .map(([id, tools]) => `${id} lacks ${tools.join(', ')}`)
      .join(', and ');
    return warn(
      `the MCP endpoint lists ${found.length} of ${expected.length} UCP tools: ${detail}`,
      evidence,
    );
  }
  return pass(
    `the MCP endpoint lists every UCP tool for the declared ${named} (${expected.length} tools)`,
    evidence,
  );
});
