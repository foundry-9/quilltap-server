/**
 * Mount Points API v1 - Mount Point Files Endpoint
 *
 * GET /api/v1/mount-points/[id]/files - List indexed files for a mount point
 */

import path from 'path';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/auth';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import { matchesPattern } from '@/lib/mount-index/scanner';

/**
 * Walk a filesystem-backed mount and return every directory's relative path
 * (POSIX-style, forward slashes). Honors `excludePatterns` so the picker
 * matches what the scanner would consider. Symlinks are skipped, as in the
 * scanner.
 */
async function listFilesystemFolders(
  basePath: string,
  excludePatterns: string[],
  currentRelative = ''
): Promise<string[]> {
  const results: string[] = [];
  const currentAbsolute = currentRelative
    ? path.join(basePath, currentRelative)
    : basePath;

  let entries;
  try {
    entries = await fs.readdir(currentAbsolute, { withFileTypes: true });
  } catch (err) {
    logger.warn('[Mount Points v1] Unable to read directory while listing folders', {
      path: currentAbsolute,
      error: err instanceof Error ? err.message : String(err),
    });
    return results;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory()) continue;

    const relativeNative = currentRelative
      ? path.join(currentRelative, entry.name)
      : entry.name;

    if (excludePatterns.some(pattern => matchesPattern(relativeNative, pattern))) {
      continue;
    }

    const relativePosix = relativeNative.split(path.sep).join('/');
    results.push(relativePosix);

    const sub = await listFilesystemFolders(basePath, excludePatterns, relativeNative);
    results.push(...sub);
  }

  return results;
}

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      logger.debug('[Mount Points v1] Listing files for mount point', {
        mountPointId: id,
        userId: user.id,
      });

      const mountPoint = await repos.docMountPoints.findById(id);

      if (!mountPoint) {
        logger.debug('[Mount Points v1] Mount point not found for file listing', { mountPointId: id });
        return notFound('Mount point');
      }

      const [files, folderRows] = await Promise.all([
        repos.docMountFiles.findByMountPointId(id),
        repos.docMountFolders.findByMountPointId(id),
      ]);

      // Database-backed mounts: folders live in `doc_mount_folders`.
      // Filesystem/obsidian mounts: enumerate directories on disk so empty
      // folders are visible too.
      const folderSet = new Set<string>();
      for (const row of folderRows) {
        if (typeof row.path === 'string' && row.path.length > 0) {
          folderSet.add(row.path);
        }
      }

      if (mountPoint.mountType !== 'database' && mountPoint.basePath) {
        const fsFolders = await listFilesystemFolders(
          mountPoint.basePath,
          mountPoint.excludePatterns ?? []
        );
        for (const f of fsFolders) folderSet.add(f);
      }

      const folders = Array.from(folderSet);

      logger.debug('[Mount Points v1] Found files for mount point', {
        mountPointId: id,
        fileCount: files.length,
        folderCount: folders.length,
        mountType: mountPoint.mountType,
      });

      return NextResponse.json({ files, folders });
    } catch (error) {
      logger.error('[Mount Points v1] Error listing files for mount point', { mountPointId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to list files for mount point');
    }
  }
);
