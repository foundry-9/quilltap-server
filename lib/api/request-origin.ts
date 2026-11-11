/**
 * Request-origin gate
 *
 * Quilltap is single-user and has no login, so the only thing standing between
 * the API and a hostile web page in the operator's own browser is the question
 * "did this request come from Quilltap's own pages?" This module is the one
 * place that question is answered. Both the HTTP proxy (`proxy.ts`) and the
 * WebSocket upgrade check (`lib/realtime/upgrade-auth.ts`) call it; nothing
 * else should re-derive the rule.
 *
 * The rule, in two parts:
 *
 *  1. **The `Host` must be one we answer to.** Loopback names (`localhost`,
 *     `*.localhost`, `127.0.0.1`, `[::1]`), any IP literal, the host of
 *     `BASE_URL`, and anything listed in `QUILLTAP_ALLOWED_HOSTS`. A page on an
 *     attacker's domain that re-points its DNS at this machine still sends its
 *     own name as `Host`, so refusing unknown names is what defeats DNS
 *     rebinding. IP literals are allowed because rebinding needs a name.
 *  2. **A browser request must be same-origin.** When the browser says where a
 *     request came from (`Origin`, `Sec-Fetch-Site`), it must be this origin.
 *     A request carrying neither is a non-browser client (the CLI, the
 *     Electron shell's probes, `curl`), which is not the threat here.
 *
 * Pure and dependency-free so it runs in the proxy and in plain Node alike.
 *
 * @module lib/api/request-origin
 */

/** Environment variable listing extra host names the server answers to. */
export const ALLOWED_HOSTS_ENV = 'QUILLTAP_ALLOWED_HOSTS';

export interface RequestOriginInput {
  /** The `Host` header (may include a port). */
  host: string | null | undefined;
  /** The `Origin` header, if any. */
  origin: string | null | undefined;
  /** The `Sec-Fetch-Site` header, if any. */
  secFetchSite: string | null | undefined;
}

export interface RequestOriginOptions {
  /**
   * Extra allowed host patterns. Defaults to the ones read from the
   * environment (`BASE_URL`, `QUILLTAP_ALLOWED_HOSTS`).
   */
  allowedHosts?: readonly string[];
  /**
   * Whether the browser-origin half applies. The proxy passes `true` for API
   * requests and `false` for page navigations (which may arrive from a link
   * on another site and must still render).
   */
  requireSameOrigin: boolean;
}

export type RequestOriginVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Strip the port from a `Host`-style value and lower-case it. Bracketed IPv6
 * keeps its brackets (`[::1]:3000` → `[::1]`).
 */
export function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(0, end + 1);
  }
  const colon = value.indexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

const IPV4_LITERAL = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isIpLiteral(hostname: string): boolean {
  if (IPV4_LITERAL.test(hostname)) return true;
  return hostname.startsWith('[') && hostname.endsWith(']');
}

function isLoopbackName(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

/**
 * The allowed host patterns configured through the environment: the host of
 * `BASE_URL` and each comma-separated entry of `QUILLTAP_ALLOWED_HOSTS`.
 * A pattern is an exact host name or `*.example.com` for its subdomains.
 */
export function allowedHostsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const hosts: string[] = [];
  const baseUrl = env.BASE_URL;
  if (baseUrl) {
    try {
      hosts.push(new URL(baseUrl).hostname.toLowerCase());
    } catch {
      // An unparseable BASE_URL names nothing.
    }
  }
  const extra = env[ALLOWED_HOSTS_ENV];
  if (extra) {
    for (const entry of extra.split(',')) {
      const trimmed = entry.trim().toLowerCase();
      if (trimmed) hosts.push(hostnameOf(trimmed));
    }
  }
  return hosts;
}

function matchesPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".example.com"
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === pattern;
}

/** Whether the server should answer a request addressed to this `Host`. */
export function isAllowedHost(hostHeader: string, allowedHosts: readonly string[]): boolean {
  const hostname = hostnameOf(hostHeader);
  if (!hostname) return false;
  if (isLoopbackName(hostname) || isIpLiteral(hostname)) return true;
  return allowedHosts.some((pattern) => matchesPattern(hostname, pattern));
}

/**
 * Decide whether a request may proceed. Never throws.
 *
 * @example
 * const verdict = checkRequestOrigin(
 *   { host: req.headers.get('host'), origin: req.headers.get('origin'), secFetchSite: req.headers.get('sec-fetch-site') },
 *   { requireSameOrigin: true },
 * );
 */
export function checkRequestOrigin(
  input: RequestOriginInput,
  options: RequestOriginOptions,
): RequestOriginVerdict {
  const allowedHosts = options.allowedHosts ?? allowedHostsFromEnv();
  const host = input.host?.trim();
  if (!host) return { ok: false, reason: 'missing Host header' };
  if (!isAllowedHost(host, allowedHosts)) {
    return { ok: false, reason: `host not allowed (${hostnameOf(host)}); add it to ${ALLOWED_HOSTS_ENV}` };
  }

  if (!options.requireSameOrigin) return { ok: true };

  const site = input.secFetchSite?.trim().toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') {
    return { ok: false, reason: `cross-site request (Sec-Fetch-Site: ${site})` };
  }

  const origin = input.origin?.trim();
  if (origin) {
    if (origin === 'null') return { ok: false, reason: 'opaque Origin' };
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return { ok: false, reason: 'unparseable Origin' };
    }
    // Same origin, or an origin the operator named explicitly (a reverse proxy
    // that rewrites `Host` to the loopback address still forwards the public
    // `Origin`).
    const originNamed = allowedHosts.some((pattern) => matchesPattern(hostnameOf(originHost), pattern));
    if (originHost !== host.toLowerCase() && !originNamed) {
      return { ok: false, reason: `cross-origin request (origin ${originHost} vs host ${host})` };
    }
  }

  return { ok: true };
}
