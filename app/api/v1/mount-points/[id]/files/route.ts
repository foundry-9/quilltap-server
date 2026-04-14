/**
 * Mount Points API v1 - Mount Point Files Endpoint
 *
 * GET /api/v1/mount-points/[id]/files - List indexed files for a mount point
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/auth';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';

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

      const files = await repos.docMountFiles.findByMountPointId(id);

      logger.debug('[Mount Points v1] Found files for mount point', {
        mountPointId: id,
        fileCount: files.length,
      });

      return NextResponse.json({ files });
    } catch (error) {
      logger.error('[Mount Points v1] Error listing files for mount point', { mountPointId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to list files for mount point');
    }
  }
);
