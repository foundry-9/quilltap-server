/**
 * File Promotion API Route
 *
 * POST /api/files/:id/promote - Promote a message attachment to project/general files
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, notFound, forbidden, serverError } from '@/lib/api/responses';
import { normalizeFolderPath, validateFolderPath } from '@/lib/files/folder-utils';

// Validation schema for promotion
const promoteSchema = z.object({
  targetProjectId: z.string().uuid().nullable().optional(),
  folderPath: z.string().optional(),
});

/**
 * POST /api/files/:id/promote
 * Promote a message attachment to project or general files
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: fileId }) => {
    const log = logger.child({
      module: 'api-files-promote',
      userId: user.id,
      fileId,
    });

    try {
      const body = await request.json();
      const parsed = promoteSchema.safeParse(body);

      if (!parsed.success) {
        log.debug('Invalid promotion request', { errors: parsed.error.errors });
        return badRequest('Invalid request: ' + parsed.error.errors.map(e => e.message).join(', '));
      }

      const { targetProjectId, folderPath: rawFolderPath } = parsed.data;
      const folderPath = normalizeFolderPath(rawFolderPath || '/');

      log.debug('Processing file promotion request', {
        targetProjectId,
        folderPath,
      });

      // Validate folder path
      const folderValidation = validateFolderPath(folderPath);
      if (!folderValidation.isValid) {
        return badRequest(folderValidation.error || 'Invalid folder path');
      }

      // Get the file
      const file = await repos.files.findById(fileId);
      if (!file) {
        log.debug('File not found');
        return notFound('File');
      }

      // Verify ownership
      if (file.userId !== user.id) {
        log.warn('File promotion denied - not owner');
        return forbidden();
      }

      // Verify project ownership if targetProjectId provided
      if (targetProjectId) {
        const project = await repos.projects.findById(targetProjectId);
        if (!project || project.userId !== user.id) {
          log.debug('Target project not found or not owned by user');
          return notFound('Project');
        }
      }

      // Update the file's project and folder
      const updated = await repos.files.update(fileId, {
        projectId: targetProjectId ?? null,
        folderPath,
      });

      if (!updated) {
        log.error('Failed to update file');
        return serverError('Failed to promote file');
      }

      log.info('File promoted successfully', {
        newProjectId: targetProjectId ?? null,
        newFolderPath: folderPath,
      });

      return NextResponse.json({
        success: true,
        file: {
          id: updated.id,
          filename: updated.originalFilename,
          projectId: updated.projectId,
          folderPath: updated.folderPath,
        },
        message: targetProjectId
          ? `File promoted to project files in folder "${folderPath}"`
          : `File promoted to general files in folder "${folderPath}"`,
      });
    } catch (error) {
      log.error('Error promoting file', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to promote file');
    }
  }
);
