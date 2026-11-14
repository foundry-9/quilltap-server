/**
 * Deterministic UUIDs from a source string.
 *
 * @module utils/stable-uuid
 */

import crypto from 'node:crypto';

/**
 * Build a stable, RFC 4122 v8-style UUID from a SHA-256 digest of the source
 * string. v8 is the "custom" version reserved for implementation-specific
 * content; we use it so the `z.uuid()` schema accepts the string without us
 * having to implement true v5 (which requires SHA-1). The exact version byte
 * is not load-bearing — we just need a stable string that parses as a UUID
 * and will always round-trip to itself for the same input.
 */
export function stableUuidFromString(source: string): string {
  const hash = crypto.createHash('sha256').update(source).digest();
  const bytes = Buffer.alloc(16);
  hash.copy(bytes, 0, 0, 16);
  // Set version to 8 (custom) in byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  // Set variant to RFC 4122 in byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}


/** True for a string shaped like a UUID (the frontmatter `id:` an item file may carry). */
export function isUuidShaped(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * The id of an item held as one file in a vault or store folder — a wardrobe
 * piece, a character's prompt, a scenario on any tier: its frontmatter `id`
 * when that is UUID-shaped, otherwise a stable id derived from where the file
 * lives (`<namespace>:<mountPointId>:<relativePath>`). The one rule.
 *
 * The fallback is exactly the id such a file always had, so a legacy file
 * keeps its id; once a writer stamps `id:` into it, the id survives a rename
 * or a move between tiers.
 */
export function resolveFileItemId(
  frontmatterId: unknown,
  namespace: 'wardrobe-item' | 'prompt' | 'scenario',
  mountPointId: string,
  relativePath: string,
): string {
  return isUuidShaped(frontmatterId)
    ? frontmatterId
    : stableUuidFromString(`${namespace}:${mountPointId}:${relativePath}`);
}
