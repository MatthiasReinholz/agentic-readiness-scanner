/**
 * Validators for the usage-preference vocabularies a site may declare: Cloudflare's
 * Content Signals Policy (Content-Signal), the IETF aipref Content-Usage dictionary
 * (an RFC 9651 structured field), an RSL License reference and the W3C TDM Reservation
 * Protocol. Each vocabulary is checked on its own terms and none is translated into
 * another; the check only reports whether what is written parses.
 */
export interface SignalValidation {
  valid: boolean;
  /** What is wrong, when the value is malformed. */
  problem?: string;
}

/** Characters of one value examined; every documented example is under 200. */
const VALUE_LIMIT = 2000;
const CONTENT_SIGNAL_NAMES = new Set(['ai-train', 'search', 'ai-input', 'use']);
/** Cloudflare's content-use extension of the vocabulary: how far AI may use the content. */
const CONTENT_USE_SETTINGS = new Set(['immediate', 'reference', 'full']);
const CONTENT_USAGE_KEYS = new Set(['train-ai', 'ai-use', 'search']);
/** RFC 9651 dictionary key: a lower-case letter or `*`, then lower-case letters, digits, `_-.*`. */
const DICTIONARY_KEY = /^[a-z*][a-z0-9_\-.*]*$/;

function invalid(problem: string): SignalValidation {
  return { valid: false, problem };
}

/**
 * Splits an optional leading robots.txt path from the preference expression, e.g.
 * `/images/ ai-train=no` becomes a path of `/images/` and the expression `ai-train=no`.
 */
function splitPath(value: string): { path: string | null; expression: string } {
  if (!value.startsWith('/')) return { path: null, expression: value };
  const space = value.search(/\s/);
  if (space === -1) return { path: value, expression: '' };
  return { path: value.slice(0, space), expression: value.slice(space).trim() };
}

/**
 * Content-Signal line value: an optional leading path, then a comma-separated list of
 * `ai-train`, `search` or `ai-input`, each set to `yes` or `no`.
 */
export function validateContentSignal(value: string): SignalValidation {
  const { expression } = splitPath(value.slice(0, VALUE_LIMIT).trim());
  if (!expression) return invalid('no signal values');
  const problems: string[] = [];
  for (const part of expression.split(',')) {
    const item = part.trim();
    if (!item) {
      problems.push('empty item');
      continue;
    }
    const equals = item.indexOf('=');
    const name = (equals === -1 ? item : item.slice(0, equals)).trim().toLowerCase();
    const setting =
      equals === -1
        ? null
        : item
            .slice(equals + 1)
            .trim()
            .toLowerCase();
    if (!CONTENT_SIGNAL_NAMES.has(name)) {
      problems.push(`unknown signal "${name}" (ai-train, search, ai-input, use)`);
    } else if (name === 'use') {
      if (setting === null || !CONTENT_USE_SETTINGS.has(setting))
        problems.push('"use" must be set to immediate, reference or full');
    } else if (setting !== 'yes' && setting !== 'no') {
      problems.push(`"${name}" must be set to yes or no`);
    }
  }
  return problems.length > 0 ? invalid(problems.join('; ')) : { valid: true };
}

/**
 * Content-Usage value: an RFC 9651 dictionary whose members are `train-ai`, `ai-use`
 * or `search` set to the token `y` or `n`. In robots.txt the rule may start with a
 * path (`allowPath`); the response header may not.
 */
export function validateContentUsage(
  value: string,
  options: { allowPath?: boolean } = {},
): SignalValidation {
  const trimmed = value.slice(0, VALUE_LIMIT).trim();
  const { path, expression } = options.allowPath
    ? splitPath(trimmed)
    : { path: null, expression: trimmed };
  if (path !== null && !expression) return invalid('no preferences after the path');
  if (!expression) return invalid('empty value');
  const problems: string[] = [];
  for (const part of expression.split(',')) {
    const member = part.trim();
    if (!member) {
      problems.push('empty member');
      continue;
    }
    const equals = member.indexOf('=');
    const key = (equals === -1 ? member : member.slice(0, equals)).trim();
    // Parameters after `;` are allowed by RFC 9651 and carry no preference; ignored.
    const item = equals === -1 ? null : (member.slice(equals + 1).split(';')[0] ?? '').trim();
    if (!DICTIONARY_KEY.test(key)) {
      problems.push(`"${key}" is not a structured-field dictionary key`);
    } else if (!CONTENT_USAGE_KEYS.has(key)) {
      problems.push(`unknown key "${key}" (train-ai, ai-use, search)`);
    } else if (item !== 'y' && item !== 'n') {
      problems.push(`"${key}" must be set to y or n`);
    }
  }
  return problems.length > 0 ? invalid(problems.join('; ')) : { valid: true };
}

/** An absolute http(s) URL, as a policy or license reference must be. */
export function validateAbsoluteUrl(value: string, requireHttps = false): SignalValidation {
  let url: URL;
  try {
    url = new URL(value.slice(0, VALUE_LIMIT).trim());
  } catch {
    return invalid('not an absolute URL');
  }
  if (requireHttps) {
    return url.protocol === 'https:' ? { valid: true } : invalid('must be an absolute https URL');
  }
  return url.protocol === 'https:' || url.protocol === 'http:'
    ? { valid: true }
    : invalid('must be an absolute http(s) URL');
}

/** RSL `License:` line in robots.txt: an absolute https URL of the license file. */
export function validateLicenseUrl(value: string): SignalValidation {
  return validateAbsoluteUrl(value, true);
}

/** TDMRep `tdm-reservation` header or meta value: exactly 0 or 1. */
export function validateTdmReservation(value: string): SignalValidation {
  const trimmed = value.slice(0, VALUE_LIMIT).trim();
  return trimmed === '0' || trimmed === '1' ? { valid: true } : invalid('must be 0 or 1');
}

export interface TdmrepDocument {
  /** `html` is a soft 404 and no signal; `valid` and `invalid` are a declared signal. */
  kind: 'html' | 'valid' | 'invalid';
  entries: number;
  problem?: string;
}

/** Entries of a tdmrep.json examined; the protocol expects a handful. */
const TDMREP_ENTRY_LIMIT = 1000;

/**
 * /.well-known/tdmrep.json: a JSON array of objects, each with a `location` path
 * pattern and a `tdm-reservation` of 0 or 1, optionally a `tdm-policy` URL.
 */
export function parseTdmrepJson(body: string): TdmrepDocument {
  if (/<html|<!doctype/i.test(body.slice(0, 500))) return { kind: 'html', entries: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: 'invalid', entries: 0, problem: 'not JSON' };
  }
  if (!Array.isArray(parsed)) {
    return { kind: 'invalid', entries: 0, problem: 'must be a JSON array' };
  }
  const problems: string[] = [];
  parsed.slice(0, TDMREP_ENTRY_LIMIT).forEach((entry: unknown, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`entry ${index} is not an object`);
      return;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.location !== 'string' || !record.location) {
      problems.push(`entry ${index} lacks a location`);
    }
    const reservation = record['tdm-reservation'];
    if (reservation !== 0 && reservation !== 1) {
      problems.push(`entry ${index} needs tdm-reservation 0 or 1`);
    }
    const policy = record['tdm-policy'];
    if (
      policy !== undefined &&
      (typeof policy !== 'string' || !validateAbsoluteUrl(policy).valid)
    ) {
      problems.push(`entry ${index} has a tdm-policy that is not an absolute URL`);
    }
  });
  if (problems.length > 0) {
    return { kind: 'invalid', entries: parsed.length, problem: problems.slice(0, 5).join('; ') };
  }
  return { kind: 'valid', entries: parsed.length };
}
