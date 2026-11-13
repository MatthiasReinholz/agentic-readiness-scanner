/**
 * A4.10: the Personal Agent Protocol ("Poppy") discovery document. A company publishes
 * /.well-known/poppy.json to tell personal agents how to work with it: its company agent,
 * APIs and website, and how customers sign in (spec section 3). The check applies the
 * rules a personal agent applies before it uses the document, so a pass means an agent
 * following the spec would accept it. It never opens a session or signs in.
 */
import { contentType, type FetchedResponse, type Fetcher } from '../../http/types.js';
import {
  authorizationServerMetadataUrl,
  isHttpsUrl,
  POPPY_PATH,
  readPoppyDocument,
  type PoppySummary,
} from '../../parsers/poppy.js';
import { isRecord, looksLikeHtml, parseJson } from '../json.js';
import { blockedByRobots, describeFailure, isTransient } from '../shared.js';
import { defineCheck, fail, pass, skip, type CheckOutcome, type Evidence } from '../types.js';

const PROBLEM_LIMIT = 5;

/** A request that could not be answered (throttled, failed, or kept out by robots.txt): inconclusive. */
function unanswered(what: string, response: FetchedResponse, evidence: Evidence): CheckOutcome {
  const why = blockedByRobots(response)
    ? 'robots.txt disallows it for the scanner'
    : `it ${describeFailure(response)}`;
  return skip('error', `${what} could not be read because ${why}`, evidence);
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The issuer and what verifying it established, or the outcome that ends the check. */
type IssuerResult = { issuer: string | null; note: string } | { outcome: CheckOutcome };

/**
 * Spec 3.2: find the issuer from the domain's protected resource metadata (RFC 9728) and
 * confirm it from the issuer's own metadata (RFC 8414), which must list the domain.
 */
async function verifyIssuer(
  fetcher: Fetcher,
  domain: string,
  summary: PoppySummary,
  evidence: Evidence,
): Promise<IssuerResult> {
  const resource = `https://${domain.toLowerCase()}`;
  const resourceUrl = `${resource}/.well-known/oauth-protected-resource`;
  const resourceResponse = await fetcher.fetch(resourceUrl, {
    headers: { accept: 'application/json' },
  });
  evidence.resource_metadata_url = resourceUrl;
  evidence.resource_metadata_status = resourceResponse.status;
  if (isTransient(resourceResponse)) {
    return { outcome: unanswered('the protected resource metadata', resourceResponse, evidence) };
  }

  let servers: string[] = [];
  if (resourceResponse.status === 200) {
    const metadata = parseJson(resourceResponse.body);
    if (!isRecord(metadata)) {
      return {
        outcome: fail(
          `poppy.json is valid, but ${resourceUrl} is not JSON metadata, so an agent cannot tell whether the company has an issuer and must not use the document`,
          evidence,
        ),
      };
    }
    if (metadata.resource !== resource) {
      evidence.resource = typeof metadata.resource === 'string' ? metadata.resource : null;
      return {
        outcome: fail(
          `poppy.json is valid, but the protected resource metadata names resource ${String(metadata.resource)} instead of ${resource}, so an agent must not use the document`,
          evidence,
        ),
      };
    }
    servers = strings(metadata.authorization_servers);
  } else if (resourceResponse.status !== 404) {
    return {
      outcome: fail(
        `poppy.json is valid, but the protected resource metadata answered ${describeFailure(resourceResponse)}; an agent may only assume no issuer after a 404, so it must not use the document`,
        evidence,
      ),
    };
  }
  evidence.authorization_servers = servers.slice(0, 10);

  if (servers.length === 0) {
    if (summary.needsIssuer) {
      return {
        outcome: fail(
          'poppy.json declares sign-in (an issuer, signed_in access or Mediated Sign-In), but the domain publishes no authorization server in its protected resource metadata',
          evidence,
        ),
      };
    }
    return { issuer: null, note: 'no issuer, so agents use signed-out sessions only' };
  }

  let issuer: string;
  if (servers.length === 1) {
    issuer = servers[0] ?? '';
    if (summary.issuer !== null && summary.issuer !== issuer) {
      return {
        outcome: fail(
          `auth.issuer ${summary.issuer} is not the authorization server the protected resource metadata names (${issuer})`,
          evidence,
        ),
      };
    }
  } else {
    if (summary.issuer === null || !servers.includes(summary.issuer)) {
      return {
        outcome: fail(
          `the protected resource metadata names ${String(servers.length)} authorization servers, so auth.issuer must name one of them, and ${summary.issuer === null ? 'it is missing' : `${summary.issuer} is not among them`}`,
          evidence,
        ),
      };
    }
    issuer = summary.issuer;
  }
  evidence.issuer = issuer;
  if (!isHttpsUrl(issuer)) {
    return { outcome: fail('the issuer is not an HTTPS URL', evidence) };
  }

  const serverUrl = authorizationServerMetadataUrl(issuer);
  const serverResponse = await fetcher.fetch(serverUrl, {
    headers: { accept: 'application/json' },
  });
  evidence.authorization_server_metadata_url = serverUrl;
  evidence.authorization_server_metadata_status = serverResponse.status;
  if (isTransient(serverResponse)) {
    return { outcome: unanswered("the issuer's metadata", serverResponse, evidence) };
  }
  const metadata = serverResponse.status === 200 ? parseJson(serverResponse.body) : undefined;
  if (!isRecord(metadata)) {
    return {
      outcome: fail(
        `the issuer publishes no authorization server metadata at ${serverUrl} (${describeFailure(serverResponse)}), so an agent cannot verify it`,
        evidence,
      ),
    };
  }
  const problems: string[] = [];
  if (metadata.issuer !== issuer) problems.push(`its issuer is ${String(metadata.issuer)}`);
  // Compared after lowercasing the scheme and host only (spec 3.2, RFC 3986 6.2.2.1); the
  // entry must otherwise be exactly https://{domain}, with no path, port or trailing slash.
  const resources = strings(metadata.protected_resources).map((entry) =>
    entry.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, (authority) => authority.toLowerCase()),
  );
  if (!resources.includes(resource)) problems.push(`protected_resources does not list ${resource}`);
  for (const field of ['token_endpoint', 'revocation_endpoint'] as const) {
    if (!isHttpsUrl(metadata[field])) problems.push(`${field} is missing or not HTTPS`);
  }
  const grants = strings(metadata.grant_types_supported);
  if (!grants.includes('refresh_token'))
    problems.push('grant_types_supported does not include refresh_token');
  if (grants.includes('authorization_code') && !isHttpsUrl(metadata.authorization_endpoint))
    problems.push('authorization_endpoint is missing for authorization_code');
  if (
    grants.includes('urn:ietf:params:oauth:grant-type:device_code') &&
    !isHttpsUrl(metadata.device_authorization_endpoint)
  )
    problems.push('device_authorization_endpoint is missing for device_code');
  evidence.grant_types = grants.slice(0, 10);
  if (problems.length > 0) {
    evidence.issuer_problems = problems;
    return {
      outcome: fail(
        `the issuer's metadata does not confirm it for this domain: ${problems.join('; ')}`,
        evidence,
      ),
    };
  }
  const modes = [
    grants.includes('authorization_code') ? 'Direct Sign-In' : null,
    grants.includes('urn:ietf:params:oauth:grant-type:device_code') ? 'Device Sign-In' : null,
  ].filter((mode) => mode !== null);
  const signIn = summary.signInDisabled
    ? 'sign-in turned off'
    : modes.length > 0
      ? modes.join(' and ')
      : 'no sign-in grant beyond refresh';
  return { issuer, note: `issuer ${issuer} verified (${signIn})` };
}

function channels(summary: PoppySummary): string {
  const parts: string[] = [];
  if (summary.agentProtocols.length > 0)
    parts.push(`a company agent (${summary.agentProtocols.join(', ')})`);
  if (summary.apis.length > 0) parts.push(`APIs (${summary.apis.join(', ')})`);
  if (summary.web === 'offered') parts.push('the website');
  return parts.length > 0 ? parts.join(', ') : 'no channel agents may use';
}

export const poppyDiscovery = defineCheck('A4.10', async ({ target, fetcher }) => {
  const url = `${target.origin}${POPPY_PATH}`;
  const response = await fetcher.fetch(url, { headers: { accept: 'application/json' } });
  const evidence: Evidence = {
    url,
    status: response.status,
    content_type: contentType(response),
    final_url: response.finalUrl,
  };
  if (isTransient(response)) return unanswered('poppy.json', response, evidence);
  if (response.status === 404 || response.status === 410) {
    return skip(
      'not_applicable',
      `no Poppy discovery document at ${POPPY_PATH} (optional, so its absence is not scored)`,
      evidence,
    );
  }
  if (response.status !== 200) {
    return fail(`poppy.json answered ${describeFailure(response)}`, evidence);
  }

  // Spec 3: every redirect is to HTTPS, and only a document served from exactly the
  // well-known path, with no query, may speak for the host that served it.
  const chain = [...(response.hops ?? []), response.finalUrl];
  const final = new URL(response.finalUrl);
  if (chain.some((hop) => !hop.startsWith('https://'))) {
    evidence.hops = chain;
    return fail(
      'poppy.json is reached through a non-HTTPS URL; the spec requires HTTPS for every redirect',
      evidence,
    );
  }
  if (final.pathname !== POPPY_PATH || final.search !== '') {
    evidence.hops = chain;
    return fail(
      `poppy.json redirects to ${final.pathname}${final.search}; agents use a document only when it is served from exactly ${POPPY_PATH}`,
      evidence,
    );
  }
  if (looksLikeHtml(response.body)) {
    return fail('poppy.json is an HTML page (a soft 404 or a challenge), not JSON', evidence);
  }
  const parsed = parseJson(response.body);
  const host = final.hostname;
  const reading = readPoppyDocument(parsed, host);
  if (!reading.summary) {
    evidence.problems = reading.problems.slice(0, PROBLEM_LIMIT * 2);
    const listed = reading.problems.slice(0, PROBLEM_LIMIT).join('; ');
    const more =
      reading.problems.length > PROBLEM_LIMIT
        ? ` and ${String(reading.problems.length - PROBLEM_LIMIT)} more`
        : '';
    return fail(`poppy.json does not meet the spec: ${listed}${more}`, evidence);
  }
  const summary = reading.summary;
  Object.assign(evidence, {
    protocol_version: summary.protocolVersion,
    organization: summary.organization,
    agent_protocols: summary.agentProtocols,
    apis: summary.apis,
    web: summary.web,
    extensions: summary.extensions,
    supported_versions: summary.otherVersions,
  });

  const verified = await verifyIssuer(fetcher, summary.organization.domain, summary, evidence);
  if ('outcome' in verified) return verified.outcome;
  return pass(
    `Poppy ${summary.protocolVersion} discovery document for ${summary.organization.name}: offers ${channels(summary)}; ${verified.note}`,
    evidence,
  );
});
