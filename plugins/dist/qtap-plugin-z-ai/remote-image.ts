/**
 * Download an image from a URL returned by the provider.
 *
 * Rules: https only, no embedded credentials, the host must resolve only to
 * public addresses (checked again on every redirect hop), redirects are
 * followed manually up to a fixed limit, and the body is read as a stream and
 * abandoned past a size ceiling.
 */

import { isIP } from 'node:net';
import { promises as dnsPromises } from 'node:dns';
import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-z-ai');

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_HOPS = 3;
const TIMEOUT_MS = 60_000;

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


async function assertPublicHttps(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Image URL is not valid');
  }
  if (url.protocol !== 'https:') {
    throw new Error('Image URL must use https');
  }
  if (url.username || url.password) {
    throw new Error('Image URL must not carry credentials');
  }
  const host = normalizeHost(url.hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Image URL points at a non-public address');
  }
  const addresses = isIP(host)
    ? [{ address: host }]
    : await dnsPromises.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isNonPublicAddress(a.address))) {
    logger.debug('Refused non-public image host', { host });
    throw new Error('Image URL points at a non-public address');
  }
  return url;
}

export interface DownloadedImage {
  data: string;
  mimeType: string;
}

/**
 * Fetch an image and return it as base64 with its declared image/* type.
 */
export async function downloadRemoteImage(rawUrl: string, label: string): Promise<DownloadedImage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let current = rawUrl;
    for (let hop = 0; ; hop++) {
      const url = await assertPublicHttps(current);
      const response = await fetch(url.toString(), { redirect: 'manual', signal: controller.signal });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        if (hop >= MAX_HOPS) throw new Error(`Failed to download ${label} image: too many redirects`);
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) {
        throw new Error(`Failed to download ${label} image: HTTP ${response.status}`);
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
        await response.body?.cancel();
        throw new Error(`${label} image exceeds the size limit`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error(`Failed to download ${label} image: empty body`);
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw new Error(`${label} image exceeds the size limit`);
        }
        chunks.push(value);
      }
      let mimeType = 'image/png';
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.startsWith('image/')) {
        mimeType = contentType.split(';')[0];
      }
      return { data: Buffer.concat(chunks).toString('base64'), mimeType };
    }
  } finally {
    clearTimeout(timer);
  }
}
