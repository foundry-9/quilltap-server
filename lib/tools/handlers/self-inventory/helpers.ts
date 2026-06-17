/**
 * Self-Inventory — shared primitives.
 *
 * The introspection report is assembled by `builders.ts` (gather) and rendered
 * by `formatters.ts` (render); the slim `../self-inventory-handler.ts`
 * orchestrates the two. This module holds the pieces both halves lean on: the
 * tool-call context shape, the high-importance threshold, the low-level
 * number/date formatters, and the vault-file predicate/mapper.
 */

import type { LoadedMemoriesContext } from '@/lib/chat/tool-executor';
import { isAutomaticImagePath, isOsCruftName, IMAGE_FILE_EXTENSIONS } from '@/lib/files/folder-utils';
import type { SelfInventoryVaultFile } from '../../self-inventory-tool';

export interface SelfInventoryToolContext {
  userId: string;
  chatId: string;
  characterId: string;
  /** Project the chat belongs to, when known (for the `context` section). */
  projectId?: string;
  callingParticipantId?: string;
  loadedMemories?: LoadedMemoriesContext;
}

export const HIGH_IMPORTANCE_THRESHOLD = 0.7 as const;

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function roundPercent(n: number): number {
  return Math.round(n * 10) / 10;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function isImageFileName(basename: string): boolean {
  const ext = basename.includes('.') ? basename.slice(basename.lastIndexOf('.')).toLowerCase() : '';
  return (IMAGE_FILE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Predicate for which vault files to surface. OS cruft is always dropped.
 * Auto-generated images are dropped unless the caller opts in via
 * `includeAutomaticImages`. "Auto-generated" covers two storage conventions:
 *  - document stores (group vaults): images under `character-avatars/` or
 *    `story-backgrounds/` (the shared `isAutomaticImagePath` rule), and
 *  - character vaults: images under the top-level `images/` folder, where the
 *    avatar (`images/avatar.webp`) and generated wardrobe history live. This
 *    convention is private to character vaults, so it is gated behind
 *    `treatImagesFolderAsGenerated` rather than baked into the shared helper.
 */
export function keepVaultFile(
  relativePath: string,
  includeAutomaticImages: boolean,
  treatImagesFolderAsGenerated: boolean
): boolean {
  const segments = relativePath.split('/');
  const basename = segments[segments.length - 1] ?? '';
  if (isOsCruftName(basename)) return false;
  if (includeAutomaticImages) return true;
  if (isAutomaticImagePath(relativePath)) return false;
  if (treatImagesFolderAsGenerated && segments[0] === 'images' && isImageFileName(basename)) {
    return false;
  }
  return true;
}

export type DocMountFileRow = {
  relativePath: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  lastModified: string;
};

export function mapVaultFiles(
  rows: DocMountFileRow[],
  mountPointName: string,
  includeAutomaticImages: boolean,
  treatImagesFolderAsGenerated: boolean,
  makeUri: (relativePath: string) => string
): SelfInventoryVaultFile[] {
  return rows
    .filter((row) =>
      keepVaultFile(row.relativePath, includeAutomaticImages, treatImagesFolderAsGenerated)
    )
    .map((row) => ({
      mountPointName,
      relativePath: row.relativePath,
      fileName: row.fileName,
      fileType: row.fileType,
      fileSizeBytes: row.fileSizeBytes,
      lastModified: row.lastModified,
      uri: makeUri(row.relativePath),
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
