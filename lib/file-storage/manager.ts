/**
 * File Storage Manager Singleton
 *
 * Thin wrapper around LocalFileStorageBackend for local-only file storage.
 * Provides the same public API surface for all file operations.
 *
 * Storage key format (new):
 *   {projectId}/{folderPath}/{safeOriginalFilename}    — project files
 *   _general/{folderPath}/{safeOriginalFilename}       — general files
 *   _thumbnails/{fileId}_{size}.webp                   — thumbnails
 *
 * No more users/{userId}/ prefix. No more {fileId}_ prefix on filenames.
 * Folder paths map to real directories on disk.
 *
 * @module file-storage/manager
 */

import type { Readable } from 'stream';
import type { FileStorageBackend } from './interfaces';
import { LocalFileStorageBackend } from './backends/local';
import type { FileEntry } from '@/lib/schemas/file.types';

/**
 * Parameters for uploadRaw — writes content at an explicit storage key,
 * bypassing the normal buildStorageKey() path generation.
 */
interface UploadRawParams {
  /** Explicit storage key to write to */
  storageKey: string;

  /** File content */
  content: Buffer;

  /** MIME type */
  contentType: string;

  /** Optional custom metadata (no longer persisted as sidecar; kept for API compat) */
  metadata?: Record<string, string>;
}

import { createLogger } from '@/lib/logging/create-logger';
import { getFilesDir } from '@/lib/paths';

const logger = createLogger('file-storage:manager');

// ============================================================================
// SAFE FILENAME UTILITY
// ============================================================================

/**
 * Characters that are stripped from filenames for cross-platform safety.
 * Removes path separators, control chars, and Windows-reserved characters.
 */
const UNSAFE_FILENAME_CHARS = /[\/\\:*?"<>|\x00-\x1f\x7f]/g;

/**
 * Make a filename safe for cross-platform filesystem storage.
 *
 * Keeps original casing and spaces. Strips dangerous characters
 * like path separators and control characters.
 *
 * @param filename - Original filename
 * @returns Safe filename suitable for disk storage
 */
export function safeFilename(filename: string): string {
  let safe = filename.replace(UNSAFE_FILENAME_CHARS, '_');
  // Collapse runs of underscores
  safe = safe.replace(/_{2,}/g, '_');
  // Trim leading/trailing underscores and dots (avoid hidden files on Unix)
  safe = safe.replace(/^[_.]+/, '').replace(/[_.]+$/, '');
  // Fallback for empty result
  if (!safe) {
    safe = 'unnamed';
  }
  return safe;
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for the uploadFile method
 */
interface UploadFileParams {
  /** Original filename */
  filename: string;

  /** File content */
  content: Buffer;

  /** MIME type */
  contentType: string;

  /** Optional project ID for scoped storage */
  projectId?: string | null;

  /** Optional folder path within project/general files */
  folderPath?: string;

  /** Optional custom metadata (kept for API compat, not persisted to sidecar) */
  metadata?: Record<string, string>;
}

/**
 * Parameters for building a storage key
 */
interface StorageKeyParams {
  /** Original filename */
  filename: string;

  /** Optional project ID */
  projectId?: string | null;

  /** Optional folder path */
  folderPath?: string;
}

/**
 * Parameters for building a legacy storage key (used by migration only)
 */
interface LegacyStorageKeyParams {
  /** User ID */
  userId: string;

  /** File ID */
  fileId: string;

  /** Original filename */
  filename: string;

  /** Optional project ID */
  projectId?: string | null;

  /** Optional folder path */
  folderPath?: string;
}

/**
 * Result of file upload operation
 */
interface UploadResult {
  /** Storage key where file was stored */
  storageKey: string;
}

// ============================================================================
// FILE STORAGE MANAGER
// ============================================================================

/**
 * File Storage Manager Singleton
 *
 * Local-only file storage using LocalFileStorageBackend.
 */
class FileStorageManager {
  /** The local file storage backend */
  private backend: FileStorageBackend | null = null;

  /** Whether the manager has been initialized */
  private initialized: boolean = false;

  /**
   * Get effective storage key for a file
   *
   * Returns storageKey if present, or null if not available.
   *
   * @param file - The file entry
   * @returns The effective storage key or null
   */
  private getEffectiveStorageKey(file: FileEntry): string | null {
    if (file.storageKey) {
      return file.storageKey;
    }
    return null;
  }

  /**
   * Initialize the file storage manager
   *
   * Creates the local file storage backend using the configured files directory.
   *
   * @throws {Error} If initialization fails
   */
  async initialize(): Promise<void> {
    try {
      const basePath = getFilesDir();

      this.backend = new LocalFileStorageBackend({ basePath });

      // Test connection and ensure directory exists
      const testResult = await this.backend.testConnection();
      if (!testResult.success) {
        logger.warn('Local backend connection test failed', {
          basePath,
          message: testResult.message,
        });
      }

      this.initialized = true;

      logger.info('File storage manager initialized', {
        basePath,
      });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown initialization error';

      logger.error('Failed to initialize file storage manager', {
        error: errorMsg,
      });

      throw new Error(`Failed to initialize file storage manager: ${errorMsg}`);
    }
  }

  /**
   * Check if the manager has been initialized
   *
   * @returns True if initialized, false otherwise
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the base path of the file storage directory
   *
   * @returns The absolute path to the files directory
   */
  getBasePath(): string {
    return getFilesDir();
  }

  /**
   * Ensure the manager is initialized before use
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Get the backend instance
   */
  private async getBackend(): Promise<FileStorageBackend> {
    await this.ensureInitialized();

    if (!this.backend) {
      throw new Error('File storage backend not available. Initialize the manager first.');
    }

    return this.backend;
  }

  // ========================================================================
  // FILE OPERATIONS
  // ========================================================================

  /**
   * Upload a file to storage
   *
   * Generates a storage key and uploads the file to the local backend.
   * Handles filename collisions by appending (2), (3), etc.
   *
   * @param params - Upload parameters
   * @returns Upload result with storage key
   * @throws {Error} If upload fails
   */
  async uploadFile(params: UploadFileParams): Promise<UploadResult> {
    const {
      filename,
      content,
      contentType,
      projectId,
      folderPath,
    } = params;
    try {
      const backend = await this.getBackend();

      // Generate storage key
      let storageKey = this.buildStorageKey({
        filename,
        projectId,
        folderPath,
      });

      // Handle filename collision — append (2), (3), etc.
      let attempt = 1;
      while (await backend.exists(storageKey)) {
        attempt++;
        storageKey = this.buildStorageKeyWithSuffix({
          filename,
          projectId,
          folderPath,
        }, attempt);
      }

      // Upload file
      await backend.upload(storageKey, content, contentType);

      logger.info('File uploaded successfully', {
        filename,
        storageKey,
        size: content.length,
        projectId: projectId || '_general',
      });

      return { storageKey };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown upload error';

      logger.error('File upload failed', {
        filename,
        error: errorMsg,
      });

      throw new Error(`Failed to upload file '${filename}': ${errorMsg}`);
    }
  }

  /**
   * Download a file from storage
   *
   * @param file - The file entry containing storage information
   * @returns File content as Buffer
   * @throws {Error} If download fails
   */
  async downloadFile(file: FileEntry): Promise<Buffer> {
    const effectiveStorageKey = this.getEffectiveStorageKey(file);
    try {
      if (!effectiveStorageKey) {
        throw new Error('File has no storage key. Cannot download.');
      }

      const backend = await this.getBackend();
      const content = await backend.download(effectiveStorageKey);

      return content;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown download error';

      logger.error('File download failed', {
        fileId: file.id,
        error: errorMsg,
      });

      throw new Error(
        `Failed to download file '${file.originalFilename}': ${errorMsg}`
      );
    }
  }

  /**
   * Delete a file from storage
   *
   * @param file - The file entry containing storage information
   * @throws {Error} If deletion fails
   */
  async deleteFile(file: FileEntry): Promise<void> {
    const effectiveStorageKey = this.getEffectiveStorageKey(file);
    try {
      if (!effectiveStorageKey) {
        logger.warn('File has no storage key. Skipping deletion.', {
          fileId: file.id,
        });
        return;
      }

      const backend = await this.getBackend();
      await backend.delete(effectiveStorageKey);

      logger.info('File deleted successfully', {
        fileId: file.id,
      });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown deletion error';

      logger.error('File deletion failed', {
        fileId: file.id,
        error: errorMsg,
      });

      throw new Error(
        `Failed to delete file '${file.originalFilename}': ${errorMsg}`
      );
    }
  }

  /**
   * Upload content at an explicit storage key
   *
   * Unlike uploadFile(), this does NOT generate a storage key from project/filename.
   * Used for writing derived data (e.g. thumbnails) at a predictable, canonical key.
   *
   * @param params - Upload parameters with explicit key
   * @throws {Error} If upload fails
   */
  async uploadRaw(params: UploadRawParams): Promise<void> {
    const { storageKey, content, contentType } = params;
    try {
      const backend = await this.getBackend();
      await backend.upload(storageKey, content, contentType);

      logger.debug('Raw upload completed', {
        storageKey,
        size: content.length,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown upload error';

      logger.error('Raw upload failed', {
        storageKey,
        error: errorMsg,
      });

      throw new Error(`Failed to upload raw content at '${storageKey}': ${errorMsg}`);
    }
  }

  /**
   * Delete content at an explicit storage key
   *
   * Counterpart to uploadRaw() — deletes data at a known key.
   *
   * @param storageKey - The explicit key to delete
   * @throws {Error} If deletion fails
   */
  async deleteRaw(storageKey: string): Promise<void> {
    try {
      const backend = await this.getBackend();
      await backend.delete(storageKey);

      logger.debug('Raw delete completed', { storageKey });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown deletion error';

      logger.error('Raw delete failed', {
        storageKey,
        error: errorMsg,
      });

      throw new Error(`Failed to delete raw content at '${storageKey}': ${errorMsg}`);
    }
  }

  /**
   * Get a URL for accessing a file
   *
   * Returns a proxy URL for the file.
   *
   * @param file - The file entry
   * @returns Access URL for the file
   * @throws {Error} If URL generation fails
   */
  async getFileUrl(file: FileEntry): Promise<string> {
    const effectiveStorageKey = this.getEffectiveStorageKey(file);
    try {
      if (!effectiveStorageKey) {
        throw new Error('File has no storage key. Cannot generate URL.');
      }

      const backend = await this.getBackend();
      const proxyUrl = backend.getProxyUrl(effectiveStorageKey);
      return proxyUrl;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown URL generation error';

      logger.error('Failed to get file URL', {
        fileId: file.id,
        error: errorMsg,
      });

      throw new Error(`Failed to get URL for file: ${errorMsg}`);
    }
  }

  /**
   * Check if a file exists in storage
   *
   * @param file - The file entry
   * @returns True if file exists, false otherwise
   * @throws {Error} If check fails
   */
  async fileExists(file: FileEntry): Promise<boolean> {
    const effectiveStorageKey = this.getEffectiveStorageKey(file);
    try {
      if (!effectiveStorageKey) {
        logger.warn('File has no storage key. Assuming does not exist.', {
          fileId: file.id,
        });
        return false;
      }

      const backend = await this.getBackend();
      const exists = await backend.exists(effectiveStorageKey);
      return exists;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown existence check error';

      logger.error('Failed to check if file exists', {
        fileId: file.id,
        error: errorMsg,
      });

      throw new Error(`Failed to check if file exists: ${errorMsg}`);
    }
  }

  /**
   * Check if a storage key exists in the backend
   *
   * @param storageKey - The storage key to check
   * @returns True if exists, false otherwise
   */
  async storageKeyExists(storageKey: string): Promise<boolean> {
    try {
      const backend = await this.getBackend();
      return await backend.exists(storageKey);
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown existence check error';
      logger.error('Failed to check if storage key exists', {
        storageKey,
        error: errorMsg,
      });
      throw new Error(`Failed to check if storage key exists: ${errorMsg}`);
    }
  }

  // ========================================================================
  // FOLDER OPERATIONS
  // ========================================================================

  /**
   * Create a folder in storage
   *
   * @param params - Folder creation parameters
   * @throws {Error} If folder creation fails
   */
  async createFolder(params: {
    projectId: string | null;
    folderPath: string;
  }): Promise<void> {
    const { projectId, folderPath } = params;
    try {
      const backend = await this.getBackend();
      const metadata = backend.getMetadata();

      if (!metadata.capabilities.folders || !backend.createFolder) {
        return;
      }

      const storagePath = this.buildFolderStoragePath({
        projectId,
        folderPath,
      });

      await backend.createFolder(storagePath);

      logger.info('Created folder in storage', {
        projectId,
        folderPath,
        storagePath,
      });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown folder creation error';

      logger.error('Failed to create folder in storage', {
        projectId,
        folderPath,
        error: errorMsg,
      });

      throw new Error(`Failed to create folder '${folderPath}': ${errorMsg}`);
    }
  }

  /**
   * Delete a folder from storage
   *
   * @param params - Folder deletion parameters
   * @throws {Error} If folder deletion fails
   */
  async deleteFolder(params: {
    projectId: string | null;
    folderPath: string;
  }): Promise<void> {
    const { projectId, folderPath } = params;
    try {
      const backend = await this.getBackend();
      const metadata = backend.getMetadata();

      if (!metadata.capabilities.folders || !backend.deleteFolder) {
        return;
      }

      const storagePath = this.buildFolderStoragePath({
        projectId,
        folderPath,
      });

      await backend.deleteFolder(storagePath);

      logger.info('Deleted folder from storage', {
        projectId,
        folderPath,
        storagePath,
      });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown folder deletion error';

      logger.error('Failed to delete folder from storage', {
        projectId,
        folderPath,
        error: errorMsg,
      });

      throw new Error(`Failed to delete folder '${folderPath}': ${errorMsg}`);
    }
  }

  /**
   * Build a storage path for a folder
   *
   * New format: `{projectId or '_general'}/{folderPath}`
   */
  buildFolderStoragePath(params: {
    projectId: string | null;
    folderPath: string;
  }): string {
    const { projectId, folderPath } = params;

    const projectPath = projectId ? projectId : '_general';
    const folder = folderPath.replace(/^\/+|\/+$/g, '');

    const pathParts = [projectPath];
    if (folder) {
      pathParts.push(folder);
    }

    return pathParts.join('/');
  }

  // ========================================================================
  // STORAGE KEY GENERATION
  // ========================================================================

  /**
   * Build a storage key for a file
   *
   * New format: `{projectId or '_general'}/{folderPath}/{safeFilename}`
   *
   * No userId prefix. No fileId prefix on filename.
   * Real directories on disk mirror the logical folder structure.
   */
  buildStorageKey(params: StorageKeyParams): string {
    const {
      filename,
      projectId,
      folderPath,
    } = params;

    const safe = safeFilename(filename);
    const projectPath = projectId ? projectId : '_general';
    const folder = folderPath
      ? folderPath.replace(/^\/+|\/+$/g, '')
      : '';

    const pathParts = [projectPath];
    if (folder) {
      pathParts.push(folder);
    }

    const key = `${pathParts.join('/')}/${safe}`;
    return key;
  }

  /**
   * Build a storage key with a collision-avoidance suffix
   *
   * Inserts ` (N)` before the file extension.
   *
   * @param params - Storage key parameters
   * @param attempt - Collision attempt number (2, 3, 4, ...)
   * @returns Storage key with suffix
   */
  private buildStorageKeyWithSuffix(params: StorageKeyParams, attempt: number): string {
    const {
      filename,
      projectId,
      folderPath,
    } = params;

    const safe = safeFilename(filename);
    const dotIndex = safe.lastIndexOf('.');
    let suffixed: string;
    if (dotIndex > 0) {
      suffixed = `${safe.slice(0, dotIndex)} (${attempt})${safe.slice(dotIndex)}`;
    } else {
      suffixed = `${safe} (${attempt})`;
    }

    const projectPath = projectId ? projectId : '_general';
    const folder = folderPath
      ? folderPath.replace(/^\/+|\/+$/g, '')
      : '';

    const pathParts = [projectPath];
    if (folder) {
      pathParts.push(folder);
    }

    return `${pathParts.join('/')}/${suffixed}`;
  }

  /**
   * Build a legacy-format storage key (used only by migration)
   *
   * Old format: `users/{userId}/{projectId or '_general'}/{folderPath}/{fileId}_{sanitizedFilename}`
   */
  buildLegacyStorageKey(params: LegacyStorageKeyParams): string {
    const {
      userId,
      fileId,
      filename,
      projectId,
      folderPath,
    } = params;

    const sanitizedFilename = filename
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .toLowerCase();

    const userPath = `users/${userId}`;
    const projectPath = projectId ? projectId : '_general';
    const folder = folderPath
      ? folderPath.replace(/^\/+|\/+$/g, '')
      : '';

    const pathParts = [userPath, projectPath];
    if (folder) {
      pathParts.push(folder);
    }

    const key = `${pathParts.join('/')}/${fileId}_${sanitizedFilename}`;
    return key;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

/**
 * Global file storage manager singleton instance
 *
 * Use this instance for all file storage operations in the application.
 *
 * @example
 * ```ts
 * import { fileStorageManager } from '@/lib/file-storage/manager';
 *
 * // Initialize on app startup
 * await fileStorageManager.initialize();
 *
 * // Upload a file
 * const result = await fileStorageManager.uploadFile({
 *   filename: 'document.pdf',
 *   content: fileBuffer,
 *   contentType: 'application/pdf',
 *   projectId: 'project-789',
 * });
 *
 * // Download a file
 * const content = await fileStorageManager.downloadFile(fileEntry);
 *
 * // Delete a file
 * await fileStorageManager.deleteFile(fileEntry);
 * ```
 */
export const fileStorageManager = new FileStorageManager();
