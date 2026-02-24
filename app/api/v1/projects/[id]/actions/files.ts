/**
 * Projects API v1 - File Association Actions
 *
 * GET /api/v1/projects/[id]?action=list-files - List project files
 * POST /api/v1/projects/[id]?action=add-file - Associate file with project
 * DELETE /api/v1/projects/[id]?action=remove-file - Remove file from project
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, validationError, serverError, successResponse } from '@/lib/api/responses';
import { addFileSchema, removeFileSchema } from '../schemas';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * List files associated with project
 */
export async function handleListFiles(
  projectId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const allFiles = await repos.files.findAll();
    const files = allFiles
      .filter(f => f.projectId === projectId)
      .map(f => ({
        id: f.id,
        userId: f.userId,
        originalFilename: f.originalFilename,
        filename: f.originalFilename,
        mimeType: f.mimeType,
        size: f.size,
        category: f.category,
        description: f.description,
        projectId: f.projectId,
        folderPath: f.folderPath || '/',
        width: f.width,
        height: f.height,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }));

    return successResponse({
      files,
      count: files.length,
    });
  } catch (error) {
    logger.error('[Projects v1] Error listing project files', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to list files');
  }
}

/**
 * Associate file with project
 */
export async function handleAddFile(
  req: NextRequest,
  projectId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { fileId } = addFileSchema.parse(body);

    // Check file exists and is owned by user
    const file = await repos.files.findById(fileId);
    if (!file || file.userId !== user.id) {
      return notFound('File');
    }

    // Associate file with project
    await repos.files.update(fileId, { projectId });

    logger.info('[Projects v1] File added to project', { projectId, fileId });

    return successResponse({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error adding file', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to add file');
  }
}

/**
 * Remove file from project
 */
export async function handleRemoveFile(
  req: NextRequest,
  projectId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { fileId } = removeFileSchema.parse(body);

    // Remove projectId from file
    await repos.files.update(fileId, { projectId: null });

    logger.info('[Projects v1] File removed from project', { projectId, fileId });

    return successResponse({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error removing file', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to remove file');
  }
}
