/**
 * URL Validation and Allowlist Checking
 *
 * Provides security checks for URLs before making HTTP requests: scheme,
 * credentials, destination address (including DNS results), and the
 * user-configured allowlist, which is matched against parsed URL parts.
 */

import { isIP } from 'node:net';
import { promises as dnsPromises } from 'node:dns';
import type { UrlPattern } from './types';

// ============================================================================
// ADDRESS CLASSIFICATION
// ============================================================================

function normalizeHost(host: string): string {
  let h = host.trim();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone !== -1) h = h.slice(0, zone);
  return h.toLowerCase().replace(/\.$/, '');
}

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function parseIPv6(ip: string): number[] | null {
  let s = ip;
  if (s.includes('.')) {
    const lastColon = s.lastIndexOf(':');
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };
  const head = toGroups(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1]);
  if (!tail) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function isPrivateIPv4Bytes(b: number[]): boolean {
  const [a, c, d] = b;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && c >= 64 && c <= 127) return true;
  if (a === 169 && c === 254) return true;
  if (a === 172 && c >= 16 && c <= 31) return true;
  if (a === 192 && c === 0 && (d === 0 || d === 2)) return true;
  if (a === 192 && c === 168) return true;
  if (a === 198 && (c === 18 || c === 19)) return true;
  if (a === 198 && c === 51 && d === 100) return true;
  if (a === 203 && c === 0 && d === 113) return true;
  return a >= 224;
}

const v4From = (hi: number, lo: number): number[] => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];

/**
 * True when an IP literal is not a public unicast address. IPv6 forms that
 * carry an IPv4 address (mapped, compatible, NAT64, 6to4) are judged by it.
 */
export function isNonPublicAddress(address: string): boolean {
  const ip = normalizeHost(address);
  const family = isIP(ip);
  if (family === 4) {
    const b = parseIPv4(ip);
    return b === null || isPrivateIPv4Bytes(b);
  }
  if (family === 6) {
    const g = parseIPv6(ip);
    if (!g) return true;
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateIPv4Bytes(v4From(g[6], g[7]));
    if (g.slice(0, 6).every((x) => x === 0)) {
      if (g[6] === 0 && g[7] <= 1) return true;
      return isPrivateIPv4Bytes(v4From(g[6], g[7]));
    }
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIPv4Bytes(v4From(g[6], g[7]));
    if (g[0] === 0x2002) return isPrivateIPv4Bytes(v4From(g[1], g[2]));
    if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0db8)) return true;
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;
    if ((g[0] & 0xff00) === 0xff00) return true;
    return false;
  }
  return true;
}

/**
 * Check if a hostname is a private/local address or a name for the local machine.
 *
 * @param hostname The hostname to check (brackets allowed)
 * @returns true if hostname is private/local
 */
export function isPrivateHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (h === 'localhost' || h.endsWith('.localhost') || h === 'localhost.localdomain' || h === 'local') {
    return true;
  }
  if (isIP(h)) return isNonPublicAddress(h);
  return false;
}

// ============================================================================
// ALLOWLIST PATTERNS
// ============================================================================

const escapeRegex = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const globToSegment = (s: string): string => escapeRegex(s).replace(/\*/g, '[^/]*');

/**
 * Parse URL patterns from configuration string.
 *
 * A pattern is `[http://|https://]host[:port][/path]`. In the host, `*`
 * matches any run of characters within the host only; in the path, `*`
 * matches within one path segment. A pattern without a path allows any path;
 * one with a path allows that path and everything beneath it. A pattern
 * without a port allows the scheme's default port only.
 *
 * @param patternsString Newline-separated list of patterns
 * @returns Array of parsed URL patterns
 */
export function parseUrlPatterns(patternsString: string): UrlPattern[] {
  if (!patternsString || typeof patternsString !== 'string') {
    return [];
  }

  const out: UrlPattern[] = [];
  for (const raw of patternsString.split('\n')) {
    const pattern = raw.trim();
    if (!pattern || pattern.startsWith('#')) continue;

    let rest = pattern;
    let scheme: string | null = null;
    const schemeMatch = rest.match(/^(https?):\/\//i);
    if (schemeMatch) {
      scheme = schemeMatch[1].toLowerCase();
      rest = rest.slice(schemeMatch[0].length);
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rest)) {
      continue; // other schemes can never be allowed
    }

    const cut = rest.search(/[/?#]/);
    const hostPort = cut === -1 ? rest : rest.slice(0, cut);
    let pathPart = cut === -1 ? '' : rest.slice(cut);
    pathPart = pathPart.split(/[?#]/)[0].replace(/\/+$/, '');

    let host = hostPort;
    let port: string | null = null;
    const portMatch = hostPort.match(/^(.*):(\d+)$/);
    if (portMatch && !(portMatch[1].includes(':') && !portMatch[1].endsWith(']'))) {
      host = portMatch[1];
      port = portMatch[2];
    }
    host = normalizeHost(host);
    if (!host) continue;

    out.push({
      pattern,
      isWildcard: pattern.includes('*'),
      scheme,
      hostRegex: new RegExp(`^${globToSegment(host)}$`, 'i'),
      port,
      pathRegex: pathPart ? new RegExp(`^${globToSegment(pathPart)}(?:/.*)?$`, 'i') : null,
    });
  }
  return out;
}

/**
 * Check if a URL matches any of the allowed patterns. Patterns are compared
 * with the parsed scheme, hostname, port and path, never the raw string.
 *
 * @param url The URL to check
 * @param patterns Parsed URL patterns
 * @returns true if URL is allowed, false otherwise
 */
export function urlMatchesPatterns(url: string, patterns: UrlPattern[]): boolean {
  if (patterns.length === 0) {
    return false; // No patterns = nothing allowed
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const scheme = parsed.protocol.replace(':', '');
  if (scheme !== 'http' && scheme !== 'https') return false;
  const host = normalizeHost(parsed.hostname);
  const defaultPort = scheme === 'https' ? '443' : '80';
  const effectivePort = parsed.port || defaultPort;

  return patterns.some((p) => {
    if (p.scheme && p.scheme !== scheme) return false;
    if (!p.hostRegex.test(host)) return false;
    if ((p.port ?? defaultPort) !== effectivePort) return false;
    if (p.pathRegex && !p.pathRegex.test(parsed.pathname)) return false;
    return true;
  });
}

// ============================================================================
// URL VALIDATION
// ============================================================================

/**
 * Validate a URL for security concerns (scheme, credentials, literal host)
 *
 * @param urlString The URL to validate
 * @returns Object with validation result and error message
 */
export function validateUrlSecurity(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return {
        valid: false,
        error: `Invalid protocol: ${url.protocol}. Only http and https are allowed.`,
      };
    }

    if (isPrivateHost(url.hostname)) {
      return {
        valid: false,
        error: `Access to private/local addresses is blocked: ${url.hostname}`,
      };
    }

    if (url.username || url.password) {
      return {
        valid: false,
        error: 'URLs with embedded credentials are not allowed.',
      };
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      error: 'Invalid URL format.',
    };
  }
}

/**
 * Full URL validation including allowlist check
 *
 * @param urlString The URL to validate
 * @param allowedPatterns Parsed URL patterns from config
 * @returns Object with validation result and error message
 */
export function validateUrl(
  urlString: string,
  allowedPatterns: UrlPattern[]
): { valid: boolean; error?: string } {
  const securityCheck = validateUrlSecurity(urlString);
  if (!securityCheck.valid) {
    return securityCheck;
  }

  if (!urlMatchesPatterns(urlString, allowedPatterns)) {
    return {
      valid: false,
      error: `URL not in allowlist. Configure allowed URL patterns in tool settings.`,
    };
  }

  return { valid: true };
}

/**
 * Validation that also resolves the hostname and refuses any non-public
 * result. Used for the first request and for every redirect hop.
 */
export async function validateUrlResolved(
  urlString: string,
  allowedPatterns: UrlPattern[],
  lookup: (host: string) => Promise<Array<{ address: string }>> = (h) =>
    dnsPromises.lookup(h, { all: true, verbatim: true }),
): Promise<{ valid: boolean; error?: string }> {
  const basic = validateUrl(urlString, allowedPatterns);
  if (!basic.valid) return basic;

  const host = normalizeHost(new URL(urlString).hostname);
  if (isIP(host)) return { valid: true };

  try {
    const addresses = await lookup(host);
    if (!addresses.length) {
      return { valid: false, error: `DNS lookup failed: no addresses for ${host}` };
    }
    for (const a of addresses) {
      if (isNonPublicAddress(a.address)) {
        return { valid: false, error: `Access to private/local addresses is blocked: ${host}` };
      }
    }
  } catch {
    return { valid: false, error: `DNS lookup failed: Could not resolve hostname` };
  }
  return { valid: true };
}
