import { NextRequest, NextResponse } from 'next/server';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { serverError, successResponse } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { canGenerateThumbnail, cleanupThumbnails } from '@/lib/files/thumbnail-utils';
import { cleanupOrphansSchema } from '../shared';

export async function handleCleanupOrphans(
  request: NextRequest,
  ctx: AuthenticatedContext
): Promise<NextResponse> {
  try {
    let dryRun = true;
    let mode: 'move' | 'delete' = 'delete';

    try {
      const body = await request.json();
      const parsed = cleanupOrphansSchema.safeParse(body);
      if (parsed.success) {
        dryRun = parsed.data.dryRun;
        mode = parsed.data.mode;
      }
    } catch {
      // Empty body or invalid JSON defaults to dryRun and delete mode.
    }

    logger.info('[Files v1] Cleanup orphans requested', {
      userId: ctx.user.id,
      dryRun,
      mode,
    });

    const allFiles = await ctx.repos.files.findByUserId(ctx.user.id);

    // Partition into orphaned and tracked files
    const orphaned = allFiles.filter(f => f.fileStatus === 'orphaned');
    const tracked = allFiles.filter(f => f.fileStatus !== 'orphaned');

    // Build set of tracked SHA-256 hashes
    const trackedHashes = new Set(tracked.map(f => f.sha256));

    // Split orphans into duplicates and unique
    const duplicates = orphaned.filter(f => trackedHashes.has(f.sha256));
    const unique = orphaned.filter(f => !trackedHashes.has(f.sha256));

    // Calculate sizes
    const totalSize = orphaned.reduce((sum, f) => sum + f.size, 0);
    const duplicateSize = duplicates.reduce((sum, f) => sum + f.size, 0);
    const uniqueSize = unique.reduce((sum, f) => sum + f.size, 0);

    logger.info('[Files v1] Cleanup orphans analysis', {
      userId: ctx.user.id,
      orphanedCount: orphaned.length,
      duplicateCount: duplicates.length,
      uniqueCount: unique.length,
      totalSize,
    });

    // Dry run: just return stats
    if (dryRun === true) {
      return successResponse({
        orphanedCount: orphaned.length,
        duplicateCount: duplicates.length,
        uniqueCount: unique.length,
        totalSize,
        duplicateSize,
        uniqueSize,
        dryRun: true,
      });
    }

    // Actual cleanup
    let deleted = 0;
    let moved = 0;
    const errors: string[] = [];

    // Determine which files to delete
    const filesToDelete = mode === 'delete' ? [...duplicates, ...unique] : duplicates;

    // Delete files
    for (const file of filesToDelete) {
      try {
        if (file.storageKey) {
          await fileStorageManager.deleteFile(file);
        }

        if (canGenerateThumbnail(file.mimeType)) {
          await cleanupThumbnails(file);
        }

        await ctx.repos.files.delete(file.id);
        deleted += 1;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          '[Files v1] Failed to delete orphaned file',
          { fileId: file.id },
          error instanceof Error ? error : undefined
        );
        errors.push(`Error deleting file ${file.id}: ${errorMsg}`);
      }
    }

    // Move unique files to /orphans/ folder (only if mode === 'move')
    if (mode === 'move') {
      for (const file of unique) {
        try {
          await ctx.repos.files.update(file.id, {
            folderPath: '/orphans/',
            fileStatus: 'ok',
            projectId: null,
          });
          moved += 1;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error(
            '[Files v1] Failed to move orphaned file',
            { fileId: file.id },
            error instanceof Error ? error : undefined
          );
          errors.push(`Error moving file ${file.id}: ${errorMsg}`);
        }
      }
    }

    logger.info('[Files v1] Cleanup orphans complete', {
      userId: ctx.user.id,
      orphanedCount: orphaned.length,
      duplicateCount: duplicates.length,
      uniqueCount: unique.length,
      totalSize,
      deleted,
      moved,
      mode,
    });

    return successResponse({
      orphanedCount: orphaned.length,
      duplicateCount: duplicates.length,
      uniqueCount: unique.length,
      totalSize,
      deleted,
      moved,
      dryRun: false,
      mode,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error(
      '[Files v1] Error cleaning up orphaned files',
      { userId: ctx.user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to cleanup orphaned files');
  }
}
