import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { resolveEffectiveFolderPath, normalizeFolderPath, validateFolderPath } from '@/lib/files/folder-utils';
import { findAndPrepareOverwrite } from '@/lib/files/overwrite-utils';
import { logger } from '@/lib/logger';
import { MAX_THUMBNAIL_SIZE } from '@/lib/files/thumbnail-utils';
import type { FileCategory } from '@/lib/schemas/file.types';

export const FILE_POST_ACTIONS = [
  'write',
  'upload',
  'generate-thumbnails',
  'cleanup-orphaned',
  'sync',
] as const;

export type FilePostAction = typeof FILE_POST_ACTIONS[number];

export const writeFileSchema = z.object({
  filename: z.string().min(1).max(255),
  content: z.string().max(1024 * 1024),
  mimeType: z.string().prefault('text/plain'),
  projectId: z.uuid().nullable().optional(),
  folderPath: z.string().optional(),
});

export const MAX_BATCH_SIZE = 100;
export const THUMBNAIL_CONCURRENCY = 3;

export const generateThumbnailsSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(MAX_BATCH_SIZE),
  size: z.number().int().min(1).max(MAX_THUMBNAIL_SIZE).optional(),
});

export const cleanupOrphanedSchema = z.object({
  dryRun: z.boolean().optional().default(true),
});

export function formatValidationIssues(error: z.ZodError): string {
  return error.issues.map(issue => issue.message).join(', ');
}

export function serializeFileEntry(file: any) {
  return {
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
    folderPath: resolveEffectiveFolderPath(file.folderPath, file.storageKey),
    width: file.width,
    height: file.height,
    fileStatus: file.fileStatus || 'ok',
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export function normalizeAndValidateFolderPath(rawFolderPath?: string | null):
  | { success: true; folderPath: string }
  | { success: false; error: string } {
  const folderPath = normalizeFolderPath(rawFolderPath || '/');
  const validation = validateFolderPath(folderPath);

  if (!validation.isValid) {
    return {
      success: false,
      error: validation.error || 'Invalid folder path',
    };
  }

  return {
    success: true,
    folderPath,
  };
}

export function inferMimeType(filename: string, detectedMimeType?: string | null): string {
  if (detectedMimeType && detectedMimeType !== 'application/octet-stream') {
    return detectedMimeType;
  }

  const extension = sanitizeFilename(filename).toLowerCase().split('.').pop();
  const mimeMap: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    pdf: 'application/pdf',
    json: 'application/json',
    csv: 'text/csv',
  };

  return mimeMap[extension || ''] || 'application/octet-stream';
}

export async function ensureFileWritePermission(
  ctx: AuthenticatedContext,
  projectId: string | null
): Promise<boolean> {
  return ctx.repos.filePermissions.canWriteFile(ctx.user.id, projectId, undefined);
}

interface SaveFileEntryOptions {
  ctx: AuthenticatedContext;
  filename: string;
  contentBuffer: Buffer;
  mimeType: string;
  projectId: string | null;
  folderPath: string;
  category: FileCategory;
  linkedTo: string[];
  tags: string[];
  overwriteLogMessage: string;
  createLogMessage: string;
}

export async function saveFileEntry(options: SaveFileEntryOptions): Promise<{
  fileEntry: any;
  statusCode: number;
}> {
  const sanitizedFilename = sanitizeFilename(options.filename);
  const sha256 = createHash('sha256')
    .update(new Uint8Array(options.contentBuffer))
    .digest('hex');

  const overwrite = await findAndPrepareOverwrite(options.ctx.repos, {
    userId: options.ctx.user.id,
    projectId: options.projectId,
    folderPath: options.folderPath,
    filename: sanitizedFilename,
  });

  logger.debug('[Files v1] Persisting file entry', {
    filename: sanitizedFilename,
    overwrite: !!overwrite,
    projectId: options.projectId,
    folderPath: options.folderPath,
    userId: options.ctx.user.id,
  });

  const { storageKey } = await fileStorageManager.uploadFile({
    filename: sanitizedFilename,
    content: options.contentBuffer,
    contentType: options.mimeType,
    projectId: options.projectId,
    folderPath: options.folderPath,
  });

  const fileId = overwrite ? overwrite.fileId : randomUUID();

  if (overwrite) {
    const fileEntry = await options.ctx.repos.files.update(fileId, {
      sha256,
      mimeType: options.mimeType,
      size: options.contentBuffer.length,
      storageKey,
    });

    logger.info(options.overwriteLogMessage, {
      fileId,
      filename: sanitizedFilename,
      mimeType: options.mimeType,
      size: options.contentBuffer.length,
      userId: options.ctx.user.id,
    });

    return {
      fileEntry,
      statusCode: 200,
    };
  }

  const fileEntry = await options.ctx.repos.files.create({
    userId: options.ctx.user.id,
    originalFilename: sanitizedFilename,
    mimeType: options.mimeType,
    size: options.contentBuffer.length,
    sha256,
    source: 'UPLOADED',
    category: options.category,
    storageKey,
    projectId: options.projectId,
    folderPath: options.folderPath,
    linkedTo: options.linkedTo,
    tags: options.tags,
  }, { id: fileId });

  logger.info(options.createLogMessage, {
    fileId,
    filename: sanitizedFilename,
    mimeType: options.mimeType,
    size: options.contentBuffer.length,
    userId: options.ctx.user.id,
  });

  return {
    fileEntry,
    statusCode: 201,
  };
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[/\\:*?"<>|]/g, '_');
}