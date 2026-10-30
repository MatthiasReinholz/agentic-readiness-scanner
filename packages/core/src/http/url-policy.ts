/**
 * URL policy: the scanner fetches public web origins only.
 * This closes the SSRF door that any URL-in service opens. Hostname and literal-IP checks
 * run here; DNS-level protection depends on the host platform's outbound policy.
 */
import { BlockedUrlError } from './types.js';

const ALLOWED_PORTS = new Set(['', '80', '443']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.intranet', '.lan'];

function ipv4Octets(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

export function isPrivateIpv4(host: string): boolean {
  const octets = ipv4Octets(host);
  if (!octets) return false;
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

export function isPrivateIpv6(host: string): boolean {
  const address = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (address === '::' || address === '::1') return true;
  if (address.startsWith('fc') || address.startsWith('fd')) return true;
  if (
    address.startsWith('fe8') ||
    address.startsWith('fe9') ||
    address.startsWith('fea') ||
    address.startsWith('feb')
  )
    return true;
  if (address.startsWith('::ffff:')) {
    const rest = address.slice('::ffff:'.length);
    if (rest.includes('.')) return isPrivateIpv4(rest);
    // The URL parser normalizes mapped addresses to two hextets, e.g. ::ffff:7f00:1
    const hextets = rest.split(':');
    if (hextets.length === 2) {
      const [high, low] = hextets.map((part) => Number.parseInt(part, 16));
      if (high !== undefined && low !== undefined && !Number.isNaN(high) && !Number.isNaN(low)) {
        return isPrivateIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
      }
    }
  }
  return false;
}

export function assertPublicUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(url.href, `scheme ${url.protocol} is not allowed`);
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new BlockedUrlError(url.href, `port ${url.port} is not allowed`);
  }
  if (url.username || url.password) {
    throw new BlockedUrlError(url.href, 'credentials in URLs are not allowed');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new BlockedUrlError(url.href, 'local hostnames are not allowed');
  }
  if (host.startsWith('[') || host.includes(':')) {
    if (isPrivateIpv6(host)) throw new BlockedUrlError(url.href, 'private IPv6 address');
    return;
  }
  if (ipv4Octets(host)) {
    if (isPrivateIpv4(host)) throw new BlockedUrlError(url.href, 'private IPv4 address');
    return;
  }
  if (!host.includes('.')) {
    throw new BlockedUrlError(url.href, 'single-label hostnames are not allowed');
  }
}

/** Normalizes user input ("example.shop", "http://Example.shop/path") to an absolute URL. */
export function normalizeInputUrl(input: string): URL {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  url.hash = '';
  return url;
}
