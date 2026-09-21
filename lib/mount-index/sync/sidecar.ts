/**
 * `<file>.description.md` — a binary's caption, on disk.
 *
 * A database store keeps a per-location `description` on every link row: the
 * operator's caption, `doc_set_blob_description`, or whatever the image
 * auto-captioner wrote. Nothing in the tree has ever had a disk representation
 * for it — the main file store's `.meta.json` sidecars were removed and the
 * mount index never had an equivalent — so a sync that only copied bytes would
 * drop every caption on the first pass out and blank them on the way back.
 *
 * The sidecar is the plainest thing that survives a text editor: the
 * description verbatim, no frontmatter, named after the whole file (extension
 * and all) so `harbour.png` and `harbour.webp` cannot collide. Only binaries
 * get one — a text document's description is not synced at all.
 *
 * @module mount-index/sync/sidecar
 */

import { createHash } from 'crypto';
import { SIDECAR_SUFFIX } from './types';

/** `lore/harbour.png` → `lore/harbour.png.description.md`. */
export function sidecarPathFor(relativePath: string): string {
  return `${relativePath}${SIDECAR_SUFFIX}`;
}

/** True when this path IS a sidecar rather than a file that has one. */
export function isSidecarPath(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith(SIDECAR_SUFFIX);
}

/**
 * `lore/harbour.png.description.md` → `lore/harbour.png`, or null when the
 * path is not a sidecar. The partner is whatever remains; a sidecar whose
 * partner is absent from both sides is reported as a warning and otherwise
 * left alone.
 */
export function partnerPathFor(relativePath: string): string | null {
  if (!isSidecarPath(relativePath)) return null;
  const partner = relativePath.slice(0, relativePath.length - SIDECAR_SUFFIX.length);
  return partner.length > 0 ? partner : null;
}

/**
 * The bytes a sidecar holds for `description`.
 *
 * Trailing-newline hygiene only: editors add one, and a round trip through a
 * text editor must not look like an edit. `parseSidecar` strips it back off.
 */
export function renderSidecar(description: string): string {
  const body = description.replace(/\s+$/, '');
  return body.length > 0 ? `${body}\n` : '';
}

/** The description a sidecar's bytes mean. Inverse of {@link renderSidecar}. */
export function parseSidecar(body: string): string {
  return body.replace(/\s+$/, '');
}

/**
 * The comparison currency for descriptions, so the manifest can tell "the
 * sidecar was edited" from "the store's caption was edited" without storing
 * the caption itself. Computed on the PARSED text, so whitespace the editor
 * added is not a change.
 */
export function descriptionSha256(description: string): string {
  return createHash('sha256').update(parseSidecar(description), 'utf-8').digest('hex');
}

/** True when two descriptions mean the same thing. */
export function descriptionsEqual(a: string | undefined, b: string | undefined): boolean {
  return parseSidecar(a ?? '') === parseSidecar(b ?? '');
}
