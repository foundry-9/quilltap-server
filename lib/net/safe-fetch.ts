/**
 * Outbound HTTP for URLs that came from outside the server's own configuration.
 *
 * Rules enforced here, in one place:
 * - http and https only, no embedded credentials.
 * - The hostname is resolved once; every resolved address must be a public
 *   unicast address (unless `allowPrivate`), and the connection is pinned to
 *   the addresses that were checked.
 * - Redirects are followed manually, up to a fixed number of hops, and each
 *   hop is validated the same way.
 * - The body is read as a stream and the request aborted at `maxBytes`,
 *   whether or not Content-Length is present or honest.
 * - A total timeout covers the whole exchange, redirects included.
 *
 * Provider API calls (including local model servers) do not go through here.
 */

import http from 'node:http';
import https from 'node:https';
import { promises as dnsPromises } from 'node:dns';
import { isIP } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { logger } from '@/lib/logger';
import { isLocalHostname, isNonPublicAddress, normalizeHost } from '@/lib/net/ip-classifier';

const log = logger.child({ module: 'safe-fetch' });

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

export type SafeFetchErrorCode =
  | 'BAD_URL'
  | 'BAD_SCHEME'
  | 'BLOCKED_ADDRESS'
  | 'DNS_FAILED'
  | 'TOO_MANY_REDIRECTS'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'NETWORK';

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export interface SafeFetchOptions {
  /** Hard cap on response body bytes (required). */
  maxBytes: number;
  /** Permit private, loopback and link-local destinations. Default false. */
  allowPrivate?: boolean;
  /** Total time allowed for the exchange, redirects included. */
  timeoutMs?: number;
  /** Redirect hops allowed. Default 5. */
  maxRedirects?: number;
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: string | Buffer;
  signal?: AbortSignal;
}

export interface SafeFetchResponse {
  /** Final URL after redirects. */
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  headers: Headers;
  body: Buffer;
  redirected: boolean;
  text(): string;
  json<T = unknown>(): T;
}

interface ResolvedTarget {
  url: URL;
  addresses: LookupAddress[];
}

/** Validate a URL and resolve its host to checked addresses. */
async function resolveTarget(rawUrl: string, allowPrivate: boolean): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError('BAD_URL', 'Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('BAD_SCHEME', `Unsupported URL scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SafeFetchError('BAD_URL', 'URLs with embedded credentials are not allowed');
  }

  const host = normalizeHost(url.hostname);
  if (!host) throw new SafeFetchError('BAD_URL', 'URL has no host');

  let addresses: LookupAddress[];
  const literalFamily = isIP(host);
  if (literalFamily) {
    addresses = [{ address: host, family: literalFamily }];
  } else {
    if (!allowPrivate && isLocalHostname(host)) {
      throw new SafeFetchError('BLOCKED_ADDRESS', `Host is not a public address: ${host}`);
    }
    try {
      addresses = await dnsPromises.lookup(host, { all: true, verbatim: true });
    } catch (err) {
      throw new SafeFetchError('DNS_FAILED', `Could not resolve host ${host}: ${(err as Error).message}`);
    }
    if (!addresses.length) throw new SafeFetchError('DNS_FAILED', `No addresses for host ${host}`);
  }

  if (!allowPrivate) {
    for (const a of addresses) {
      if (isNonPublicAddress(a.address)) {
        log.debug('Refused non-public destination', { host, address: a.address });
        throw new SafeFetchError('BLOCKED_ADDRESS', `Host resolves to a non-public address: ${host}`);
      }
    }
  }
  return { url, addresses };
}

function headersToRecord(h: Record<string, string> | Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => { out[k.toLowerCase()] = v; });
  } else {
    for (const [k, v] of Object.entries(h as Record<string, string>)) out[k.toLowerCase()] = v;
  }
  return out;
}

interface RawResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: Buffer;
}

function requestOnce(
  target: ResolvedTarget,
  method: string,
  headers: Record<string, string>,
  body: string | Buffer | undefined,
  maxBytes: number,
  signal: AbortSignal,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const { url, addresses } = target;
    const lib = url.protocol === 'https:' ? https : http;

    // Pin the connection to the addresses that were validated.
    const lookup = (
      _hostname: string,
      opts: { all?: boolean } | undefined,
      cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
    ): void => {
      if (opts && opts.all) cb(null, addresses);
      else cb(null, addresses[0].address, addresses[0].family);
    };

    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: normalizeHost(url.hostname),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        agent: false,
        lookup: lookup as never,
        signal,
      },
      (res) => {
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          reject(new SafeFetchError('TOO_LARGE', `Response exceeds ${maxBytes} bytes`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            res.destroy();
            req.destroy();
            reject(new SafeFetchError('TOO_LARGE', `Response exceeds ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
            else if (v !== undefined) h.set(k, v);
          }
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: h,
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', (e) => reject(e));
      },
    );
    req.on('error', (e) => reject(e));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch a URL with destination, redirect and size checks. Throws
 * `SafeFetchError` for refused or failed requests; a non-2xx status is
 * returned, not thrown.
 */
export async function safeFetch(url: string, options: SafeFetchOptions): Promise<SafeFetchResponse> {
  const {
    maxBytes,
    allowPrivate = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = MAX_REDIRECTS,
  } = options;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new SafeFetchError('BAD_URL', 'maxBytes must be a positive number');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  let method = (options.method || 'GET').toUpperCase();
  let body = options.body;
  let headers = headersToRecord(options.headers);
  if (!headers['accept-encoding']) headers['accept-encoding'] = 'identity';

  let currentUrl = url;
  let redirected = false;

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const target = await resolveTarget(currentUrl, allowPrivate);
      log.debug('safeFetch request', { host: target.url.host, hop, method });

      let raw: RawResponse;
      try {
        raw = await requestOnce(target, method, headers, body, maxBytes, controller.signal);
      } catch (err) {
        if (err instanceof SafeFetchError) throw err;
        if (controller.signal.aborted) throw new SafeFetchError('TIMEOUT', `Request timed out or was aborted (${target.url.host})`);
        throw new SafeFetchError('NETWORK', `Request failed: ${(err as Error).message}`);
      }

      const location = raw.headers.get('location');
      if (REDIRECT_STATUSES.has(raw.status) && location) {
        if (hop === maxRedirects) throw new SafeFetchError('TOO_MANY_REDIRECTS', 'Too many redirects');
        const next = new URL(location, target.url);
        if (next.origin !== target.url.origin) {
          delete headers['authorization'];
          delete headers['cookie'];
        }
        if (raw.status === 303 || ((raw.status === 301 || raw.status === 302) && method === 'POST')) {
          method = 'GET';
          body = undefined;
          delete headers['content-type'];
          delete headers['content-length'];
        }
        currentUrl = next.toString();
        redirected = true;
        log.debug('safeFetch following redirect', { hop: hop + 1, to: next.host });
        continue;
      }

      const bodyBuf = raw.body;
      return {
        url: target.url.toString(),
        status: raw.status,
        statusText: raw.statusText,
        ok: raw.status >= 200 && raw.status < 300,
        headers: raw.headers,
        body: bodyBuf,
        redirected,
        text: () => bodyBuf.toString('utf8'),
        json: <T = unknown>() => JSON.parse(bodyBuf.toString('utf8')) as T,
      };
    }
    throw new SafeFetchError('TOO_MANY_REDIRECTS', 'Too many redirects');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}
