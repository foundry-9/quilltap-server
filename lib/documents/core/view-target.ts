/**
 * Which store files Document Mode shows read-only rather than edits.
 *
 * @module lib/documents/core/view-target
 */

import path from 'path';
import { isTextFile, statResolvedFile, type ResolvedPath } from '@/lib/doc-edit';
import { detectNativeText } from '@/lib/mount-index/path-utils';
import { getRepositories } from '@/lib/repositories/factory';
import type { DocumentViewTarget } from '@/lib/folder-browser/document-actions';

/**
 * Whether a resolved document is one Document Mode shows read-only rather
 * than edits: any file in a document store that is not a text file. Its
 * bytes are never read as text — the viewer fetches them itself, and no
 * model is handed them through Document Mode. Null for a text file, for a
 * file outside a store (the legacy project and general areas, which the
 * viewer cannot address), and for a store file that does not exist.
 */
export async function viewTargetFor(resolved: ResolvedPath): Promise<DocumentViewTarget | null> {
  if (!resolved.mountPointId) return null;
  // A database store saves only native text (.md, .txt, .json, .jsonl), so
  // any other text kind there (.yaml, .html, …) is shown, not edited.
  const editable = resolved.mountType === 'database'
    ? !!detectNativeText(resolved.relativePath)
    : isTextFile(resolved.relativePath);
  if (editable) return null;
  const link = await getRepositories().docMountFileLinks.findByMountPointAndPath(
    resolved.mountPointId,
    resolved.relativePath,
  );
  if (link) {
    return {
      mountPointId: resolved.mountPointId,
      relativePath: link.relativePath,
      fileName: link.fileName,
      fileType: link.fileType,
      fileSizeBytes: link.fileSizeBytes,
      originalMimeType: link.originalMimeType ?? null,
      updatedAt: link.updatedAt,
    };
  }
  if (resolved.mountType === 'database' || !resolved.absolutePath) return null;
  // A file on disk the store does not index (its kind is outside the
  // include patterns) is still there to look at.
  const stat = await statResolvedFile(resolved);
  if (!stat || !stat.isFile) return null;
  return {
    mountPointId: resolved.mountPointId,
    relativePath: resolved.relativePath,
    fileName: path.basename(resolved.relativePath),
    fileType: 'blob',
    fileSizeBytes: stat.size,
    originalMimeType: null,
    updatedAt: stat.mtime.toISOString(),
  };
}
