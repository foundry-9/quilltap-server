/**
 * File Management Tool Handler
 *
 * Executes file management tool calls during chat.
 * Provides file listing, reading, writing (with permissions), and organization.
 *
 * @module tools/handlers/file-management-handler
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { extractFileContent } from '@/lib/services/file-content-extractor';
import { s3FileService } from '@/lib/s3/file-service';
import { buildS3Key } from '@/lib/s3/client';
import { normalizeFolderPath, validateFolderPath, getFolderName, getFolderDepth } from '@/lib/files/folder-utils';
import { FileEntry } from '@/lib/schemas/file.types';
import {
  FileManagementToolInput,
  FileManagementToolOutput,
  FileListResult,
  FolderListResult,
  FileReadResult,
  FileWriteResult,
  FolderCreateResult,
  AttachmentPromoteResult,
  FileInfo,
  FolderInfo,
  FileScope,
  validateFileManagementInput,
} from '../file-management-tool';
import { createHash } from 'crypto';

/**
 * Context required for file management execution
 */
export interface FileManagementToolContext {
  /** User ID for authentication */
  userId: string;
  /** Chat ID for context */
  chatId: string;
  /** Project ID if chat is in a project (null for non-project chats) */
  projectId: string | null;
  /** Character IDs for character image lookups */
  characterIds?: string[];
}

/**
 * Error thrown during file management execution
 */
export class FileManagementError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'ACCESS_DENIED' | 'PERMISSION_REQUIRED' | 'EXECUTION_ERROR'
  ) {
    super(message);
    this.name = 'FileManagementError';
  }
}

/**
 * Convert FileEntry to FileInfo for output
 */
function toFileInfo(file: FileEntry): FileInfo {
  return {
    id: file.id,
    filename: file.originalFilename,
    mimeType: file.mimeType,
    size: file.size,
    category: file.category,
    folderPath: file.folderPath || '/',
    description: file.description,
    createdAt: file.createdAt,
  };
}

/**
 * Execute list_files action
 */
async function executeListFiles(
  context: FileManagementToolContext,
  input: FileManagementToolInput
): Promise<FileListResult | null> {
  const repos = getRepositories();
  const scope = input.scope || 'project';
  const folderPath = normalizeFolderPath(input.folderPath || '/');
  const recursive = input.recursive !== false; // Default to true
  const limit = Math.min(input.limit || 20, 100);

  logger.debug('Executing list_files', {
    context: 'file-management-handler',
    scope,
    folderPath,
    recursive,
    limit,
    projectId: context.projectId,
  });

  let files: FileEntry[] = [];

  switch (scope) {
    case 'project': {
      if (!context.projectId) {
        // If no project, list general files instead
        files = await repos.files.findGeneralFiles(context.userId);
      } else {
        files = await repos.files.findByProjectId(context.userId, context.projectId);
      }
      break;
    }

    case 'general': {
      files = await repos.files.findGeneralFiles(context.userId);
      break;
    }

    case 'character': {
      const characterId = input.characterId;
      if (!characterId) {
        return null;
      }

      // Get character to verify ownership and get tags
      const character = await repos.characters.findById(characterId);
      if (!character || character.userId !== context.userId) {
        return null;
      }

      // Find files linked to character OR tagged with character's tags
      const allUserFiles = await repos.files.findByUserId(context.userId);
      files = allUserFiles.filter(f => {
        // Check if linked to character
        if (f.linkedTo?.includes(characterId)) {
          return true;
        }
        // Check if has any of character's tags
        if (character.tags && f.tags) {
          for (const tag of character.tags) {
            if (f.tags.includes(tag)) {
              return true;
            }
          }
        }
        return false;
      });

      // Only images for character scope
      files = files.filter(f => f.category === 'IMAGE');
      break;
    }
  }

  // Filter by folder path
  if (folderPath !== '/') {
    if (recursive) {
      files = files.filter(f => (f.folderPath || '/').startsWith(folderPath));
    } else {
      files = files.filter(f => (f.folderPath || '/') === folderPath);
    }
  }

  // Sort by creation date (newest first)
  files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Apply limit
  const total = files.length;
  files = files.slice(0, limit);

  return {
    files: files.map(toFileInfo),
    total,
    scope,
    folderPath,
  };
}

/**
 * Execute list_folders action
 */
async function executeListFolders(
  context: FileManagementToolContext,
  input: FileManagementToolInput
): Promise<FolderListResult | null> {
  const repos = getRepositories();
  const scope = (input.scope === 'project' || input.scope === 'general') ? input.scope : 'project';

  logger.debug('Executing list_folders', {
    context: 'file-management-handler',
    scope,
    projectId: context.projectId,
  });

  let projectId: string | null;
  if (scope === 'project') {
    projectId = context.projectId;
  } else {
    projectId = null;
  }

  // Get unique folder paths
  const folderPaths = await repos.files.listFolders(context.userId, projectId);

  // Get files to count per folder
  let files: FileEntry[];
  if (projectId) {
    files = await repos.files.findByProjectId(context.userId, projectId);
  } else {
    files = await repos.files.findGeneralFiles(context.userId);
  }

  // Build folder info with counts
  const folders: FolderInfo[] = folderPaths.map(path => {
    const fileCount = files.filter(f => (f.folderPath || '/') === path).length;
    return {
      path,
      name: getFolderName(path) || 'Root',
      depth: getFolderDepth(path),
      fileCount,
    };
  });

  return {
    folders,
    total: folders.length,
    scope,
  };
}

/**
 * Execute read_file action
 */
async function executeReadFile(
  context: FileManagementToolContext,
  fileId: string
): Promise<FileReadResult | null> {
  const repos = getRepositories();

  logger.debug('Executing read_file', {
    context: 'file-management-handler',
    fileId,
    projectId: context.projectId,
  });

  // Get file
  const file = await repos.files.findById(fileId);
  if (!file || file.userId !== context.userId) {
    return null;
  }

  // Check access: file must be in current project OR be a general file
  if (file.projectId) {
    // File is in a project - must match current project
    if (file.projectId !== context.projectId) {
      logger.warn('Access denied: file is in different project', {
        context: 'file-management-handler',
        fileId,
        fileProjectId: file.projectId,
        chatProjectId: context.projectId,
      });
      return null;
    }
  }
  // If file.projectId is null, it's a general file - always accessible

  // Extract content
  const extracted = await extractFileContent(file);

  if (!extracted.success) {
    throw new FileManagementError(
      extracted.error || 'Failed to extract file content',
      'EXECUTION_ERROR'
    );
  }

  return {
    fileId: file.id,
    filename: file.originalFilename,
    mimeType: file.mimeType,
    content: extracted.content || '',
    contentType: extracted.contentType === 'error' ? 'text' : extracted.contentType,
    language: extracted.language,
    truncated: extracted.truncated,
  };
}

/**
 * Execute write_file action
 */
async function executeWriteFile(
  context: FileManagementToolContext,
  input: FileManagementToolInput
): Promise<FileWriteResult> {
  const repos = getRepositories();
  const filename = input.filename!;
  const content = input.content!;
  const mimeType = input.mimeType || 'text/plain';
  const targetFolderPath = normalizeFolderPath(input.targetFolderPath || '/');

  logger.debug('Executing write_file', {
    context: 'file-management-handler',
    filename,
    contentLength: content.length,
    mimeType,
    targetFolderPath,
    projectId: context.projectId,
  });

  // Validate folder path
  const folderValidation = validateFolderPath(targetFolderPath);
  if (!folderValidation.isValid) {
    return {
      success: false,
      message: folderValidation.error,
    };
  }

  // Check file write permission
  const canWrite = await repos.filePermissions.canWriteFile(
    context.userId,
    context.projectId,
    undefined // No existing fileId for new files
  );

  if (!canWrite) {
    logger.info('Write permission required', {
      context: 'file-management-handler',
      userId: context.userId,
      projectId: context.projectId,
    });

    return {
      success: false,
      requiresPermission: true,
      filename,
      folderPath: targetFolderPath,
      message: 'File write permission is required. Please approve this write request.',
    };
  }

  // Permission granted - proceed with write
  const contentBuffer = Buffer.from(content, 'utf-8');
  const sha256 = createHash('sha256').update(new Uint8Array(contentBuffer)).digest('hex');
  const fileId = repos.files['generateId'](); // Access protected method

  // Upload to S3
  const s3Key = buildS3Key(context.userId, fileId, filename, 'DOCUMENT');
  await s3FileService.uploadUserFile(
    context.userId,
    fileId,
    filename,
    'DOCUMENT',
    contentBuffer,
    mimeType
  );

  // Create file entry
  // IMPORTANT: Pass the fileId to ensure metadata matches S3 storage path
  const fileEntry = await repos.files.create({
    userId: context.userId,
    sha256,
    originalFilename: filename,
    mimeType,
    size: contentBuffer.length,
    linkedTo: [],
    source: 'SYSTEM',
    category: 'DOCUMENT',
    generationPrompt: null,
    generationModel: null,
    generationRevisedPrompt: null,
    description: 'Created by LLM file management tool',
    tags: [],
    projectId: context.projectId,
    folderPath: targetFolderPath,
    s3Key,
    s3Bucket: undefined, // Will use default bucket
  }, { id: fileId });

  logger.info('File created successfully', {
    context: 'file-management-handler',
    fileId: fileEntry.id,
    filename,
    folderPath: targetFolderPath,
  });

  return {
    success: true,
    fileId: fileEntry.id,
    filename: fileEntry.originalFilename,
    folderPath: targetFolderPath,
    message: 'File created successfully.',
  };
}

/**
 * Execute create_folder action
 */
async function executeCreateFolder(
  context: FileManagementToolContext,
  newFolderPath: string
): Promise<FolderCreateResult> {
  logger.debug('Executing create_folder', {
    context: 'file-management-handler',
    newFolderPath,
  });

  // Normalize and validate path
  const normalizedPath = normalizeFolderPath(newFolderPath);
  const validation = validateFolderPath(normalizedPath);

  if (!validation.isValid) {
    return {
      success: false,
      folderPath: newFolderPath,
      message: validation.error,
    };
  }

  // Folders are implicit - they exist when files are in them
  // Just return success with the normalized path
  logger.info('Folder created/validated', {
    context: 'file-management-handler',
    folderPath: normalizedPath,
  });

  return {
    success: true,
    folderPath: normalizedPath,
    message: `Folder "${normalizedPath}" is ready. Files written to this path will be stored in this folder.`,
  };
}

/**
 * Execute promote_attachment action
 */
async function executePromoteAttachment(
  context: FileManagementToolContext,
  input: FileManagementToolInput
): Promise<AttachmentPromoteResult | null> {
  const repos = getRepositories();
  const attachmentId = input.attachmentId!;
  const targetProjectId = input.targetProjectId ?? context.projectId;
  const targetFolderPath = normalizeFolderPath(input.targetFolderPath || '/');

  logger.debug('Executing promote_attachment', {
    context: 'file-management-handler',
    attachmentId,
    targetProjectId,
    targetFolderPath,
  });

  // Get the attachment (file)
  const file = await repos.files.findById(attachmentId);
  if (!file || file.userId !== context.userId) {
    return null;
  }

  // Validate folder path
  const folderValidation = validateFolderPath(targetFolderPath);
  if (!folderValidation.isValid) {
    return {
      success: false,
      fileId: attachmentId,
      filename: file.originalFilename,
      message: folderValidation.error,
    };
  }

  // If moving to a project, verify project ownership
  if (targetProjectId) {
    const project = await repos.projects.findById(targetProjectId);
    if (!project || project.userId !== context.userId) {
      return {
        success: false,
        fileId: attachmentId,
        filename: file.originalFilename,
        message: 'Target project not found or access denied.',
      };
    }
  }

  // Update the file's project and folder
  const updated = await repos.files.update(attachmentId, {
    projectId: targetProjectId,
    folderPath: targetFolderPath,
  });

  if (!updated) {
    return {
      success: false,
      fileId: attachmentId,
      filename: file.originalFilename,
      message: 'Failed to update file.',
    };
  }

  logger.info('Attachment promoted', {
    context: 'file-management-handler',
    fileId: attachmentId,
    newProjectId: targetProjectId,
    newFolderPath: targetFolderPath,
  });

  return {
    success: true,
    fileId: updated.id,
    filename: updated.originalFilename,
    newProjectId: targetProjectId,
    newFolderPath: targetFolderPath,
    message: targetProjectId
      ? `File promoted to project files in folder "${targetFolderPath}".`
      : `File promoted to general files in folder "${targetFolderPath}".`,
  };
}

/**
 * Execute a file management tool call
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user and project IDs
 * @returns Tool output with results
 */
export async function executeFileManagementTool(
  input: unknown,
  context: FileManagementToolContext
): Promise<FileManagementToolOutput> {
  const log = logger.child({
    module: 'file-management-handler',
    chatId: context.chatId,
    projectId: context.projectId,
    userId: context.userId,
  });

  try {
    // Validate input
    if (!validateFileManagementInput(input)) {
      log.debug('Invalid input received', { input });
      return {
        success: false,
        action: 'list_files',
        error: 'Invalid input: action is required and must be a valid action type',
      };
    }

    const { action } = input;

    log.debug('Executing file management tool', { action });

    switch (action) {
      case 'list_files': {
        const result = await executeListFiles(context, input);
        if (!result) {
          return {
            success: false,
            action,
            error: 'Failed to list files. Check scope and characterId parameters.',
          };
        }
        return {
          success: true,
          action,
          data: result,
        };
      }

      case 'list_folders': {
        const result = await executeListFolders(context, input);
        if (!result) {
          return {
            success: false,
            action,
            error: 'Failed to list folders.',
          };
        }
        return {
          success: true,
          action,
          data: result,
        };
      }

      case 'read_file': {
        if (!input.fileId) {
          return {
            success: false,
            action,
            error: 'fileId is required for read_file action',
          };
        }
        const result = await executeReadFile(context, input.fileId);
        if (!result) {
          return {
            success: false,
            action,
            error: 'File not found or access denied',
          };
        }
        return {
          success: true,
          action,
          data: result,
        };
      }

      case 'write_file': {
        if (!input.filename || !input.content) {
          return {
            success: false,
            action,
            error: 'filename and content are required for write_file action',
          };
        }
        const result = await executeWriteFile(context, input);
        return {
          success: result.success,
          action,
          data: result,
          error: result.success ? undefined : result.message,
        };
      }

      case 'create_folder': {
        if (!input.newFolderPath) {
          return {
            success: false,
            action,
            error: 'newFolderPath is required for create_folder action',
          };
        }
        const result = await executeCreateFolder(context, input.newFolderPath);
        return {
          success: result.success,
          action,
          data: result,
          error: result.success ? undefined : result.message,
        };
      }

      case 'promote_attachment': {
        if (!input.attachmentId) {
          return {
            success: false,
            action,
            error: 'attachmentId is required for promote_attachment action',
          };
        }
        const result = await executePromoteAttachment(context, input);
        if (!result) {
          return {
            success: false,
            action,
            error: 'Attachment not found or access denied',
          };
        }
        return {
          success: result.success,
          action,
          data: result,
          error: result.success ? undefined : result.message,
        };
      }

      default:
        return {
          success: false,
          action: action as any,
          error: `Unknown action: ${action}`,
        };
    }
  } catch (error) {
    log.error('File management tool execution error', {}, error instanceof Error ? error : undefined);

    const action = typeof input === 'object' && input !== null && 'action' in input
      ? String((input as Record<string, unknown>).action) as any
      : 'list_files';

    return {
      success: false,
      action,
      error: error instanceof Error ? error.message : 'Unknown error during file management',
    };
  }
}

/**
 * Format file management results for inclusion in conversation context
 *
 * @param output - Tool output to format
 * @returns Formatted string suitable for LLM context
 */
export function formatFileManagementResults(output: FileManagementToolOutput): string {
  if (!output.success) {
    return `File Management Error: ${output.error || 'Unknown error'}`;
  }

  switch (output.action) {
    case 'list_files': {
      const list = output.data as FileListResult;
      if (list.files.length === 0) {
        return `No files found (scope: ${list.scope}, folder: ${list.folderPath || '/'}).`;
      }
      const fileLines = list.files.map(f =>
        `- ${f.folderPath !== '/' ? f.folderPath : ''}${f.filename} (${f.mimeType}, ${formatBytes(f.size)})${f.description ? ` - ${f.description}` : ''}`
      );
      return `Files (${list.total} total, scope: ${list.scope}):\n${fileLines.join('\n')}`;
    }

    case 'list_folders': {
      const list = output.data as FolderListResult;
      if (list.folders.length === 0) {
        return `No folders found (scope: ${list.scope}).`;
      }
      const folderLines = list.folders.map(f =>
        `${'  '.repeat(f.depth)}${f.path === '/' ? '/' : f.name + '/'} (${f.fileCount} files)`
      );
      return `Folders (${list.total} total, scope: ${list.scope}):\n${folderLines.join('\n')}`;
    }

    case 'read_file': {
      const read = output.data as FileReadResult;
      const header = `File: ${read.filename} (${read.mimeType})`;
      const truncNote = read.truncated ? '\n[Content truncated]' : '';
      if (read.contentType === 'code' && read.language) {
        return `${header}\n\`\`\`${read.language}\n${read.content}\n\`\`\`${truncNote}`;
      }
      return `${header}\n\n${read.content}${truncNote}`;
    }

    case 'write_file': {
      const write = output.data as FileWriteResult;
      if (write.requiresPermission) {
        return `Permission required to write file "${write.filename}" to folder "${write.folderPath}". Please approve the write request.`;
      }
      return `File "${write.filename}" created successfully in folder "${write.folderPath}".`;
    }

    case 'create_folder': {
      const folder = output.data as FolderCreateResult;
      return folder.message || `Folder "${folder.folderPath}" is ready.`;
    }

    case 'promote_attachment': {
      const promote = output.data as AttachmentPromoteResult;
      return promote.message || `File "${promote.filename}" promoted successfully.`;
    }

    default:
      return 'Unknown action result';
  }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
