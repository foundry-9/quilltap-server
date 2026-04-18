/**
 * Mount Points API v1 - Individual Mount Point Endpoint
 *
 * GET /api/v1/mount-points/[id] - Get mount point details
 * PATCH /api/v1/mount-points/[id] - Update mount point
 * DELETE /api/v1/mount-points/[id] - Delete mount point and associated data
 *
 * Actions:
 * POST /api/v1/mount-points/[id]?action=scan - Trigger scan and embedding
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import type { RequestContext } from '@/lib/api/middleware/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import { scanMountPoint } from '@/lib/mount-index/scanner';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import { detachMountPoint, refreshMountPoint } from '@/lib/mount-index/watcher';
import {
  convertMountPointToDatabase,
  deconvertMountPointToFilesystem,
  validateDeconvertTarget,
} from '@/lib/mount-index/conversion';
import { scaffoldCharacterMount } from '@/lib/mount-index/character-scaffold';

// ============================================================================
// Schemas
// ============================================================================

const updateMountPointSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  // basePath may be empty when switching to (or already is) a database-backed store.
  basePath: z.string().optional(),
  mountType: z.enum(['filesystem', 'obsidian', 'database']).optional(),
  storeType: z.enum(['documents', 'character']).optional(),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      logger.debug('[Mount Points v1] Getting mount point by ID', {
        mountPointId: id,
        userId: user.id,
      });

      const mountPoint = await repos.docMountPoints.findById(id);

      if (!mountPoint) {
        logger.debug('[Mount Points v1] Mount point not found', { mountPointId: id });
        return notFound('Mount point');
      }

      // Compute embedded chunk count
      const allChunks = await repos.docMountChunks.findByMountPointId(id);
      const embeddedChunkCount = allChunks.filter(
        c => c.embedding != null && Array.isArray(c.embedding) && c.embedding.length > 0
      ).length;

      logger.debug('[Mount Points v1] Found mount point', {
        mountPointId: id,
        name: mountPoint.name,
        embeddedChunkCount,
        totalChunks: allChunks.length,
      });

      return NextResponse.json({
        mountPoint: { ...mountPoint, embeddedChunkCount },
      });
    } catch (error) {
      logger.error('[Mount Points v1] Error fetching mount point', { mountPointId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch mount point');
    }
  }
);

// ============================================================================
// PATCH Handler
// ============================================================================

export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      logger.debug('[Mount Points v1] Updating mount point', {
        mountPointId: id,
        userId: user.id,
      });

      const existing = await repos.docMountPoints.findById(id);
      if (!existing) {
        logger.debug('[Mount Points v1] Mount point not found for update', { mountPointId: id });
        return notFound('Mount point');
      }

      const body = await req.json();
      const validatedData = updateMountPointSchema.parse(body);

      const updated = await repos.docMountPoints.update(id, validatedData);

      if (!updated) {
        logger.error('[Mount Points v1] Failed to update mount point', { mountPointId: id });
        return serverError('Failed to update mount point');
      }

      logger.info('[Mount Points v1] Mount point updated', {
        mountPointId: id,
        name: updated.name,
        userId: user.id,
      });

      // Scaffold preset structure when storeType is flipped to 'character'
      // on a database-backed store. Missing-only — existing files are not touched.
      const flippedToCharacter =
        existing.storeType !== 'character' && updated.storeType === 'character';
      if (flippedToCharacter && updated.mountType === 'database') {
        await scaffoldCharacterMount(id).catch((err) => {
          logger.warn('[Mount Points v1] Character scaffold failed after flip', {
            mountPointId: id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Refresh the watcher so basePath / pattern / enabled changes take effect
      refreshMountPoint(updated).catch((err) => {
        logger.warn('[Mount Points v1] Failed to refresh watcher after update', {
          mountPointId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return NextResponse.json({ mountPoint: updated });
    } catch (error) {
      logger.error('[Mount Points v1] Error updating mount point', { mountPointId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to update mount point');
    }
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      logger.debug('[Mount Points v1] Deleting mount point', {
        mountPointId: id,
        userId: user.id,
      });

      const existing = await repos.docMountPoints.findById(id);
      if (!existing) {
        logger.debug('[Mount Points v1] Mount point not found for deletion', { mountPointId: id });
        return notFound('Mount point');
      }

      // Stop the watcher before tearing down the database records
      await detachMountPoint(id).catch((err) => {
        logger.warn('[Mount Points v1] Failed to detach watcher before delete', {
          mountPointId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Delete associated chunks first
      const chunksDeleted = await repos.docMountChunks.deleteByMountPointId(id);
      logger.debug('[Mount Points v1] Deleted associated chunks', {
        mountPointId: id,
        chunksDeleted,
      });

      // Delete associated files
      const filesDeleted = await repos.docMountFiles.deleteByMountPointId(id);
      logger.debug('[Mount Points v1] Deleted associated files', {
        mountPointId: id,
        filesDeleted,
      });

      // Delete DB-backed document bodies and blobs (no-ops on filesystem mounts).
      const documentsDeleted = await repos.docMountDocuments.deleteByMountPointId(id);
      const blobsDeleted = await repos.docMountBlobs.deleteByMountPointId(id);
      logger.debug('[Mount Points v1] Deleted DB-backed documents and blobs', {
        mountPointId: id,
        documentsDeleted,
        blobsDeleted,
      });

      // Delete project links
      const links = await repos.projectDocMountLinks.findByMountPointId(id);
      for (const link of links) {
        await repos.projectDocMountLinks.delete(link.id);
      }
      logger.debug('[Mount Points v1] Deleted project links', {
        mountPointId: id,
        linksDeleted: links.length,
      });

      // Delete the mount point itself
      await repos.docMountPoints.delete(id);

      logger.info('[Mount Points v1] Mount point deleted', {
        mountPointId: id,
        name: existing.name,
        chunksDeleted,
        filesDeleted,
        linksDeleted: links.length,
        userId: user.id,
      });

      return successResponse({ message: 'Mount point deleted successfully' });
    } catch (error) {
      logger.error('[Mount Points v1] Error deleting mount point', { mountPointId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete mount point');
    }
  }
);

// ============================================================================
// POST Handler (Action Dispatch)
// ============================================================================

async function handleScan(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  try {
    logger.debug('[Mount Points v1] Scan action triggered', {
      mountPointId: id,
      userId: user.id,
    });

    const mountPoint = await repos.docMountPoints.findById(id);
    if (!mountPoint) {
      logger.debug('[Mount Points v1] Mount point not found for scan', { mountPointId: id });
      return notFound('Mount point');
    }

    // Run the scan
    const scanResult = await scanMountPoint(mountPoint);

    logger.info('[Mount Points v1] Scan completed', {
      mountPointId: id,
      name: mountPoint.name,
      filesScanned: scanResult.filesScanned,
      filesNew: scanResult.filesNew,
      filesModified: scanResult.filesModified,
      filesDeleted: scanResult.filesDeleted,
      chunksCreated: scanResult.chunksCreated,
      errors: scanResult.errors.length,
    });

    // Enqueue embedding jobs for newly scanned content
    const embeddingJobsEnqueued = await enqueueEmbeddingJobsForMountPoint(id);
    logger.debug('[Mount Points v1] Embedding jobs enqueued', {
      mountPointId: id,
      jobsEnqueued: embeddingJobsEnqueued,
    });

    return successResponse({ scanResult, embeddingJobsEnqueued });
  } catch (error) {
    logger.error('[Mount Points v1] Error scanning mount point', { mountPointId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to scan mount point');
  }
}

// ============================================================================
// Convert (filesystem/obsidian → database) Action
// ============================================================================

async function handleConvert(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  try {
    logger.debug('[Mount Points v1] Convert action triggered', {
      mountPointId: id,
      userId: user.id,
    });

    const mountPoint = await repos.docMountPoints.findById(id);
    if (!mountPoint) {
      return notFound('Mount point');
    }
    if (mountPoint.mountType !== 'filesystem' && mountPoint.mountType !== 'obsidian') {
      return badRequest(
        `Mount point is already database-backed (mountType=${mountPoint.mountType})`
      );
    }
    if (mountPoint.conversionStatus === 'converting' || mountPoint.conversionStatus === 'deconverting') {
      return badRequest('A conversion is already in progress for this mount point');
    }

    await repos.docMountPoints.updateConversionStatus(id, 'converting');

    // Stop the watcher so chokidar doesn't react to files disappearing as the
    // mount-type changes; database-backed stores have no filesystem to watch.
    await detachMountPoint(id).catch((err) => {
      logger.warn('[Mount Points v1] Failed to detach watcher before convert', {
        mountPointId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    try {
      const convertResult = await convertMountPointToDatabase(mountPoint);

      await repos.docMountPoints.update(id, {
        mountType: 'database',
        basePath: '',
      });
      await repos.docMountPoints.updateConversionStatus(id, 'idle');

      logger.info('[Mount Points v1] Convert completed', {
        mountPointId: id,
        name: mountPoint.name,
        filesMigrated: convertResult.filesMigrated,
        documentsWritten: convertResult.documentsWritten,
        blobsWritten: convertResult.blobsWritten,
        filesSkipped: convertResult.filesSkipped,
        errors: convertResult.errors.length,
        userId: user.id,
      });

      const updated = await repos.docMountPoints.findById(id);
      return successResponse({
        mountPoint: updated,
        convertResult,
        previousBasePath: mountPoint.basePath,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await repos.docMountPoints.updateConversionStatus(id, 'error', msg);
      // Best-effort: re-attach the watcher so a partially-converted store still
      // picks up on-disk changes until the user retries.
      refreshMountPoint(mountPoint).catch(() => {});
      throw err;
    }
  } catch (error) {
    logger.error(
      '[Mount Points v1] Error converting mount point',
      { mountPointId: id },
      error instanceof Error ? error : undefined
    );
    return serverError(
      `Failed to convert mount point: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// Deconvert (database → filesystem) Action
// ============================================================================

const deconvertSchema = z.object({
  targetPath: z.string().min(1),
});

async function handleDeconvert(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  try {
    logger.debug('[Mount Points v1] Deconvert action triggered', {
      mountPointId: id,
      userId: user.id,
    });

    const body = await req.json().catch(() => ({}));
    const parsed = deconvertSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('Deconvert requires a non-empty targetPath');
    }
    const { targetPath } = parsed.data;

    const mountPoint = await repos.docMountPoints.findById(id);
    if (!mountPoint) {
      return notFound('Mount point');
    }
    if (mountPoint.mountType !== 'database') {
      return badRequest(
        `Mount point is not database-backed (mountType=${mountPoint.mountType}); nothing to deconvert`
      );
    }
    if (mountPoint.conversionStatus === 'converting' || mountPoint.conversionStatus === 'deconverting') {
      return badRequest('A conversion is already in progress for this mount point');
    }

    try {
      await validateDeconvertTarget(targetPath);
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : String(err));
    }

    await repos.docMountPoints.updateConversionStatus(id, 'deconverting');

    try {
      const deconvertResult = await deconvertMountPointToFilesystem(mountPoint, targetPath);

      const updated = await repos.docMountPoints.update(id, {
        mountType: 'filesystem',
        basePath: targetPath,
      });
      await repos.docMountPoints.updateConversionStatus(id, 'idle');

      // Reattach the watcher against the new basePath so live edits on disk
      // start flowing back into the mount index.
      if (updated) {
        refreshMountPoint(updated).catch((watcherErr) => {
          logger.warn('[Mount Points v1] Failed to attach watcher after deconvert', {
            mountPointId: id,
            error: watcherErr instanceof Error ? watcherErr.message : String(watcherErr),
          });
        });
      }

      logger.info('[Mount Points v1] Deconvert completed', {
        mountPointId: id,
        name: mountPoint.name,
        targetPath,
        filesWritten: deconvertResult.filesWritten,
        blobsWritten: deconvertResult.blobsWritten,
        bytesWritten: deconvertResult.bytesWritten,
        errors: deconvertResult.errors.length,
        userId: user.id,
      });

      return successResponse({
        mountPoint: updated,
        deconvertResult,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await repos.docMountPoints.updateConversionStatus(id, 'error', msg);
      throw err;
    }
  } catch (error) {
    logger.error(
      '[Mount Points v1] Error deconverting mount point',
      { mountPointId: id },
      error instanceof Error ? error : undefined
    );
    return serverError(
      `Failed to deconvert mount point: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  (req, ctx, { id }) => {
    const dispatch = withActionDispatch<{ id: string }>({
      scan: handleScan,
      convert: handleConvert,
      deconvert: handleDeconvert,
    });
    return dispatch(req, ctx, { id });
  }
);
