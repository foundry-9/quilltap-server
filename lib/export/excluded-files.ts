/**
 * Which library files never travel in a `.qtap` export.
 *
 * One predicate, three call sites — the writer's `files` streamer, the
 * "everything of this type" id resolver, and the export wizard's entity picker.
 * The rule used to be spelled out at each of them, which is how `ARCHIVE` came
 * to be excluded nowhere after it was added.
 *
 * Two categories are excluded, for the same reason: both are themselves
 * archives of the instance, and nesting them inside a fresh export bloats it
 * enormously (base64-inflated) while adding nothing a restore could use.
 *
 * - **BACKUP** — mirrors the backup service's own rule. Nobody wants last
 *   month's backup riding inside this month's.
 * - **ARCHIVE** — a character archive bundle is a `.qtap` in its own right. It
 *   is reachable through `characters.archiveFileId`, and it survives a wipe
 *   only by the operator's explicit "keep archived characters" choice; an
 *   export is not the place to smuggle copies of it.
 *
 * Document stores have one exclusion of their own:
 *
 * - **Theme drafts** — `Themes/` in Quilltap General (Calliope's Atelier,
 *   `lib/themes/drafts/location.ts`). A draft is a work in progress, and its
 *   finished form travels as a `.qtap-theme` bundle. Backups still carry
 *   drafts; only `.qtap` exports leave them out.
 */

import type { FileEntry } from '@/lib/schemas/file.types';
import { THEME_DRAFTS_FOLDER, themeDraftPathTester } from '@/lib/themes/drafts/location';
import { foldStorePath } from '@/lib/mount-index/store-path-fold';

/** Categories whose files are never written into an export. */
export const EXPORT_EXCLUDED_FILE_CATEGORIES = ['BACKUP', 'ARCHIVE'] as const;

/** Folder paths whose files are never written into an export. */
export const EXPORT_EXCLUDED_FOLDER_PATHS = ['/backups', '/archives'] as const;

export function isFileExcludedFromExport(
  file: Pick<FileEntry, 'category' | 'folderPath'>
): boolean {
  return (
    EXPORT_EXCLUDED_FILE_CATEGORIES.includes(
      file.category as (typeof EXPORT_EXCLUDED_FILE_CATEGORIES)[number]
    ) ||
    EXPORT_EXCLUDED_FOLDER_PATHS.includes(
      (file.folderPath ?? '') as (typeof EXPORT_EXCLUDED_FOLDER_PATHS)[number]
    )
  );
}

/**
 * A test for the paths of one document store: true when the folder, document
 * or blob at that store-relative path is left out of an export (the `Themes`
 * folder itself included). Asks once per store; outside Quilltap General
 * nothing is excluded.
 */
export async function docStoreExportExclusion(
  mountPointId: string
): Promise<(relativePath: string) => boolean> {
  const isDraftPath = await themeDraftPathTester(mountPointId);
  // The tester answers by the folder rule alone once the store is General.
  if (!isDraftPath(`${THEME_DRAFTS_FOLDER}/probe`)) return () => false;
  const draftsRoot = foldStorePath(THEME_DRAFTS_FOLDER);
  return (relativePath: string) =>
    isDraftPath(relativePath) ||
    foldStorePath(relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')) === draftsRoot;
}
