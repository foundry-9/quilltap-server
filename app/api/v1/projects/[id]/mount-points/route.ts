/**
 * Projects API v1 - Project Mount Points Endpoint
 *
 * GET /api/v1/projects/[id]/mount-points - List mount points linked to a project
 * POST /api/v1/projects/[id]/mount-points - Link a mount point to a project
 * DELETE /api/v1/projects/[id]/mount-points - Unlink a mount point from a project
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { created, notFound, badRequest, serverError, successResponse } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const linkMountPointSchema = z.object({
  mountPointId: z.string().min(1, 'Mount point ID is required'),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      logger.debug('[Projects v1] Listing mount points for project', {
        projectId: id,
        userId: user.id,
      });

      // Verify project exists
      const project = await repos.projects.findById(id);
      if (!project) {
        logger.debug('[Projects v1] Project not found for mount point listing', { projectId: id });
        return notFound('Project');
      }

      // Get links for this project
      const links = await repos.projectDocMountLinks.findByProjectId(id);

      // Fetch each mount point
      const mountPoints = await Promise.all(
        links.map(async (link) => {
          const mountPoint = await repos.docMountPoints.findById(link.mountPointId);
          return mountPoint;
        })
      );

      // Filter out any null results (mount points that were deleted but links remain)
      const validMountPoints = mountPoints.filter((mp) => mp !== null);

      logger.debug('[Projects v1] Found mount points for project', {
        projectId: id,
        totalLinks: links.length,
        validMountPoints: validMountPoints.length,
      });

      return NextResponse.json({ mountPoints: validMountPoints });
    } catch (error) {
      logger.error('[Projects v1] Error listing mount points for project', { projectId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to list mount points for project');
    }
  }
);

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      logger.debug('[Projects v1] Linking mount point to project', {
        projectId: id,
        userId: user.id,
      });

      // Verify project exists
      const project = await repos.projects.findById(id);
      if (!project) {
        logger.debug('[Projects v1] Project not found for mount point linking', { projectId: id });
        return notFound('Project');
      }

      const body = await req.json();
      const validatedData = linkMountPointSchema.parse(body);

      // Verify mount point exists
      const mountPoint = await repos.docMountPoints.findById(validatedData.mountPointId);
      if (!mountPoint) {
        logger.debug('[Projects v1] Mount point not found for linking', {
          projectId: id,
          mountPointId: validatedData.mountPointId,
        });
        return notFound('Mount point');
      }

      const link = await repos.projectDocMountLinks.link(id, validatedData.mountPointId);

      logger.info('[Projects v1] Mount point linked to project', {
        projectId: id,
        mountPointId: validatedData.mountPointId,
        linkId: link.id,
        userId: user.id,
      });

      return created({ link, mountPoint });
    } catch (error) {
      logger.error('[Projects v1] Error linking mount point to project', { projectId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to link mount point to project');
    }
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      logger.debug('[Projects v1] Unlinking mount point from project', {
        projectId: id,
        userId: user.id,
      });

      // Verify project exists
      const project = await repos.projects.findById(id);
      if (!project) {
        logger.debug('[Projects v1] Project not found for mount point unlinking', { projectId: id });
        return notFound('Project');
      }

      const body = await req.json();
      const validatedData = linkMountPointSchema.parse(body);

      const unlinked = await repos.projectDocMountLinks.unlink(id, validatedData.mountPointId);

      if (!unlinked) {
        logger.debug('[Projects v1] No link found between project and mount point', {
          projectId: id,
          mountPointId: validatedData.mountPointId,
        });
        return badRequest('No link exists between this project and mount point');
      }

      logger.info('[Projects v1] Mount point unlinked from project', {
        projectId: id,
        mountPointId: validatedData.mountPointId,
        userId: user.id,
      });

      return successResponse({ message: 'Mount point unlinked from project' });
    } catch (error) {
      logger.error('[Projects v1] Error unlinking mount point from project', { projectId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to unlink mount point from project');
    }
  }
);
