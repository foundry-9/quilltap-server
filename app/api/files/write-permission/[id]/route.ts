/**
 * File Write Permission Delete API Route
 *
 * DELETE /api/files/write-permission/:id - Revoke a permission
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, forbidden, serverError } from '@/lib/api/responses';

/**
 * DELETE /api/files/write-permission/:id
 * Revoke a file write permission
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (_request, { user, repos }, { id: permissionId }) => {
    const log = logger.child({
      module: 'api-files-write-permission',
      userId: user.id,
      permissionId,
    });

    try {
      log.debug('Processing permission revoke request');

      // Get the permission to verify ownership
      const permission = await repos.filePermissions.findById(permissionId);

      if (!permission) {
        log.debug('Permission not found');
        return notFound('Permission');
      }

      // Verify ownership
      if (permission.userId !== user.id) {
        log.warn('Permission revoke denied - not owner');
        return forbidden();
      }

      // Revoke the permission
      const revoked = await repos.filePermissions.revokePermission(permissionId);

      if (!revoked) {
        log.warn('Permission revoke failed - not found');
        return notFound('Permission');
      }

      log.info('File write permission revoked', {
        scope: permission.scope,
        projectId: permission.projectId,
        fileId: permission.fileId,
      });

      return NextResponse.json({
        success: true,
        message: 'Permission revoked',
      });
    } catch (error) {
      log.error('Error revoking file write permission', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to revoke permission');
    }
  }
);
