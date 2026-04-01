/**
 * Image utility functions for handling uploads, URL imports, and image processing
 * Version 2: Uses repository pattern for metadata storage and file storage manager for file storage
 */

import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import fetch from 'node-fetch';
import { getRepositories } from './repositories/factory';
import { fileStorageManager } from './file-storage/manager';
import type { FileEntry, FileSource, FileCategory } from './schemas/types';
import { logger } from './logger';
import { getInheritedTags, mergeTags } from './files/tag-inheritance';

export interface ImageUploadResult {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  url?: string;
  sha256: string;
}

/**
 * Allowed image MIME types
 */
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
];

/**
 * Maximum file size in bytes (10 MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Get image dimensions from buffer
 */
async function getImageDimensions(_buffer: Buffer, _mimeType: string): Promise<{ width?: number; height?: number }> {
  // For now, we'll return undefined dimensions
  // In a production app, you'd use a library like 'sharp' or 'image-size'
  // to extract actual image dimensions
  return { width: undefined, height: undefined };
}

/**
 * Get the file extension from an original filename
 */
function getExtension(filename: string): string {
  const ext = extname(filename);
  return ext || '.bin';
}

/**
 * Get the filepath for a file - always returns the API path for S3-backed files
 */
function getFileApiPath(fileId: string): string {
  return `/api/v1/files/${fileId}`;
}

interface CreateFileParams {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  source: FileSource;
  category: FileCategory;
  userId: string;
  linkedTo?: string[];
  tags?: string[];
  width?: number;
  height?: number;
  generationPrompt?: string;
  generationModel?: string;
  generationRevisedPrompt?: string;
  description?: string;
}

/**
 * Create a new file - stores bytes to S3 and metadata to repository
 */
async function createFile(params: CreateFileParams): Promise<FileEntry> {
  const {
    buffer,
    originalFilename,
    mimeType,
    source,
    category,
    userId,
    linkedTo = [],
    tags = [],
    width,
    height,
    generationPrompt,
    generationModel,
    generationRevisedPrompt,
    description,
  } = params;

  const repos = getRepositories();
  const sha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex');

  // Check for duplicate by hash
  const existingFiles = await repos.files.findBySha256(sha256);
  if (existingFiles.length > 0) {
    const existing = existingFiles[0];

    // Verify the actual file bytes still exist in storage before returning the cached entry
    let fileExists = false;
    try {
      fileExists = await fileStorageManager.fileExists(existing);
    } catch {
      logger.debug('File no longer exists in storage, will re-upload', { fileId: existing.id, storageKey: existing.storageKey });
    }

    if (fileExists) {
      // File already exists, just update the linkedTo array if needed
      const updatedLinkedTo = Array.from(new Set([...existing.linkedTo, ...linkedTo]));
      if (updatedLinkedTo.length > existing.linkedTo.length) {
        const updated = await repos.files.update(existing.id, { linkedTo: updatedLinkedTo });
        if (updated) {
          logger.debug('Updated existing file with new links', { fileId: existing.id, newLinks: linkedTo });
          return updated;
        }
      }
      logger.debug('File with same hash already exists', { fileId: existing.id, sha256 });
      return existing;
    } else {
      // File bytes are missing - delete the orphaned metadata and proceed with fresh upload
      logger.info('Cleaning up orphaned file metadata before re-upload', { fileId: existing.id, sha256 });
      await repos.files.delete(existing.id);
    }
  }

  // Generate a new file ID
  const fileId = crypto.randomUUID();

  // Upload to storage
  const { storageKey, mountPointId } = await fileStorageManager.uploadFile({
    userId,
    fileId,
    filename: originalFilename,
    content: buffer,
    contentType: mimeType,
    metadata: {
      category,
      filename: originalFilename,
      sha256,
    },
  });
  logger.debug('Uploaded file to storage', { fileId, storageKey, mountPointId, size: buffer.length });

  // Inherit tags from linked entities and merge with any explicitly provided tags
  const inheritedTags = await getInheritedTags(linkedTo, userId);
  const finalTags = mergeTags(tags, inheritedTags);

  logger.debug('Computed final tags for file', {
    context: 'images-v2',
    fileId,
    explicitTagCount: tags.length,
    inheritedTagCount: inheritedTags.length,
    finalTagCount: finalTags.length,
  });

  // Create metadata in repository
  // IMPORTANT: Pass the fileId to ensure metadata matches storage path
  const fileEntry = await repos.files.create({
    userId,
    sha256,
    originalFilename,
    mimeType,
    size: buffer.length,
    width: width || null,
    height: height || null,
    linkedTo,
    source,
    category,
    generationPrompt: generationPrompt || null,
    generationModel: generationModel || null,
    generationRevisedPrompt: generationRevisedPrompt || null,
    description: description || null,
    tags: finalTags,
    storageKey,
    mountPointId,
  }, { id: fileId });

  logger.debug('Created file metadata in repository', { fileId: fileEntry.id, storageKey, mountPointId });
  return fileEntry;
}

/**
 * Delete a file - removes bytes from storage and metadata from repository
 */
async function deleteFile(fileId: string): Promise<boolean> {
  const repos = getRepositories();
  const entry = await repos.files.findById(fileId);

  if (!entry) {
    logger.debug('File not found for deletion', { fileId });
    return false;
  }

  // Delete the file bytes from storage
  if (entry.storageKey) {
    try {
      await fileStorageManager.deleteFile(entry);
      logger.debug('Deleted file from storage', { fileId, storageKey: entry.storageKey });
    } catch (error) {
      logger.error('Failed to delete file from storage', { fileId, storageKey: entry.storageKey }, error instanceof Error ? error : undefined);
    }
  }

  // Delete metadata from repository
  const deleted = await repos.files.delete(fileId);
  logger.debug('Deleted file metadata from repository', { fileId, success: deleted });
  return deleted;
}

/**
 * Read a file as buffer from storage
 */
async function readFile(fileId: string): Promise<Buffer> {
  const repos = getRepositories();
  const entry = await repos.files.findById(fileId);

  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!entry.storageKey) {
    throw new Error(`File ${fileId} has no storage key - file may need migration`);
  }

  // Download from storage
  const buffer = await fileStorageManager.downloadFile(entry);
  logger.debug('Downloaded file from storage', { fileId, storageKey: entry.storageKey, size: buffer.length });
  return buffer;
}

/**
 * Find a file entry by ID
 */
async function findFileById(fileId: string): Promise<FileEntry | null> {
  const repos = getRepositories();
  return await repos.files.findById(fileId);
}

/**
 * Validate image file
 */
export function validateImageFile(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`Invalid file type. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`);
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB`);
  }
}

/**
 * Upload an image file to the server
 */
export async function uploadImage(file: File, userId: string, linkedTo: string[] = []): Promise<ImageUploadResult> {
  validateImageFile(file);

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Get image dimensions
  const dimensions = await getImageDimensions(buffer, file.type);

  // Create file entry
  const fileEntry = await createFile({
    buffer,
    originalFilename: file.name,
    mimeType: file.type,
    source: 'UPLOADED',
    category: 'IMAGE',
    userId,
    linkedTo,
    ...dimensions,
  });

  return {
    id: fileEntry.id,
    filename: fileEntry.originalFilename,
    filepath: getFileApiPath(fileEntry.id),
    mimeType: fileEntry.mimeType,
    size: fileEntry.size,
    width: fileEntry.width || undefined,
    height: fileEntry.height || undefined,
    sha256: fileEntry.sha256,
  };
}

/**
 * Import an image from a URL
 */
export async function importImageFromUrl(url: string, userId: string, linkedTo: string[] = []): Promise<ImageUploadResult> {
  // Fetch the image
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
    throw new Error(`Invalid image type from URL. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`);
  }

  // Get buffer
  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`Image size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB`);
  }

  // Get image dimensions
  const dimensions = await getImageDimensions(buffer, contentType);

  // Determine original filename from URL
  const urlPath = new URL(url).pathname;
  const urlFilename = urlPath.split('/').pop() || 'imported-image';
  const ext = contentType.split('/')[1] || 'jpg';
  const originalFilename = urlFilename.includes('.') ? urlFilename : `${urlFilename}.${ext}`;

  // Create file entry
  const fileEntry = await createFile({
    buffer,
    originalFilename,
    mimeType: contentType,
    source: 'IMPORTED',
    category: 'IMAGE',
    userId,
    linkedTo,
    description: `Imported from ${url}`,
    ...dimensions,
  });

  return {
    id: fileEntry.id,
    filename: fileEntry.originalFilename,
    filepath: getFileApiPath(fileEntry.id),
    mimeType: fileEntry.mimeType,
    size: fileEntry.size,
    width: fileEntry.width || undefined,
    height: fileEntry.height || undefined,
    url,
    sha256: fileEntry.sha256,
  };
}

/**
 * Delete an image file from the server
 */
export async function deleteImageById(fileId: string): Promise<void> {
  await deleteFile(fileId);
}

/**
 * Get image file entry by ID
 */
export async function getImageById(fileId: string): Promise<FileEntry | null> {
  return await findFileById(fileId);
}

/**
 * Read image file as buffer
 */
export async function readImageBuffer(fileId: string): Promise<Buffer> {
  return await readFile(fileId);
}

/**
 * Calculate SHA256 hash of buffer
 */
export function calculateSha256(buffer: Buffer): string {
  return createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
}
