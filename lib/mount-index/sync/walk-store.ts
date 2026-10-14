/**
 * One read of a database-backed store: every link row and every folder row,
 * reduced to the {@link SyncEntry} shape the planner takes.
 *
 * The sha the store already keeps is the sha of the bytes as they would sit on
 * disk — `doc_mount_files.sha256` is a hard invariant on the content, and for
 * text documents it is `sha256OfString(content)`, which is the sha of the
 * UTF-8 bytes a disk copy would hold. So the two sides hash the same thing and
 * nothing here has to read the bytes to compare them. Bytes are fetched only
 * when an action actually needs them.
 *
 * Dot-paths are dropped before planning: a link or folder whose path has a
 * segment beginning with `.` is invisible to the sync in both directions, so
 * it is neither materialised on disk nor deleted from the store.
 *
 * @module mount-index/sync/walk-store
 */

import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';
import { isSidecarPath } from './sidecar';
import type { SyncEntry, SyncEntryMap } from './types';

/** True when any segment of a POSIX relative path begins with a dot. */
export function hasDotSegment(relativePath: string): boolean {
  return relativePath.split('/').some(seg => seg.startsWith('.'));
}

export interface StoreWalkResult {
  entries: SyncEntryMap;
  warnings: string[];
  /**
   * Store paths whose own name ends in the sidecar suffix. Excluded from the
   * entry map and reported as conflicts — they are skipped in both directions
   * rather than fought over.
   */
  reservedPaths: string[];
}

export async function walkStore(mountPoint: DocMountPoint): Promise<StoreWalkResult> {
  const repos = getRepositories();
  const entries: SyncEntryMap = new Map();
  const warnings: string[] = [];
  const reservedPaths: string[] = [];

  const folders = await repos.docMountFolders.findByMountPointId(mountPoint.id);
  for (const folder of folders) {
    if (!folder.path) continue; // the root is the target directory itself
    if (hasDotSegment(folder.path)) continue;
    entries.set(folder.path.toLowerCase(), {
      relativePath: folder.path,
      kind: 'folder',
      lastModified: folder.updatedAt,
      createdAt: folder.createdAt,
      folderId: folder.id,
    });
  }

  const links = await repos.docMountFileLinks.findByMountPointId(mountPoint.id);
  for (const link of links) {
    if (hasDotSegment(link.relativePath)) continue;

    // A store file whose own name ends in `.description.md` would collide with
    // the sidecar convention: the disk walk cannot tell the two apart, and a
    // round trip would attach it to a partner that does not want it.
    if (isSidecarPath(link.relativePath)) {
      reservedPaths.push(link.relativePath);
      continue;
    }

    const entry: SyncEntry = {
      relativePath: link.relativePath,
      kind: 'file',
      sha256: link.sha256,
      sizeBytes: link.fileSizeBytes,
      lastModified: link.lastModified,
      createdAt: link.createdAt,
      description: link.description ?? '',
      descriptionUpdatedAt: link.descriptionUpdatedAt ?? null,
      linkId: link.id,
      fileId: link.fileId,
      linkGroupId: link.linkGroupId ?? null,
      fileType: link.fileType,
      folderId: link.folderId ?? null,
    };
    entries.set(link.relativePath.toLowerCase(), entry);
  }

  logger.debug('[Sync] Store walk complete', {
    mountPointId: mountPoint.id,
    files: links.length,
    folders: folders.length,
    planned: entries.size,
  });

  return { entries, warnings, reservedPaths };
}
