/**
 * The Personal Agent Protocol ("Poppy") discovery document a company publishes at
 * /.well-known/poppy.json (spec section 3), validated against the rules of the spec's own
 * JSON Schema (kit/company/schemas/poppy.schema.json) and the discovery rules a personal
 * agent applies before it uses the document. Unknown fields are allowed, as the spec says:
 * personal agents ignore fields they do not recognise. Pure functions; the check fetches.
 */

/** The well-known path; after redirects, an agent uses only a document served from exactly it. */
export const POPPY_PATH = '/.well-known/poppy.json';

const VERSION = /^\d+\.\d+$/;
const DOMAIN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const SCOPE = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
const CHANGES = new Set(['none', 'reversible', 'irreversible']);

/** What the document offers, for evidence and messages. */
export interface PoppySummary {
  protocolVersion: string;
  organization: { name: string; domain: string };
  /** Conversation protocols of the company agent, by type ("poppy"). */
  agentProtocols: string[];
  /** API types, such as openapi or mcp. */
  apis: string[];
  /** True when the document declares the website (web), false when web.disabled asks agents not to browse. */
  web: 'offered' | 'disabled' | 'absent';
  /** auth.issuer when the document names one. */
  issuer: string | null;
  /** True when auth.disabled turns sign-in off. */
  signInDisabled: boolean;
  /** True when the document needs an issuer: auth.issuer, signed_in access or Mediated Sign-In. */
  needsIssuer: boolean;
  /** Extension names. */
  extensions: string[];
  /** Other protocol versions the company serves (supported_versions). */
  otherVersions: string[];
}

export interface PoppyReading {
  summary: PoppySummary | null;
  /** Rule violations, each as a short phrase naming the field. Empty when the document is valid. */
  problems: string[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/** An HTTPS URL as the schema defines one: https:// followed by a host. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !/^https:\/\/[^\s/?#]+/.test(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates a parsed poppy.json served from `host` (the host after any redirects). Returns
 * the summary when the document is usable, and every problem found either way.
 */
export function readPoppyDocument(value: unknown, host: string): PoppyReading {
  const problems: string[] = [];
  if (!isObject(value)) return { summary: null, problems: ['the document is not a JSON object'] };
  const url = (field: string, candidate: unknown): void => {
    if (candidate !== undefined && !isHttpsUrl(candidate))
      problems.push(`${field} is not an HTTPS URL`);
  };
  const flag = (field: string, candidate: unknown): void => {
    if (candidate !== undefined && typeof candidate !== 'boolean')
      problems.push(`${field} is not true or false`);
  };

  const version = value.protocol_version;
  if (typeof version !== 'string' || !VERSION.test(version))
    problems.push('protocol_version is missing or not major.minor');

  const otherVersions: string[] = [];
  if (value.supported_versions !== undefined) {
    if (!isObject(value.supported_versions)) {
      problems.push('supported_versions is not an object');
    } else {
      for (const [key, target] of Object.entries(value.supported_versions)) {
        if (!VERSION.test(key)) problems.push(`supported_versions key ${key} is not major.minor`);
        if (!isHttpsUrl(target)) problems.push(`supported_versions ${key} is not an HTTPS URL`);
        else if (new URL(target).hostname.toLowerCase() !== host.toLowerCase())
          problems.push(`supported_versions ${key} is not on ${host}`);
        otherVersions.push(key);
      }
    }
  }

  const organization = value.organization;
  let name = '';
  let domain = '';
  if (!isObject(organization)) {
    problems.push('organization is missing');
  } else {
    if (!nonEmpty(organization.name)) problems.push('organization.name is missing');
    else name = organization.name;
    if (typeof organization.domain !== 'string' || !DOMAIN.test(organization.domain)) {
      problems.push('organization.domain is missing or not a domain name');
    } else {
      domain = organization.domain;
      // Spec 3 and 3.1: the document speaks only for the host that served it.
      if (domain.toLowerCase() !== host.toLowerCase())
        problems.push(`organization.domain ${domain} is not the host that served it (${host})`);
    }
    url('organization.logo_uri', organization.logo_uri);
  }

  let issuer: string | null = null;
  let signInDisabled = false;
  if (value.auth !== undefined) {
    const auth = value.auth;
    if (!isObject(auth)) {
      problems.push('auth is not an object');
    } else {
      url('auth.issuer', auth.issuer);
      if (isHttpsUrl(auth.issuer)) issuer = auth.issuer;
      flag('auth.disabled', auth.disabled);
      signInDisabled = auth.disabled === true;
      if (auth.scopes !== undefined) {
        if (!isObject(auth.scopes)) problems.push('auth.scopes is not an object');
        else
          for (const [scope, text] of Object.entries(auth.scopes))
            if (!nonEmpty(text)) problems.push(`auth.scopes ${scope} has no description`);
      }
      if (auth.scope_hints !== undefined) {
        if (!isObject(auth.scope_hints)) {
          problems.push('auth.scope_hints is not an object');
        } else {
          for (const [scope, hint] of Object.entries(auth.scope_hints)) {
            if (
              !isObject(hint) ||
              typeof hint.changes !== 'string' ||
              !CHANGES.has(hint.changes) ||
              typeof hint.personal_data !== 'boolean'
            )
              problems.push(`auth.scope_hints ${scope} needs changes and personal_data`);
          }
        }
      }
    }
  }

  const agentProtocols: string[] = [];
  let signedInAccess = false;
  if (value.agent !== undefined) {
    const agent = value.agent;
    if (!isObject(agent) || !Array.isArray(agent.protocols) || agent.protocols.length === 0) {
      problems.push('agent.protocols is missing or empty');
    } else {
      agent.protocols.forEach((entry: unknown, index) => {
        if (!isObject(entry) || !nonEmpty(entry.type)) {
          problems.push(`agent.protocols[${String(index)}] has no type`);
          return;
        }
        agentProtocols.push(entry.type);
        if (!isHttpsUrl(entry.endpoint))
          problems.push(`agent.protocols[${String(index)}].endpoint is not an HTTPS URL`);
        if (entry.type === 'poppy' && entry.access === 'signed_in') signedInAccess = true;
      });
    }
  }

  if (value.tasks !== undefined) {
    if (!isObject(value.tasks) || !isHttpsUrl(value.tasks.endpoint))
      problems.push('tasks.endpoint is not an HTTPS URL');
  }

  let web: PoppySummary['web'] = 'absent';
  if (value.web !== undefined) {
    if (!isObject(value.web)) {
      problems.push('web is not an object');
    } else {
      url('web.browser_session_endpoint', value.web.browser_session_endpoint);
      flag('web.disabled', value.web.disabled);
      flag('web.unscoped', value.web.unscoped);
      web = value.web.disabled === true ? 'disabled' : 'offered';
    }
  }

  const apis: string[] = [];
  if (value.apis !== undefined) {
    if (!Array.isArray(value.apis)) {
      problems.push('apis is not a list');
    } else {
      value.apis.forEach((entry: unknown, index) => {
        if (!isObject(entry) || !nonEmpty(entry.type) || !nonEmpty(entry.description)) {
          problems.push(`apis[${String(index)}] needs a type and a description`);
          return;
        }
        apis.push(entry.type);
        if (!isHttpsUrl(entry.url)) problems.push(`apis[${String(index)}].url is not an HTTPS URL`);
      });
    }
  }

  const extensions: string[] = [];
  if (value.extensions !== undefined) {
    if (!isObject(value.extensions)) {
      problems.push('extensions is not an object');
    } else {
      for (const [extension, entries] of Object.entries(value.extensions)) {
        extensions.push(extension);
        if (!Array.isArray(entries) || entries.length === 0) {
          problems.push(`extensions ${extension} lists no version`);
          continue;
        }
        for (const entry of entries) {
          if (!isObject(entry) || !nonEmpty(entry.version))
            problems.push(`extensions ${extension} has an entry without a version`);
          else url(`extensions ${extension} endpoint`, entry.endpoint);
        }
      }
      const mediated = value.extensions['mediated-sign-in'];
      if (Array.isArray(mediated)) {
        for (const entry of mediated) {
          if (!isObject(entry) || entry.version !== '1') continue;
          const scopes = entry.scopes;
          if (
            !Array.isArray(entry.fields) ||
            entry.fields.length === 0 ||
            !Array.isArray(scopes) ||
            scopes.length === 0 ||
            !scopes.every((scope) => typeof scope === 'string' && SCOPE.test(scope))
          )
            problems.push('extensions mediated-sign-in version 1 needs fields and scopes');
        }
      }
    }
  }

  if (value.agent === undefined && value.apis === undefined && value.web === undefined)
    problems.push('none of agent, apis or web is declared');

  // Spec 3.2: signed_in access and Mediated Sign-In need an issuer and sign-in turned on.
  const mediatedSignIn = extensions.includes('mediated-sign-in');
  if (signInDisabled && (signedInAccess || mediatedSignIn))
    problems.push('auth.disabled is set, but signed_in access or Mediated Sign-In is declared');

  if (problems.length > 0 || typeof version !== 'string') return { summary: null, problems };
  return {
    summary: {
      protocolVersion: version,
      organization: { name, domain },
      agentProtocols,
      apis,
      web,
      issuer,
      signInDisabled,
      needsIssuer: issuer !== null || signedInAccess || mediatedSignIn,
      extensions,
      otherVersions,
    },
    problems,
  };
}

/**
 * Where RFC 8414 section 3.1 puts an issuer's metadata: the well-known segment goes
 * between the host and the issuer's path.
 */
export function authorizationServerMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return `${url.origin}/.well-known/oauth-authorization-server${path}`;
}
