/**
 * Files API v1 - Collection Endpoint
 *
 * GET /api/v1/files - List files (filter by projectId, folderPath, or filter=general)
 * POST /api/v1/files?action=write - Write/create a file
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { logger } from '@/lib/logger';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { normalizeFolderPath, validateFolderPath } from '@/lib/files/folder-utils';
import { createHash } from 'crypto';
import { z } from 'zod';
import { successResponse, badRequest, forbidden, serverError, validationError } from '@/lib/api/responses';

const writeFileSchema = z.object({
  filename: z.string().min(1).max(255),
  content: z.string().max(1024 * 1024), // Max 1MB content
  mimeType: z.string().prefault('text/plain'),
  projectId: z.uuid().nullable().optional(),
  folderPath: z.string().optional(),
});

// ============================================================================
// GET Handler - List files
// ============================================================================

export const GET = createAuthenticatedHandler(async (request, { user, repos }) => {
  try {
    logger.debug('[Files v1] GET list files', { userId: user.id });

    const searchParams = request.nextUrl.searchParams;
    const projectId = searchParams.get('projectId');
    const folderPath = searchParams.get('folderPath');
    const filter = searchParams.get('filter');

    // Get all files for this user
    const allFiles = await repos.files.findByUserId(user.id);

    // Filter files based on parameters
    let files = allFiles;

    // filter=general returns only files without a project
    if (filter === 'general') {
      files = files.filter((f: any) => f.projectId === null || f.projectId === undefined);
    } else if (projectId) {
      // Filter by specific project
      files = files.filter((f: any) => f.projectId === projectId);
    }

    // Filter by folder if provided
    if (folderPath) {
      const normalizedPath = normalizeFolderPath(folderPath);
      files = files.filter((f: any) => f.folderPath === normalizedPath);
    }

    // Sort by createdAt descending
    files.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    logger.info('[Files v1] Retrieved file list', { userId: user.id, fileCount: files.length, filter });

    return successResponse({
      files: files.map((file: any) => ({
        id: file.id,
        userId: file.userId,
        originalFilename: file.originalFilename,
        filename: file.originalFilename,
        filepath: getFilePath(file),
        mimeType: file.mimeType,
        size: file.size,
        category: file.category,
        description: file.description,
        projectId: file.projectId,
        folderPath: file.folderPath || '/',
        width: file.width,
        height: file.height,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      })),
    });
  } catch (error) {
    logger.error('[Files v1] Error listing files', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list files');
  }
});

// ============================================================================
// POST Handler - Write file or dispatch to actions
// ============================================================================

export const POST = createAuthenticatedHandler(async (request, { user, repos }) => {
  const action = getActionParam(request);

  // Handle write action
  if (action === 'write') {
    return handleWriteFile(request, user, repos);
  }

  return badRequest(`Unknown action: ${action}. Available actions: write`);
});

// ============================================================================
// Helper: Write File
// ============================================================================

async function handleWriteFile(request: NextRequest, user: any, repos: any): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = writeFileSchema.safeParse(body);

    if (!parsed.success) {
      logger.debug('[Files v1] Invalid file write request', { errors: parsed.error.issues });
      return badRequest('Invalid request: ' + parsed.error.issues.map((e: any) => e.message).join(', '));
    }

    const { filename, content, mimeType, projectId, folderPath: rawFolderPath } = parsed.data;
    const targetProjectId = projectId ?? null;
    const folderPath = normalizeFolderPath(rawFolderPath || '/');

    logger.debug('[Files v1] Processing file write request', {
      filename,
      contentLength: content.length,
      mimeType,
      projectId: targetProjectId,
      folderPath,
      userId: user.id,
    });

    // Validate folder path
    const folderValidation = validateFolderPath(folderPath);
    if (!folderValidation.isValid) {
      return badRequest(folderValidation.error || 'Invalid folder path');
    }

    // Check file write permission
    const canWrite = await repos.filePermissions.canWriteFile(
      user.id,
      targetProjectId,
      undefined // No existing fileId for new files
    );

    if (!canWrite) {
      logger.info('[Files v1] Write permission denied', {
        projectId: targetProjectId,
        userId: user.id,
      });
      return forbidden('File write permission required. Please grant permission first.');
    }

    // Permission granted - proceed with write
    const contentBuffer = Buffer.from(content, 'utf-8');
    const sha256 = createHash('sha256').update(new Uint8Array(contentBuffer)).digest('hex');
    const fileId = repos.files['generateId']();

    // Sanitize filename (prevent path traversal)
    const sanitizedFilename = filename.replace(/[/\\:*?"<>|]/g, '_');

    logger.debug('[Files v1] Uploading file to storage', {
      fileId,
      filename: sanitizedFilename,
      size: contentBuffer.length,
      userId: user.id,
    });

    // Upload to file storage
    const { storageKey, mountPointId } = await fileStorageManager.uploadFile({
      userId: user.id,
      fileId,
      filename: sanitizedFilename,
      content: contentBuffer,
      contentType: mimeType,
      projectId: targetProjectId,
      folderPath,
    });

    logger.debug('[Files v1] File uploaded to storage', {
      fileId,
      storageKey,
      mountPointId,
    });

    // Create file metadata in repository
    const fileEntry = await repos.files.create({
      id: fileId,
      userId: user.id,
      originalFilename: sanitizedFilename,
      mimeType,
      size: contentBuffer.length,
      sha256,
      source: 'UPLOADED',
      category: 'FILE',
      storageKey,
      mountPointId,
      projectId: targetProjectId,
      folderPath,
      linkedTo: [],
      tags: [],
    });

    logger.info('[Files v1] File written successfully', {
      fileId,
      filename: sanitizedFilename,
      userId: user.id,
    });

    return successResponse(
      {
        data: {
          id: fileEntry.id,
          userId: fileEntry.userId,
          filename: fileEntry.originalFilename,
          filepath: getFilePath(fileEntry),
          mimeType: fileEntry.mimeType,
          size: fileEntry.size,
          category: fileEntry.category,
          projectId: fileEntry.projectId,
          folderPath: fileEntry.folderPath,
          createdAt: fileEntry.createdAt,
          updatedAt: fileEntry.updatedAt,
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Files v1] Error writing file', { userId: (request as any).user?.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to write file');
  }
}
