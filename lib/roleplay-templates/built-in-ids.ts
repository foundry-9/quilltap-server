/**
 * Deterministic ids for the built-in roleplay templates.
 *
 * Built-ins are seeded from code on every instance. Their ids used to be
 * random per instance, so a chat restored or imported into another instance
 * named a template that did not exist there (#190). Each built-in's id is now
 * a UUIDv5 over a fixed namespace and the template's name, the key the seeder
 * has always matched built-ins by — the same on every instance, forever.
 *
 * Client-safe: no Node imports (SHA-1 is computed here).
 *
 * @module roleplay-templates/built-in-ids
 */

/** Fixed UUIDv5 namespace for Quilltap's built-in roleplay templates. Never change it. */
export const BUILT_IN_ROLEPLAY_TEMPLATE_NAMESPACE = '5d0c2f7e-3b8a-4c61-9e4f-7a2b1c9d8e60';

/** The names of the built-in roleplay templates, in seed order. */
export const BUILT_IN_ROLEPLAY_TEMPLATE_NAMES = ['Standard', 'Quilltap RP', 'Novel'] as const;

function uuidToBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < 32; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes;
}

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** SHA-1 (FIPS 180-1) over a byte array. Small inputs only; used for UUIDv5. */
function sha1(message: number[]): number[] {
  const rotl = (n: number, s: number) => (n << s) | (n >>> (32 - s));
  const bytes = [...message, 0x80];
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitLength = message.length * 8;
  for (let i = 7; i >= 0; i--) bytes.push(Math.floor(bitLength / 2 ** (i * 8)) & 0xff);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[chunk + i * 4] << 24) | (bytes[chunk + i * 4 + 1] << 16) | (bytes[chunk + i * 4 + 2] << 8) | bytes[chunk + i * 4 + 3];
    }
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20 ? [(b & c) | (~b & d), 0x5a827999]
        : i < 40 ? [b ^ c ^ d, 0x6ed9eba1]
        : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
        : [b ^ c ^ d, 0xca62c1d6];
      const temp = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  const out: number[] = [];
  for (const h of [h0, h1, h2, h3, h4]) out.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
  return out;
}

/** RFC 4122 UUIDv5 of `name` in `namespace`. */
export function uuidV5(name: string, namespace: string): string {
  const hash = sha1([...uuidToBytes(namespace), ...utf8(name)]).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The id a built-in roleplay template has on every instance. */
export function builtInRoleplayTemplateId(name: string): string {
  return uuidV5(name, BUILT_IN_ROLEPLAY_TEMPLATE_NAMESPACE);
}

/** Every built-in roleplay template id. */
export const BUILT_IN_ROLEPLAY_TEMPLATE_IDS: ReadonlySet<string> = new Set(
  BUILT_IN_ROLEPLAY_TEMPLATE_NAMES.map(builtInRoleplayTemplateId)
);

/** Is this the id of a built-in roleplay template? */
export function isBuiltInRoleplayTemplateId(id: string | null | undefined): boolean {
  return Boolean(id) && BUILT_IN_ROLEPLAY_TEMPLATE_IDS.has(id as string);
}
