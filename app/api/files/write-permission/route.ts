/**
 * File Write Permission API Route
 *
 * Manages LLM file write permissions.
 * GET /api/files/write-permission - List user's permissions
 * POST /api/files/write-permission - Grant new permission
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError } from '@/lib/api/responses';
import { FileWritePermissionScopeEnum } from '@/lib/schemas/file-permissions.types';

// Validation schema for granting permission
const grantPermissionSchema = z.object({
  scope: FileWritePermissionScopeEnum,
  fileId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  chatId: z.string().uuid().optional(),
});

/**
 * GET /api/files/write-permission
 * List user's file write permissions
 */
export const GET = createAuthenticatedHandler(
  async (_request, { user, repos }) => {
    const log = logger.child({
      module: 'api-files-write-permission',
      userId: user.id,
    });

    try {
      log.debug('Fetching user file write permissions');

      const permissions = await repos.filePermissions.findByUserId(user.id);

      // Enrich with project/file names where applicable
      const enrichedPermissions = await Promise.all(
        permissions.map(async (perm) => {
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

      log.debug('Retrieved file write permissions', {
        count: enrichedPermissions.length,
      });

      return NextResponse.json({ permissions: enrichedPermissions });
    } catch (error) {
      log.error('Error fetching file write permissions', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch permissions');
    }
  }
);

/**
 * POST /api/files/write-permission
 * Grant a new file write permission
 */
export const POST = createAuthenticatedHandler(
  async (request, { user, repos }) => {
    const log = logger.child({
      module: 'api-files-write-permission',
      userId: user.id,
    });

    try {
      const body = await request.json();
      const parsed = grantPermissionSchema.safeParse(body);

      if (!parsed.success) {
        log.debug('Invalid permission grant request', { errors: parsed.error.errors });
        return badRequest('Invalid request: ' + parsed.error.errors.map(e => e.message).join(', '));
      }

      const { scope, fileId, projectId, chatId } = parsed.data;

      log.debug('Processing permission grant request', {
        scope,
        fileId,
        projectId,
        chatId,
      });

      // Validate scope-specific requirements
      if (scope === 'SINGLE_FILE' && !fileId) {
        return badRequest('fileId is required for SINGLE_FILE scope');
      }

      if (scope === 'PROJECT' && !projectId) {
        return badRequest('projectId is required for PROJECT scope');
      }

      // Verify project ownership if projectId provided
      if (projectId) {
        const project = await repos.projects.findById(projectId);
        if (!project || project.userId !== user.id) {
          return notFound('Project');
        }
      }

      // Verify file ownership if fileId provided
      if (fileId) {
        const file = await repos.files.findById(fileId);
        if (!file || file.userId !== user.id) {
          return notFound('File');
        }
      }

      // Check if permission already exists
      const existingPermissions = await repos.filePermissions.findByUserId(user.id);
      const alreadyExists = existingPermissions.some((p) => {
        if (scope === 'SINGLE_FILE') {
          return p.scope === 'SINGLE_FILE' && p.fileId === fileId;
        }
        if (scope === 'PROJECT') {
          return p.scope === 'PROJECT' && p.projectId === projectId;
        }
        if (scope === 'GENERAL') {
          return p.scope === 'GENERAL';
        }
        return false;
      });

      if (alreadyExists) {
        log.debug('Permission already exists', { scope, fileId, projectId });
        return NextResponse.json({
          success: true,
          message: 'Permission already granted',
          alreadyExists: true,
        });
      }

      // Create the permission
      const now = new Date().toISOString();
      const permission = await repos.filePermissions.grantPermission({
        userId: user.id,
        scope,
        fileId: scope === 'SINGLE_FILE' ? fileId : null,
        projectId: scope === 'PROJECT' ? projectId : null,
        grantedAt: now,
        grantedInChatId: chatId || null,
      });

      log.info('File write permission granted', {
        permissionId: permission.id,
        scope,
        fileId,
        projectId,
      });

      return NextResponse.json({
        success: true,
        permission: {
          id: permission.id,
          scope: permission.scope,
          projectId: permission.projectId,
          fileId: permission.fileId,
          grantedAt: permission.grantedAt,
          createdAt: permission.createdAt,
        },
      });
    } catch (error) {
      log.error('Error granting file write permission', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to grant permission');
    }
  }
);
