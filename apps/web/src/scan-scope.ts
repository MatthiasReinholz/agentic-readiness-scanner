/** Hosted identity and retention policy. Core scan scope and its public result contract stay unchanged. */
import { assertPublicUrl, normalizeInputUrl } from '@agentic-readiness/core';

import { hostKey } from './hosts.js';
import type { StoredScan } from './store/types.js';

export interface ScanScope {
  /** Normalized submitted URL, with fragments removed; never inferred from a redirect. */
  url: string;
  host: string;
  persistent: boolean;
}

export function scanScope(input: string): ScanScope {
  const url = normalizeInputUrl(input);
  assertPublicUrl(url);
  return {
    url: url.href,
    host: hostKey(url.hostname),
    // Queries and non-default ports may represent a different resource or carry private data.
    persistent: url.pathname === '/' && url.search === '' && url.port === '',
  };
}

export function isRootInput(input: string): boolean {
  try {
    return scanScope(input).persistent;
  } catch {
    return false;
  }
}

export function isRootScan(scan: StoredScan): boolean {
  return isRootInput(scan.result.target.input_url);
}

/** Durable rescan actions follow the submitted host, even when the store redirects elsewhere. */
export function rootScanUrl(scan: StoredScan): string {
  const scope = scanScope(scan.result.target.input_url);
  if (!scope.persistent) throw new Error('A persistent scan requires a root URL');
  return new URL(scope.url).origin;
}

/** Legacy rows can hold the redirect destination. Keep actions attached to their host key. */
export function rescanUrlForHost(host: string, previousUrl: string): string {
  try {
    const scope = scanScope(previousUrl);
    if (scope.persistent && scope.host === hostKey(host)) return scope.url;
  } catch {
    /* A legacy malformed URL is never used as a fetch destination. */
  }
  return `https://${host}/`;
}

/** Host is a separate path segment, so domains ending in .md or .json are unambiguous. */
export function siteProfilePath(host: string): string {
  return `/sites/${encodeURIComponent(hostKey(host))}`;
}

/** Accept only a host identifier, never a URL, credentials, path or port in the route. */
export function profileHost(input: string): string | null {
  try {
    if (/[\s/@?#\\%]/.test(input)) return null;
    const scope = scanScope(input);
    const url = new URL(scope.url);
    if (url.port || url.username || url.password || url.pathname !== '/' || url.search) return null;
    return scope.host;
  } catch {
    return null;
  }
}
