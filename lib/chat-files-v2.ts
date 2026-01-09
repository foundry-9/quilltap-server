/**
 * Chat file utility functions for handling file uploads in chat messages
 * Version 2: Uses repository pattern for metadata storage and centralized file storage manager
 */

import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { FileAttachment } from './llm/base';
import { getRepositories } from './repositories/factory';
import { fileStorageManager } from './file-storage/manager';
import { detectTextContent, getBestMimeType } from './files/text-detection';
import type { FileEntry, FileCategory, Provider } from './schemas/types';
import { logger } from '@/lib/logger';
import { getInheritedTags } from './files/tag-inheritance';
import { resizeImageForProvider, canResizeImage, calculateBase64Size, getProviderMaxBase64Size } from './files/image-processing';

export interface ChatFileUploadResult {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string;
  size: number;
  sha256: string;
  width?: number;
  height?: number;
}

/**
 * Result when a duplicate file is detected in project uploads
 */
export interface ChatFileDuplicateResult {
  duplicate: true;
  conflictType: 'filename' | 'content' | 'both';
  existingFile: {
    id: string;
    filename: string;
    size: number;
    createdAt: string;
    sha256: string;
  };
  newFile: {
    filename: string;
    size: number;
    sha256: string;
  };
}

/**
 * Resolution action for duplicate file conflicts
 */
export type ConflictResolution = 'replace' | 'keepBoth' | 'skip';

/**
 * Options for chat file upload
 */
export interface ChatFileUploadOptions {
  /** Message ID to link the file to */
  messageId?: string;
  /** Project ID if this chat belongs to a project */
  projectId?: string | null;
  /** Resolution action for duplicate conflicts */
  resolution?: ConflictResolution;
  /** ID of the conflicting file (for replace action) */
  conflictingFileId?: string;
}

/**
 * Maximum file size in bytes (10 MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Get the file extension from an original filename
 */
function getExtension(filename: string): string {
  const ext = extname(filename);
  return ext || '.bin';
}

/**
 * Generate a unique filename by appending (1), (2), etc.
 * @param filename - Original filename
 * @param existingFilenames - Set of filenames that already exist
 */
function generateUniqueFilename(
  filename: string,
  existingFilenames: Set<string>
): string {
  if (!existingFilenames.has(filename)) {
    return filename;
  }

  const ext = extname(filename);
  const basename = ext ? filename.slice(0, -ext.length) : filename;

  let counter = 1;
  let newName = `${basename} (${counter})${ext}`;

  while (existingFilenames.has(newName)) {
    counter++;
    newName = `${basename} (${counter})${ext}`;
  }

  return newName;
}

/**
 * Get the filepath for a file - always returns API path for S3-backed files
 */
function getFileApiPath(fileId: string): string {
  return `/api/files/${fileId}`;
}

/**
 * Validate chat file (size only - no type restrictions)
 */
export function validateChatFile(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB`
    );
  }
}

/**
 * Upload a chat file to the server
 * When projectId is provided, the file is stored as a project file with duplicate detection
 */
export async function uploadChatFile(
  file: File,
  chatId: string,
  userId: string,
  options: ChatFileUploadOptions = {}
): Promise<ChatFileUploadResult | ChatFileDuplicateResult> {
  const { messageId, projectId, resolution, conflictingFileId } = options;

  validateChatFile(file);

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const sha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex');

  // Detect text content and infer better MIME type if needed
  const textDetection = detectTextContent(buffer, file.name, file.type);
  const mimeType = getBestMimeType(textDetection, file.type);

  logger.debug('Text detection result for chat file', {
    context: 'chat-files-v2',
    filename: file.name,
    providedMimeType: file.type,
    detectedMimeType: textDetection.detectedMimeType,
    finalMimeType: mimeType,
    isPlainText: textDetection.isPlainText,
  });

  // Determine category based on MIME type
  const category: FileCategory = mimeType.startsWith('image/') ? 'IMAGE' : 'ATTACHMENT';

  // Build linkedTo array
  const linkedTo: string[] = [chatId];
  if (messageId) {
    linkedTo.push(messageId);
  }

  const repos = getRepositories();

  // For project files, check for duplicates within the project
  if (projectId) {
    logger.debug('Checking for duplicates in project', {
      context: 'chat-files-v2',
      projectId,
      filename: file.name,
      sha256,
    });

    // Check for content duplicate (same SHA256) in project
    const existingByHash = await repos.files.findBySha256(sha256);
    const contentDuplicate = existingByHash.find(f => f.projectId === projectId);

    // Check for filename duplicate in project
    const existingByName = await repos.files.findByFilenameInProject(userId, projectId, file.name);
    const filenameDuplicate = existingByName.length > 0 ? existingByName[0] : null;

    // Determine conflict type
    const hasContentConflict = !!contentDuplicate;
    const hasFilenameConflict = !!filenameDuplicate;

    if ((hasContentConflict || hasFilenameConflict) && !resolution) {
      // Duplicate detected and no resolution provided - return conflict info
      const conflictType: 'filename' | 'content' | 'both' =
        hasContentConflict && hasFilenameConflict ? 'both' :
        hasContentConflict ? 'content' : 'filename';

      // Use the more relevant duplicate for the response
      const existingFile = hasFilenameConflict ? filenameDuplicate! : contentDuplicate!;

      logger.debug('Duplicate file detected in project', {
        context: 'chat-files-v2',
        projectId,
        conflictType,
        existingFileId: existingFile.id,
      });

      return {
        duplicate: true,
        conflictType,
        existingFile: {
          id: existingFile.id,
          filename: existingFile.originalFilename,
          size: existingFile.size,
          createdAt: existingFile.createdAt,
          sha256: existingFile.sha256,
        },
        newFile: {
          filename: file.name,
          size: buffer.length,
          sha256,
        },
      };
    }

    // Handle resolution
    if (resolution) {
      logger.debug('Handling conflict resolution', {
        context: 'chat-files-v2',
        resolution,
        conflictingFileId,
      });

      if (resolution === 'skip') {
        // User chose to skip - return the existing file info
        const existingFile = conflictingFileId
          ? await repos.files.findById(conflictingFileId)
          : (filenameDuplicate || contentDuplicate);

        if (existingFile) {
          logger.debug('Skipping upload, returning existing file', {
            context: 'chat-files-v2',
            fileId: existingFile.id,
          });

          return {
            id: existingFile.id,
            filename: existingFile.originalFilename,
            filepath: getFileApiPath(existingFile.id),
            mimeType: existingFile.mimeType,
            size: existingFile.size,
            sha256: existingFile.sha256,
            width: existingFile.width || undefined,
            height: existingFile.height || undefined,
          };
        }
      }

      if (resolution === 'replace' && conflictingFileId) {
        // Delete the existing file first
        const existingFile = await repos.files.findById(conflictingFileId);
        if (existingFile) {
          try {
            await fileStorageManager.deleteFile(existingFile);
            logger.debug('Deleted existing file from storage for replacement', {
              context: 'chat-files-v2',
              fileId: conflictingFileId,
            });
          } catch (error) {
            logger.error('Failed to delete existing file from storage', {
              context: 'chat-files-v2',
              fileId: conflictingFileId,
            }, error instanceof Error ? error : undefined);
          }
        }
        await repos.files.delete(conflictingFileId);
        logger.debug('Deleted existing file for replacement', {
          context: 'chat-files-v2',
          fileId: conflictingFileId,
        });
      }

      // For 'keepBoth', generate a unique filename
      let finalFilename = file.name;
      if (resolution === 'keepBoth') {
        const projectFiles = await repos.files.findByProjectId(userId, projectId);
        const existingFilenames = new Set(projectFiles.map(f => f.originalFilename));
        finalFilename = generateUniqueFilename(file.name, existingFilenames);
        logger.debug('Generated unique filename for keepBoth', {
          context: 'chat-files-v2',
          originalFilename: file.name,
          newFilename: finalFilename,
        });
      }

      // Proceed with upload using the final filename
      return await uploadFileToProject(
        buffer,
        finalFilename,
        mimeType,
        sha256,
        category,
        userId,
        projectId,
        linkedTo,
        textDetection.isPlainText
      );
    }
  }

  // Non-project files: use existing behavior with hash-based deduplication
  const existingFiles = await repos.files.findBySha256(sha256);
  if (existingFiles.length > 0) {
    const existing = existingFiles[0];
    // File already exists, just update the linkedTo array if needed
    const updatedLinkedTo = Array.from(new Set([...existing.linkedTo, ...linkedTo]));
    if (updatedLinkedTo.length > existing.linkedTo.length) {
      const updated = await repos.files.update(existing.id, { linkedTo: updatedLinkedTo });
      if (updated) {
        logger.debug('Updated existing chat file with new links', { fileId: existing.id, newLinks: linkedTo });
        return {
          id: updated.id,
          filename: updated.originalFilename,
          filepath: getFileApiPath(updated.id),
          mimeType: updated.mimeType,
          size: updated.size,
          sha256: updated.sha256,
          width: updated.width || undefined,
          height: updated.height || undefined,
        };
      }
    }
    logger.debug('Chat file with same hash already exists', { fileId: existing.id, sha256 });
    return {
      id: existing.id,
      filename: existing.originalFilename,
      filepath: getFileApiPath(existing.id),
      mimeType: existing.mimeType,
      size: existing.size,
      sha256: existing.sha256,
      width: existing.width || undefined,
      height: existing.height || undefined,
    };
  }

  // No project - upload as before (general file)
  return await uploadFileToProject(
    buffer,
    file.name,
    mimeType,
    sha256,
    category,
    userId,
    projectId || undefined,
    linkedTo,
    textDetection.isPlainText
  );
}

/**
 * Internal helper to upload file to S3 and create repository entry
 */
async function uploadFileToProject(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  sha256: string,
  category: FileCategory,
  userId: string,
  projectId: string | undefined,
  linkedTo: string[],
  isPlainText?: boolean
): Promise<ChatFileUploadResult> {
  const repos = getRepositories();

  // Generate a new file ID
  const fileId = crypto.randomUUID();

  // Upload to file storage
  const { storageKey, mountPointId } = await fileStorageManager.uploadFile({
    userId,
    fileId,
    filename,
    content: buffer,
    contentType: mimeType,
    projectId: projectId || null,
    folderPath: '/',
    metadata: {
      category,
      sha256,
    },
  });
  logger.debug('Uploaded chat file to storage', { fileId, storageKey, mountPointId, size: buffer.length, projectId });

  // Inherit tags from the chat (and any other linked entities)
  const inheritedTags = await getInheritedTags(linkedTo, userId);

  logger.debug('Inherited tags for chat file', {
    context: 'chat-files-v2',
    fileId,
    inheritedTagCount: inheritedTags.length,
  });

  // Create metadata in repository
  // IMPORTANT: Pass the fileId to ensure metadata matches storage path
  const fileEntry = await repos.files.create({
    userId,
    sha256,
    originalFilename: filename,
    mimeType,
    size: buffer.length,
    width: null,
    height: null,
    isPlainText,
    linkedTo,
    source: 'UPLOADED',
    category,
    generationPrompt: null,
    generationModel: null,
    generationRevisedPrompt: null,
    description: null,
    tags: inheritedTags,
    projectId: projectId || null,
    folderPath: '/',
    storageKey,
    mountPointId,
  }, { id: fileId });

  logger.debug('Created chat file metadata in repository', { fileId: fileEntry.id, storageKey, mountPointId, projectId });

  return {
    id: fileEntry.id,
    filename: fileEntry.originalFilename,
    filepath: getFileApiPath(fileEntry.id),
    mimeType: fileEntry.mimeType,
    size: fileEntry.size,
    sha256: fileEntry.sha256,
    width: fileEntry.width || undefined,
    height: fileEntry.height || undefined,
  };
}

/**
 * Options for loading chat files for LLM
 */
export interface LoadChatFilesOptions {
  /** The provider being used (for size limit calculation) */
  provider?: Provider
  /** Whether to automatically resize images that exceed limits (default: true) */
  autoResize?: boolean
}

/**
 * Read a file as base64 from S3, optionally resizing images for provider limits
 */
async function readFileAsBase64(
  fileId: string,
  mimeType: string,
  provider?: Provider
): Promise<{ data: string; wasResized?: boolean; mimeType: string }> {
  const repos = getRepositories();
  const entry = await repos.files.findById(fileId);

  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!entry.storageKey) {
    throw new Error(`File ${fileId} has no storage key - file may need migration`);
  }

  // Download from file storage
  let buffer = await fileStorageManager.downloadFile(entry);
  let outputMimeType = mimeType;
  let wasResized = false;

  logger.debug('Downloaded file from storage for base64', { fileId, storageKey: entry.storageKey, size: buffer.length });

  // Check if this is an image that might need resizing
  if (provider && mimeType.startsWith('image/') && canResizeImage(mimeType)) {
    const maxBase64Size = getProviderMaxBase64Size(provider);
    const base64Size = calculateBase64Size(buffer);

    if (base64Size > maxBase64Size) {
      logger.info('Image exceeds provider limits, attempting resize', {
        module: 'chat-files-v2',
        fileId,
        originalSize: buffer.length,
        base64Size,
        maxBase64Size,
        provider,
      });

      const resizeResult = await resizeImageForProvider({
        provider,
        buffer,
        mimeType,
        filename: entry.originalFilename,
      });

      if (resizeResult.wasResized) {
        buffer = resizeResult.buffer;
        outputMimeType = resizeResult.mimeType;
        wasResized = true;

        logger.info('Image resized successfully', {
          module: 'chat-files-v2',
          fileId,
          originalSize: resizeResult.originalSize,
          finalSize: resizeResult.finalSize,
          dimensions: resizeResult.width && resizeResult.height
            ? `${resizeResult.width}x${resizeResult.height}`
            : 'unknown',
        });
      }
    }
  }

  return {
    data: buffer.toString('base64'),
    wasResized,
    mimeType: outputMimeType,
  };
}

/**
 * Convert file entries to FileAttachment format for LLM
 * Loads file data as base64, optionally resizing images for provider limits
 */
export async function loadChatFilesForLLM(
  fileIds: string[],
  options: LoadChatFilesOptions = {}
): Promise<FileAttachment[]> {
  const { provider, autoResize = true } = options;

  logger.debug('Loading chat files for LLM', { fileIds, provider, autoResize });
  const attachments: FileAttachment[] = [];
  const repos = getRepositories();

  for (const fileId of fileIds) {
    try {
      const fileEntry = await repos.files.findById(fileId);
      if (!fileEntry) {
        logger.error(`File not found: ${fileId}`, { fileId });
        continue;
      }

      // Read file with potential resizing
      const { data, wasResized, mimeType } = await readFileAsBase64(
        fileId,
        fileEntry.mimeType,
        autoResize ? provider : undefined
      );

      attachments.push({
        id: fileEntry.id,
        filepath: getFileApiPath(fileEntry.id),
        filename: fileEntry.originalFilename,
        mimeType, // Use potentially updated MIME type
        size: fileEntry.size,
        data,
      });

      logger.debug('Loaded chat file', {
        fileId: fileEntry.id,
        filename: fileEntry.originalFilename,
        mimeType,
        originalMimeType: fileEntry.mimeType,
        size: fileEntry.size,
        dataLength: data?.length || 0,
        wasResized,
      });
    } catch (error) {
      logger.error(`Failed to load chat file ${fileId}:`, {}, error instanceof Error ? error : new Error(String(error)));
      // Skip files that can't be loaded
    }
  }

  logger.debug('Loaded chat files for LLM', { count: attachments.length });
  return attachments;
}

/**
 * Delete a chat file from S3 and repository
 */
export async function deleteChatFileById(fileId: string): Promise<void> {
  const repos = getRepositories();
  const entry = await repos.files.findById(fileId);

  if (!entry) {
    logger.debug('Chat file not found for deletion', { fileId });
    return;
  }

  // Delete the file bytes from storage
  try {
    await fileStorageManager.deleteFile(entry);
    logger.debug('Deleted chat file from storage', { fileId, storageKey: entry.storageKey });
  } catch (error) {
    logger.error('Failed to delete chat file from storage', { fileId, storageKey: entry.storageKey }, error instanceof Error ? error : undefined);
  }

  // Delete metadata from repository
  await repos.files.delete(fileId);
  logger.debug('Deleted chat file metadata from repository', { fileId });
}

/**
 * Get chat file entry by ID
 */
export async function getChatFileById(fileId: string): Promise<FileEntry | null> {
  const repos = getRepositories();
  return await repos.files.findById(fileId);
}

/**
 * Read chat file as buffer from S3
 */
export async function readChatFileBuffer(fileId: string): Promise<Buffer> {
  const repos = getRepositories();
  const entry = await repos.files.findById(fileId);

  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!entry.storageKey) {
    throw new Error(`File ${fileId} has no storage key - file may need migration`);
  }

  // Download from file storage
  const buffer = await fileStorageManager.downloadFile(entry);
  logger.debug('Downloaded chat file from storage', { fileId, storageKey: entry.storageKey, size: buffer.length });
  return buffer;
}

/**
 * Get supported MIME types for chat file uploads
 * @deprecated All file types are now supported. This function returns an empty array.
 */
export function getSupportedMimeTypes(): string[] {
  // All file types are now supported - no restrictions
  return [];
}
