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
import { notFound, serverError, successResponse } from '@/lib/api/responses';
import { scanMountPoint } from '@/lib/mount-index/scanner';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';

// ============================================================================
// Schemas
// ============================================================================

const updateMountPointSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  basePath: z.string().min(1).optional(),
  mountType: z.enum(['filesystem', 'obsidian']).optional(),
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

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  (req, ctx, { id }) => {
    const dispatch = withActionDispatch<{ id: string }>({
      scan: handleScan,
    });
    return dispatch(req, ctx, { id });
  }
);
