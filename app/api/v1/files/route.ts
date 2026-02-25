/**
 * Files API v1 - Collection Endpoint
 *
 * GET /api/v1/files - List files (filter by projectId, folderPath, or filter=general)
 * POST /api/v1/files?action=write - Write/create a file from text content
 * POST /api/v1/files?action=upload - Upload a file (multipart/form-data)
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
import {
  DEFAULT_THUMBNAIL_SIZE,
  MAX_THUMBNAIL_SIZE,
  canGenerateThumbnail,
  generateThumbnail,
  cleanupThumbnails,
} from '@/lib/files/thumbnail-utils';
import { findAndPrepareOverwrite } from '@/lib/files/overwrite-utils';

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

  // Handle upload action
  if (action === 'upload') {
    return handleUploadFile(request, user, repos);
  }

  // Handle batch thumbnail generation
  if (action === 'generate-thumbnails') {
    return handleGenerateThumbnails(request, user, repos);
  }

  // Handle cleanup of orphaned DB records (missing backing files)
  if (action === 'cleanup-orphaned') {
    return handleCleanupOrphaned(request, user, repos);
  }

  return badRequest(`Unknown action: ${action}. Available actions: write, upload, generate-thumbnails, cleanup-orphaned`);
});

// ============================================================================
// Helper: Write File
// ============================================================================

async function handleWriteFile(request: NextRequest, user: any, repos: any): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = writeFileSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest('Invalid request: ' + parsed.error.issues.map((e: any) => e.message).join(', '));
    }

    const { filename, content, mimeType, projectId, folderPath: rawFolderPath } = parsed.data;
    const targetProjectId = projectId ?? null;
    const folderPath = normalizeFolderPath(rawFolderPath || '/');// Validate folder path
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

    // Sanitize filename (prevent path traversal)
    const sanitizedFilename = filename.replace(/[/\\:*?"<>|]/g, '_');

    // Check for existing file with same name in same scope
    const overwrite = await findAndPrepareOverwrite(repos, {
      userId: user.id,
      projectId: targetProjectId,
      folderPath,
      filename: sanitizedFilename,
    });

    const fileId = overwrite ? overwrite.fileId : repos.files['generateId']();

    // Upload to file storage
    const { storageKey } = await fileStorageManager.uploadFile({
      userId: user.id,
      fileId,
      filename: sanitizedFilename,
      content: contentBuffer,
      contentType: mimeType,
      projectId: targetProjectId,
      folderPath,
    });

    let fileEntry;
    if (overwrite) {
      // Update existing file entry, preserving the original ID
      fileEntry = await repos.files.update(fileId, {
        sha256,
        mimeType,
        size: contentBuffer.length,
        storageKey,
      });

      logger.info('[Files v1] File overwritten successfully', {
        fileId,
        filename: sanitizedFilename,
        userId: user.id,
      });
    } else {
      // Create new file metadata in repository
      fileEntry = await repos.files.create({
        id: fileId,
        userId: user.id,
        originalFilename: sanitizedFilename,
        mimeType,
        size: contentBuffer.length,
        sha256,
        source: 'UPLOADED',
        category: 'FILE',
        storageKey,
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
    }

    return successResponse(
      {
        data: {
          id: fileEntry!.id,
          userId: fileEntry!.userId,
          filename: fileEntry!.originalFilename,
          filepath: getFilePath(fileEntry!),
          mimeType: fileEntry!.mimeType,
          size: fileEntry!.size,
          category: fileEntry!.category,
          projectId: fileEntry!.projectId,
          folderPath: fileEntry!.folderPath,
          createdAt: fileEntry!.createdAt,
          updatedAt: fileEntry!.updatedAt,
        },
      },
      overwrite ? 200 : 201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Files v1] Error writing file', { userId: (request as any).user?.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to write file');
  }
}

// ============================================================================
// Helper: Upload File (multipart/form-data)
// ============================================================================

async function handleUploadFile(request: NextRequest, user: any, repos: any): Promise<NextResponse> {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (!contentType.includes('multipart/form-data')) {
      return badRequest('Expected multipart/form-data content type');
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const tagsJson = formData.get('tags') as string | null;
    const projectId = formData.get('projectId') as string | null;
    const rawFolderPath = formData.get('folderPath') as string | null;

    if (!file) {
      return badRequest('No file provided');
    }

    const folderPath = normalizeFolderPath(rawFolderPath || '/');

    // Validate folder path
    const folderValidation = validateFolderPath(folderPath);
    if (!folderValidation.isValid) {
      return badRequest(folderValidation.error || 'Invalid folder path');
    }

    // Parse tags if provided
    let tags: Array<{ tagType: string; tagId: string }> | undefined;
    if (tagsJson) {
      try {
        tags = JSON.parse(tagsJson);
      } catch {
        return badRequest('Invalid tags JSON');
      }
    }

    // Get file content as buffer
    const arrayBuffer = await file.arrayBuffer();
    const contentBuffer = Buffer.from(arrayBuffer);
    const sha256 = createHash('sha256').update(new Uint8Array(contentBuffer)).digest('hex');

    // Sanitize filename
    const sanitizedFilename = file.name.replace(/[/\\:*?"<>|]/g, '_');

    // Determine MIME type (prefer browser-provided, fallback to extension-based)
    let mimeType = file.type || 'application/octet-stream';
    if (mimeType === 'application/octet-stream') {
      // Try to determine from extension
      const ext = sanitizedFilename.toLowerCase().split('.').pop();
      const mimeMap: Record<string, string> = {
        'txt': 'text/plain',
        'md': 'text/markdown',
        'markdown': 'text/markdown',
        'pdf': 'application/pdf',
        'json': 'application/json',
        'csv': 'text/csv',
      };
      mimeType = mimeMap[ext || ''] || 'application/octet-stream';
    }

    const targetProjectId = projectId || null;

    // Check for existing file with same name in same scope
    const overwrite = await findAndPrepareOverwrite(repos, {
      userId: user.id,
      projectId: targetProjectId,
      folderPath,
      filename: sanitizedFilename,
    });

    const fileId = overwrite ? overwrite.fileId : repos.files['generateId']();

    // Upload to file storage
    const { storageKey } = await fileStorageManager.uploadFile({
      userId: user.id,
      fileId,
      filename: sanitizedFilename,
      content: contentBuffer,
      contentType: mimeType,
      projectId: targetProjectId,
      folderPath,
    });

    // Build linkedTo array from tags
    const linkedTo = tags ? tags.map(t => t.tagId) : [];

    let fileEntry;
    if (overwrite) {
      // Update existing file entry, preserving the original ID
      fileEntry = await repos.files.update(fileId, {
        sha256,
        mimeType,
        size: contentBuffer.length,
        storageKey,
      });

      logger.info('[Files v1] File upload overwritten existing file', {
        fileId,
        filename: sanitizedFilename,
        mimeType,
        size: contentBuffer.length,
        userId: user.id,
      });
    } else {
      // Create new file metadata in repository
      fileEntry = await repos.files.create({
        id: fileId,
        userId: user.id,
        originalFilename: sanitizedFilename,
        mimeType,
        size: contentBuffer.length,
        sha256,
        source: 'UPLOADED',
        category: 'DOCUMENT',
        storageKey,
        projectId: targetProjectId,
        folderPath,
        linkedTo,
        tags: linkedTo,
      });

      logger.info('[Files v1] File uploaded successfully', {
        fileId,
        filename: sanitizedFilename,
        mimeType,
        size: contentBuffer.length,
        userId: user.id,
      });
    }

    return successResponse(
      {
        data: {
          id: fileEntry!.id,
          userId: fileEntry!.userId,
          filename: fileEntry!.originalFilename,
          filepath: getFilePath(fileEntry!),
          mimeType: fileEntry!.mimeType,
          size: fileEntry!.size,
          category: fileEntry!.category,
          projectId: fileEntry!.projectId,
          folderPath: fileEntry!.folderPath,
          createdAt: fileEntry!.createdAt,
          updatedAt: fileEntry!.updatedAt,
        },
      },
      overwrite ? 200 : 201
    );
  } catch (error) {
    logger.error('[Files v1] Error uploading file', { userId: user?.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to upload file');
  }
}

// ============================================================================
// Helper: Generate Thumbnails (batch)
// ============================================================================

const MAX_BATCH_SIZE = 100;
const THUMBNAIL_CONCURRENCY = 3;

const generateThumbnailsSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(MAX_BATCH_SIZE),
  size: z.number().int().min(1).max(MAX_THUMBNAIL_SIZE).optional(),
});

async function handleGenerateThumbnails(
  request: NextRequest,
  user: any,
  repos: any
): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = generateThumbnailsSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest('Invalid request: ' + parsed.error.issues.map((e: any) => e.message).join(', '));
    }

    const { fileIds, size } = parsed.data;
    const thumbnailSize = size ?? DEFAULT_THUMBNAIL_SIZE;

    logger.debug('[Files v1] Batch thumbnail generation requested', {
      count: fileIds.length,
      size: thumbnailSize,
      userId: user.id,
    });

    // Fetch all requested file entries
    const fileEntries = await Promise.all(
      fileIds.map((id: string) => repos.files.findById(id))
    );

    // Filter to owned, resizable images
    const validEntries = fileEntries.filter(
      (entry: any) => entry && entry.userId === user.id && canGenerateThumbnail(entry.mimeType)
    );

    // Process with bounded concurrency
    let generated = 0;
    let cached = 0;
    let errors = 0;

    const processQueue = [...validEntries];

    async function processNext(): Promise<void> {
      while (processQueue.length > 0) {
        const entry = processQueue.shift();
        if (!entry) break;

        try {
          const result = await generateThumbnail(entry, thumbnailSize);
          if (result.fromCache) {
            cached++;
          } else {
            generated++;
          }
        } catch (error) {
          errors++;
          logger.warn('[Files v1] Batch thumbnail generation failed for file', {
            fileId: entry.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // Launch concurrent workers
    const workers = Array.from({ length: THUMBNAIL_CONCURRENCY }, () => processNext());
    await Promise.all(workers);

    logger.info('[Files v1] Batch thumbnail generation complete', {
      total: validEntries.length,
      generated,
      cached,
      errors,
      userId: user.id,
    });

    return successResponse({
      total: validEntries.length,
      generated,
      cached,
      errors,
    });
  } catch (error) {
    logger.error('[Files v1] Error in batch thumbnail generation', {
      userId: user?.id,
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to generate thumbnails');
  }
}

// ============================================================================
// Helper: Cleanup Orphaned Records (DB records with missing backing files)
// ============================================================================

const cleanupOrphanedSchema = z.object({
  dryRun: z.boolean().optional().default(true),
});

async function handleCleanupOrphaned(
  request: NextRequest,
  user: any,
  repos: any
): Promise<NextResponse> {
  try {
    let dryRun = true;
    try {
      const body = await request.json();
      const parsed = cleanupOrphanedSchema.safeParse(body);
      if (parsed.success) {
        dryRun = parsed.data.dryRun;
      }
    } catch {
      // Empty body or invalid JSON — default to dryRun: true
    }

    logger.info('[Files v1] Cleanup orphaned records requested', {
      userId: user.id,
      dryRun,
    });

    // Get all files for this user
    const allFiles = await repos.files.findByUserId(user.id);

    // Scan for stale records (DB records with no backing file on disk)
    const staleRecords: Array<{ id: string; originalFilename: string }> = [];
    const errors: string[] = [];

    for (const file of allFiles) {
      try {
        if (file.storageKey) {
          const exists = await fileStorageManager.fileExists(file.storageKey);
          if (!exists) {
            staleRecords.push({ id: file.id, originalFilename: file.originalFilename });
          }
        }
      } catch (error) {
        errors.push(`Error checking file ${file.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let deleted = 0;

    if (!dryRun && staleRecords.length > 0) {
      for (const stale of staleRecords) {
        try {
          const entry = allFiles.find((f: { id: string }) => f.id === stale.id);
          if (entry && canGenerateThumbnail(entry.mimeType)) {
            await cleanupThumbnails(entry);
          }

          await repos.files.delete(stale.id);
          deleted++;

          logger.debug('[Files v1] Deleted stale file record', {
            fileId: stale.id,
            filename: stale.originalFilename,
          });
        } catch (error) {
          logger.error('[Files v1] Failed to delete stale record', {
            fileId: stale.id,
          }, error instanceof Error ? error : undefined);
        }
      }

      logger.info('[Files v1] Cleanup orphaned records complete', {
        userId: user.id,
        total: allFiles.length,
        stale: staleRecords.length,
        deleted,
      });
    }

    return successResponse({
      total: allFiles.length,
      stale: staleRecords.length,
      deleted,
      dryRun,
      staleFiles: staleRecords.map((r: { id: string; originalFilename: string }) => ({
        id: r.id,
        filename: r.originalFilename,
      })),
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error('[Files v1] Error cleaning up orphaned records', {
      userId: user?.id,
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to cleanup orphaned records');
  }
}
