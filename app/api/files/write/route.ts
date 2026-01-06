/**
 * File Write API Route
 *
 * Handles LLM-initiated file writes with permission checking.
 * POST /api/files/write - Create a new file (requires write permission)
 */

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, forbidden, serverError } from '@/lib/api/responses';
import { s3FileService } from '@/lib/s3/file-service';
import { buildS3Key } from '@/lib/s3/client';
import { normalizeFolderPath, validateFolderPath } from '@/lib/files/folder-utils';

// Validation schema for file write
const writeFileSchema = z.object({
  filename: z.string().min(1).max(255),
  content: z.string().max(1024 * 1024), // Max 1MB content
  mimeType: z.string().default('text/plain'),
  projectId: z.string().uuid().nullable().optional(),
  folderPath: z.string().optional(),
});

/**
 * POST /api/files/write
 * Create a new file (requires write permission)
 */
export const POST = createAuthenticatedHandler(
  async (request, { user, repos }) => {
    const log = logger.child({
      module: 'api-files-write',
      userId: user.id,
    });

    try {
      const body = await request.json();
      const parsed = writeFileSchema.safeParse(body);

      if (!parsed.success) {
        log.debug('Invalid file write request', { errors: parsed.error.errors });
        return badRequest('Invalid request: ' + parsed.error.errors.map(e => e.message).join(', '));
      }

      const { filename, content, mimeType, projectId, folderPath: rawFolderPath } = parsed.data;
      const targetProjectId = projectId ?? null;
      const folderPath = normalizeFolderPath(rawFolderPath || '/');

      log.debug('Processing file write request', {
        filename,
        contentLength: content.length,
        mimeType,
        projectId: targetProjectId,
        folderPath,
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
        log.info('Write permission denied', {
          projectId: targetProjectId,
        });
        return forbidden('File write permission required. Please grant permission first.');
      }

      // Permission granted - proceed with write
      const contentBuffer = Buffer.from(content, 'utf-8');
      const sha256 = createHash('sha256').update(new Uint8Array(contentBuffer)).digest('hex');
      const fileId = repos.files['generateId']();

      // Sanitize filename (prevent path traversal)
      const sanitizedFilename = filename.replace(/[/\\:*?"<>|]/g, '_');

      // Upload to S3
      const s3Key = buildS3Key({
        userId: user.id,
        fileId,
        filename: sanitizedFilename,
        projectId: targetProjectId,
        folderPath,
      });

      log.debug('Uploading file to S3', {
        fileId,
        s3Key,
        size: contentBuffer.length,
      });

      await s3FileService.uploadUserFile(
        user.id,
        fileId,
        sanitizedFilename,
        'DOCUMENT',
        contentBuffer,
        mimeType
      );

      // Create file entry
      // IMPORTANT: Pass the fileId to ensure metadata matches S3 storage path
      const fileEntry = await repos.files.create({
        userId: user.id,
        sha256,
        originalFilename: sanitizedFilename,
        mimeType,
        size: contentBuffer.length,
        linkedTo: [],
        source: 'SYSTEM',
        category: 'DOCUMENT',
        generationPrompt: null,
        generationModel: null,
        generationRevisedPrompt: null,
        description: 'Created via LLM file management',
        tags: [],
        projectId: targetProjectId,
        folderPath,
        s3Key,
        s3Bucket: undefined,
      }, { id: fileId });

      log.info('File created successfully', {
        fileId: fileEntry.id,
        filename: sanitizedFilename,
        folderPath,
        projectId: targetProjectId,
      });

      return NextResponse.json({
        success: true,
        file: {
          id: fileEntry.id,
          filename: fileEntry.originalFilename,
          mimeType: fileEntry.mimeType,
          size: fileEntry.size,
          folderPath: fileEntry.folderPath,
          projectId: fileEntry.projectId,
          createdAt: fileEntry.createdAt,
        },
      });
    } catch (error) {
      log.error('Error writing file', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to write file');
    }
  }
);
