/**
 * Address classification for outbound requests.
 *
 * Decides whether an IP literal falls in a range that is not a public unicast
 * address: loopback, private, link-local, unique-local, CGNAT, multicast,
 * unspecified, documentation and reserved space, for IPv4 and IPv6. IPv6
 * forms that embed an IPv4 address (mapped, compatible, NAT64, 6to4) are
 * classified by the address they carry.
 */

import { isIP } from 'node:net';

/** Strip URL brackets and an IPv6 zone id from a host string. */
export function normalizeHost(host: string): string {
  let h = host.trim();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone !== -1) h = h.slice(0, zone);
  return h.toLowerCase();
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

/** Expand an IPv6 literal to eight 16-bit groups, or null when malformed. */
function parseIPv6(ip: string): number[] | null {
  let s = ip;
  // Dotted IPv4 tail (::ffff:127.0.0.1)
  const lastColon = s.lastIndexOf(':');
  if (s.includes('.')) {
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
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
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 100 && c >= 64 && c <= 127) return true; // 100.64/10 CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && c === 254) return true; // link-local
  if (a === 172 && c >= 16 && c <= 31) return true; // 172.16/12
  if (a === 192 && c === 0 && d === 0) return true; // 192.0.0/24
  if (a === 192 && c === 0 && d === 2) return true; // documentation
  if (a === 192 && c === 168) return true; // 192.168/16
  if (a === 198 && (c === 18 || c === 19)) return true; // benchmarking
  if (a === 198 && c === 51 && d === 100) return true; // documentation
  if (a === 203 && c === 0 && d === 113) return true; // documentation
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function v4FromGroups(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

/**
 * True when the address is not a public unicast address. Unparseable input is
 * treated as non-public.
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
    const leadingZero = g.slice(0, 5).every((x) => x === 0);
    if (leadingZero && g[5] === 0xffff) return isPrivateIPv4Bytes(v4FromGroups(g[6], g[7])); // mapped
    if (g.slice(0, 6).every((x) => x === 0)) {
      // ::/96 — unspecified, loopback, or IPv4-compatible
      if (g[6] === 0 && g[7] <= 1) return true;
      return isPrivateIPv4Bytes(v4FromGroups(g[6], g[7]));
    }
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
      return isPrivateIPv4Bytes(v4FromGroups(g[6], g[7])); // NAT64 well-known prefix
    }
    if (g[0] === 0x2002) return isPrivateIPv4Bytes(v4FromGroups(g[1], g[2])); // 6to4
    if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard
    if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  return true;
}

/** Hostnames that name the local machine regardless of DNS. */
export function isLocalHostname(hostname: string): boolean {
  const h = normalizeHost(hostname).replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === 'localhost.localdomain';
}
