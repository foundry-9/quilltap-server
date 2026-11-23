/**
 * Where theme drafts live: `Themes/<id>/` at the root of Quilltap General.
 *
 * This is the one statement of that rule. The drafts module
 * (`lib/themes/drafts/`) builds its paths from it, and two chokepoints below
 * the document layer ask it a question about a path they are already
 * handling:
 *
 * - blob image normalisation (`lib/mount-index/normalize-blob-image.ts`)
 *   leaves an image under `Themes/` in General byte for byte (Spec D,
 *   decision 11), whoever writes it;
 * - the chunker (`reindexSingleFile`) and the embedding scheduler keep draft
 *   files out of the Commonplace Book's knowledge, since a theme's JSON and
 *   CSS are not knowledge.
 *
 * Kept light on purpose: the General store id is read lazily, so the
 * repository layer can import this module without a cycle.
 *
 * @module lib/themes/drafts/location
 */

import { foldStorePath } from '@/lib/mount-index/store-path-fold';

/** The folder at the root of Quilltap General that holds theme drafts. */
export const THEME_DRAFTS_FOLDER = 'Themes';

/**
 * A draft id is a theme id: lowercase letters, digits and hyphens, starting
 * with a letter (the manifest's `id` rule, `lib/themes/engine/document.ts`).
 * Checked before an id is ever used in a path.
 */
export const THEME_DRAFT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** True when `id` may name a draft folder. */
export function isValidDraftId(id: string): boolean {
  return id.length > 0 && id.length <= 64 && THEME_DRAFT_ID_PATTERN.test(id);
}

/** The General-relative folder of one draft, e.g. `Themes/my-theme`. */
export function draftFolderPath(id: string): string {
  if (!isValidDraftId(id)) throw new Error(`Not a valid theme draft id: ${JSON.stringify(id)}`);
  return `${THEME_DRAFTS_FOLDER}/${id}`;
}

/**
 * True when a store-relative path sits under `Themes/` (at any depth below
 * it), compared the way the database store compares paths.
 */
export function isUnderThemeDraftsFolder(relativePath: string): boolean {
  const normalised = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `${foldStorePath(THEME_DRAFTS_FOLDER)}/`;
  const folded = foldStorePath(normalised);
  return folded.startsWith(prefix) && folded.length > prefix.length;
}

/**
 * True when `relativePath` in store `mountPointId` is part of a theme draft:
 * the store is Quilltap General and the path is under `Themes/`.
 */
export async function isThemeDraftStorePath(mountPointId: string | null | undefined, relativePath: string): Promise<boolean> {
  if (!mountPointId || !isUnderThemeDraftsFolder(relativePath)) return false;
  const { getGeneralMountPointId } = await import('@/lib/instance-settings');
  const generalId = await getGeneralMountPointId();
  return generalId !== null && generalId === mountPointId;
}

/**
 * A test for many paths in one store: asks once whether the store is
 * Quilltap General, then answers each path by the folder rule alone. Outside
 * General every path is answered `false` without being looked at.
 */
export async function themeDraftPathTester(
  mountPointId: string | null | undefined,
): Promise<(relativePath: string) => boolean> {
  if (!mountPointId) return () => false;
  const { getGeneralMountPointId } = await import('@/lib/instance-settings');
  const generalId = await getGeneralMountPointId();
  if (generalId === null || generalId !== mountPointId) return () => false;
  return isUnderThemeDraftsFolder;
}
