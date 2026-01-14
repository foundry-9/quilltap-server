/**
 * Files API v1 - Write Permissions Endpoint
 *
 * GET /api/v1/files/write-permissions - List user's file write permissions
 * POST /api/v1/files/write-permissions - Grant a new file write permission
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { successResponse, badRequest, notFound, serverError, validationError } from '@/lib/api/responses';
import { FileWritePermissionScopeEnum } from '@/lib/schemas/file-permissions.types';

// Validation schema for granting permission
const grantPermissionSchema = z.object({
  scope: FileWritePermissionScopeEnum,
  fileId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  grantedInChatId: z.string().uuid().optional(),
});

// ============================================================================
// GET Handler - List permissions
// ============================================================================

export const GET = createAuthenticatedHandler(async (_request, { user, repos }) => {
  try {
    logger.debug('[Files v1] GET list file write permissions', { userId: user.id });

    const permissions = await repos.filePermissions.findByUserId(user.id);

    // Enrich with project/file names where applicable
    const enrichedPermissions = await Promise.all(
      permissions.map(async (perm: any) => {
        let projectName: string | null = null;
        let filename: string | null = null;

        if (perm.projectId) {
          const project = await repos.projects.findById(perm.projectId);
          projectName = project?.name || null;
        }

        if (perm.fileId) {
          const file = await repos.files.findById(perm.fileId);
          filename = file?.originalFilename || null;
        }

        return {
          id: perm.id,
          scope: perm.scope,
          projectId: perm.projectId,
          projectName,
          fileId: perm.fileId,
          filename,
          grantedAt: perm.grantedAt,
          grantedInChatId: perm.grantedInChatId,
          createdAt: perm.createdAt,
        };
      })
    );

    logger.debug('[Files v1] Retrieved file write permissions', {
      userId: user.id,
      count: enrichedPermissions.length,
    });

    return successResponse({ permissions: enrichedPermissions });
  } catch (error) {
    logger.error('[Files v1] Error fetching file write permissions', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch permissions');
  }
});

// ============================================================================
// POST Handler - Grant permission
// ============================================================================

export const POST = createAuthenticatedHandler(async (request, { user, repos }) => {
  try {
    const body = await request.json();
    const parsed = grantPermissionSchema.safeParse(body);

    if (!parsed.success) {
      logger.debug('[Files v1] Invalid permission grant request', { errors: parsed.error.errors });
      return badRequest('Invalid request: ' + parsed.error.errors.map((e: any) => e.message).join(', '));
    }

    const { scope, fileId, projectId, grantedInChatId } = parsed.data;

    logger.debug('[Files v1] Processing file write permission grant', {
      userId: user.id,
      scope,
      fileId,
      projectId,
      grantedInChatId,
    });

    // Validate that required IDs are provided based on scope
    if (scope === 'SINGLE_FILE' && !fileId) {
      return badRequest('fileId is required for SINGLE_FILE scope');
    }
    if (scope === 'PROJECT' && !projectId) {
      return badRequest('projectId is required for PROJECT scope');
    }

    // Verify ownership of referenced entities
    if (fileId) {
      const file = await repos.files.findById(fileId);
      if (!file || file.userId !== user.id) {
        logger.debug('[Files v1] File not found or not owned by user', { fileId });
        return notFound('File');
      }
    }

    if (projectId) {
      const project = await repos.projects.findById(projectId);
      if (!project || project.userId !== user.id) {
        logger.debug('[Files v1] Project not found or not owned by user', { projectId });
        return notFound('Project');
      }
    }

    if (grantedInChatId) {
      const chat = await repos.chats.findById(grantedInChatId);
      if (!chat || chat.userId !== user.id) {
        logger.debug('[Files v1] Chat not found or not owned by user', { grantedInChatId });
        return notFound('Chat');
      }
    }

    // Create the permission
    const permission = await repos.filePermissions.create({
      userId: user.id,
      scope,
      fileId: fileId || null,
      projectId: projectId || null,
      grantedAt: new Date().toISOString(),
      grantedInChatId: grantedInChatId || null,
    });

    logger.info('[Files v1] File write permission granted', {
      userId: user.id,
      permissionId: permission.id,
      scope,
    });

    // Enrich response
    let projectName: string | null = null;
    let filename: string | null = null;

    if (projectId) {
      const project = await repos.projects.findById(projectId);
      projectName = project?.name || null;
    }

    if (fileId) {
      const file = await repos.files.findById(fileId);
      filename = file?.originalFilename || null;
    }

    return successResponse(
      {
        data: {
          id: permission.id,
          scope: permission.scope,
          projectId: permission.projectId,
          projectName,
          fileId: permission.fileId,
          filename,
          grantedAt: permission.grantedAt,
          grantedInChatId: permission.grantedInChatId,
          createdAt: permission.createdAt,
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Files v1] Error granting file write permission', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to grant permission');
  }
});
