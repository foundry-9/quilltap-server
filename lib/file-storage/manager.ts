/**
 * File Storage Manager Singleton
 *
 * Central orchestrator for file storage operations. Routes operations to the correct
 * backend based on mount point configuration, handles backend lifecycle management,
 * and provides high-level file operations (upload, download, delete, etc.).
 *
 * Features:
 * - Multiple storage backend support via mount points
 * - Provider plugin registration for custom backends
 * - Automatic backend instantiation with secret decryption
 * - Per-project mount point configuration (projects can specify their storage location)
 * - System default mount point for general files
 * - Consistent storage key generation
 * - Comprehensive error handling and logging
 *
 * @module file-storage/manager
 */

import type { Readable } from 'stream';
import type {
  FileStorageBackend,
  FileStorageProviderPlugin,
  ProviderConfigField,
} from './interfaces';
import type { MountPoint } from './mount-point.types';
import { LocalFileStorageBackend } from './backends/local';
import { decryptSecrets } from './secrets';
import type { FileEntry } from '@/lib/schemas/file.types';
import { createLogger } from '@/lib/logging/create-logger';
import { env } from '@/lib/env';
import { mountPointsRepository } from '@/lib/mongodb/repositories/mount-points.repository';
import { getRepositories } from '@/lib/repositories/factory';

const logger = createLogger('file-storage:manager');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for the uploadFile method
 */
interface UploadFileParams {
  /** User ID - owner of the file */
  userId: string;

  /** File ID - unique identifier for the file */
  fileId: string;

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

  /** Optional override for mount point selection */
  mountPointId?: string;

  /** Optional custom metadata to store with file */
  metadata?: Record<string, string>;
}

/**
 * Parameters for building a storage key
 */
interface StorageKeyParams {
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

  /** Mount point ID that stored the file */
  mountPointId: string;
}

/**
 * Available backend information for UI display
 */
export interface AvailableBackendInfo {
  /** Unique identifier for the provider (e.g., 'local', 's3') */
  providerId: string;

  /** Human-readable name for the provider */
  displayName: string;

  /** Description of the provider */
  description: string;

  /** Configuration fields required by this backend */
  configFields: ProviderConfigField[];
}

// ============================================================================
// FILE STORAGE MANAGER
// ============================================================================

/**
 * File Storage Manager Singleton
 *
 * Orchestrates file storage operations across multiple backends/mount points.
 * Provides high-level file operations and backend routing.
 */
class FileStorageManager {
  /** Map of mounted backend instances by mount point ID */
  private backends: Map<string, FileStorageBackend> = new Map();

  /** Map of loaded mount points by ID */
  private mountPoints: Map<string, MountPoint> = new Map();

  /** Map of registered provider plugins */
  private providerPlugins: Map<string, FileStorageProviderPlugin> = new Map();

  /** Default mount point ID (system default) */
  private defaultMountPointId: string | null = null;

  /** Whether the manager has been initialized */
  private initialized: boolean = false;

  /**
   * Initialize the file storage manager
   *
   * Loads mount points from the database, instantiates backends,
   * and identifies default mount points.
   *
   * @throws {Error} If initialization fails
   */
  async initialize(): Promise<void> {
    logger.debug('Initializing file storage manager');

    try {
      // Load mount points from database
      await this.refreshMountPoints();

      // Identify the default mount point
      for (const [id, mountPoint] of this.mountPoints) {
        if (mountPoint.isDefault && !this.defaultMountPointId) {
          this.defaultMountPointId = id;
          logger.info('Set default mount point', { mountPointId: id });
          break;
        }
      }

      // Ensure at least one backend is available
      if (this.backends.size === 0 && this.mountPoints.size > 0) {
        logger.warn(
          'No backends instantiated despite mount points being available'
        );
      }

      this.initialized = true;
      logger.info('File storage manager initialized', {
        mountPointCount: this.mountPoints.size,
        backendCount: this.backends.size,
        defaultMountPointId: this.defaultMountPointId,
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
   * Register a file storage provider plugin
   *
   * Allows custom storage backends to be registered and used for mount points.
   *
   * @param plugin - The provider plugin to register
   */
  registerProviderPlugin(plugin: FileStorageProviderPlugin): void {
    const backendId = plugin.metadata.backendId;

    this.providerPlugins.set(backendId, plugin);

    logger.debug('Registered provider plugin', {
      backendId,
      displayName: plugin.metadata.displayName,
    });
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
   * Ensure the manager is initialized before use
   *
   * This provides lazy initialization for cases where the manager
   * is accessed before explicit initialization (e.g., in different
   * Next.js server contexts).
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      logger.debug('Lazy initializing file storage manager');
      await this.initialize();
    }
  }

  // ========================================================================
  // BACKEND RESOLUTION
  // ========================================================================

  /**
   * Get a backend by mount point ID
   *
   * Returns a cached backend instance if available, otherwise creates one.
   *
   * @param mountPointId - The mount point ID
   * @returns The backend instance, or null if mount point not found
   */
  async getBackend(mountPointId: string): Promise<FileStorageBackend | null> {
    // Ensure manager is initialized (lazy initialization for different contexts)
    await this.ensureInitialized();

    // Check if backend is already instantiated and cached
    if (this.backends.has(mountPointId)) {
      return this.backends.get(mountPointId) || null;
    }

    // Look up the mount point
    const mountPoint = this.mountPoints.get(mountPointId);
    if (!mountPoint) {
      logger.warn('Mount point not found', { mountPointId });
      return null;
    }

    // Create the backend
    try {
      const backend = await this.createBackendForMountPoint(mountPoint);
      this.backends.set(mountPointId, backend);

      logger.debug('Created and cached backend', {
        mountPointId,
        backendType: mountPoint.backendType,
      });

      return backend;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown backend creation error';

      logger.error('Failed to create backend for mount point', {
        mountPointId,
        backendType: mountPoint.backendType,
        error: errorMsg,
      });

      return null;
    }
  }

  /**
   * Get the backend for a specific file
   *
   * Uses the file's mountPointId if available, otherwise falls back to
   * the project default or system default.
   *
   * @param file - The file entry
   * @returns The backend instance
   * @throws {Error} If no suitable backend is found
   */
  async getBackendForFile(file: FileEntry): Promise<FileStorageBackend> {
    // Try to use the file's explicit mount point
    if (file.mountPointId) {
      const backend = await this.getBackend(file.mountPointId);
      if (backend) {
        logger.debug('Got backend for file from explicit mount point', {
          fileId: file.id,
          mountPointId: file.mountPointId,
        });
        return backend;
      }
    }

    // Fall back to project or system default
    const backend = await this.getBackendForProject(file.projectId || null);

    logger.debug('Got backend for file from project/system default', {
      fileId: file.id,
      projectId: file.projectId,
    });

    return backend;
  }

  /**
   * Get the backend for a project
   *
   * Checks if the project has a specific mount point configured, otherwise
   * returns the system default backend.
   *
   * @param projectId - The project ID (null for general files)
   * @returns The backend instance
   * @throws {Error} If no suitable backend is found
   */
  async getBackendForProject(projectId: string | null): Promise<FileStorageBackend> {
    logger.debug('Getting backend for project', { projectId });

    // Check if the project has a specific mount point configured
    if (projectId) {
      try {
        const project = await getRepositories().projects.findById(projectId);
        if (project?.mountPointId) {
          const backend = await this.getBackend(project.mountPointId);
          if (backend) {
            logger.debug('Using project-specific mount point', {
              projectId,
              mountPointId: project.mountPointId,
            });
            return backend;
          }
          logger.warn('Project mount point not found, falling back to default', {
            projectId,
            mountPointId: project.mountPointId,
          });
        }
      } catch (error) {
        logger.warn('Error looking up project mount point, falling back to default', {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Fall back to system default
    const backend = await this.getDefaultBackend();

    if (!backend) {
      throw new Error(
        'No suitable backend found for project. Check mount point configuration.'
      );
    }

    return backend;
  }

  /**
   * Get the default backend
   *
   * Returns the system default backend.
   *
   * @returns The default backend instance
   * @throws {Error} If no default backend is configured
   */
  async getDefaultBackend(): Promise<FileStorageBackend> {
    // Ensure manager is initialized (lazy initialization for different contexts)
    await this.ensureInitialized();

    if (!this.defaultMountPointId) {
      const errorMsg =
        'No default mount point configured. Create a mount point and mark it as default.';
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const backend = await this.getBackend(this.defaultMountPointId);
    if (!backend) {
      const errorMsg = `Failed to get default backend for mount point ${this.defaultMountPointId}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    logger.debug('Got default backend', {
      mountPointId: this.defaultMountPointId,
    });

    return backend;
  }

  // ========================================================================
  // MOUNT POINT MANAGEMENT
  // ========================================================================

  /**
   * Get all loaded mount points
   *
   * @returns Array of all mount points
   */
  getMountPoints(): MountPoint[] {
    return Array.from(this.mountPoints.values());
  }

  /**
   * Get a specific mount point by ID
   *
   * @param id - The mount point ID
   * @returns The mount point, or null if not found
   */
  getMountPoint(id: string): MountPoint | null {
    return this.mountPoints.get(id) || null;
  }

  /**
   * Get the default mount point ID
   *
   * @returns The default mount point ID, or null if not set
   */
  getDefaultMountPointId(): string | null {
    return this.defaultMountPointId;
  }

  /**
   * Get the mount point ID for a specific project
   *
   * @param projectId - The project ID
   * @returns The project's mount point ID, or null if not set
   */
  async getProjectMountPointId(projectId: string): Promise<string | null> {
    try {
      const project = await getRepositories().projects.findById(projectId);
      return project?.mountPointId || null;
    } catch (error) {
      logger.warn('Error looking up project mount point', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get available backend types
   *
   * Returns information about all available storage backends including:
   * - Built-in local filesystem backend
   * - Registered provider plugins (S3, etc.)
   *
   * Used by the settings UI to display backend options when creating mount points.
   *
   * @returns Array of available backend information
   */
  getAvailableBackends(): AvailableBackendInfo[] {
    logger.debug('Getting available backends');

    const backends: AvailableBackendInfo[] = [];

    // Add built-in local backend
    backends.push({
      providerId: 'local',
      displayName: 'Local Filesystem',
      description: 'Store files on the local filesystem. Default path is configured via QUILLTAP_FILE_STORAGE_PATH environment variable.',
      configFields: [
        {
          name: 'basePath',
          label: 'Base Path',
          type: 'string',
          required: true,
          description: 'Directory path where files will be stored',
          placeholder: env.QUILLTAP_FILE_STORAGE_PATH || './data/files',
          defaultValue: env.QUILLTAP_FILE_STORAGE_PATH || './data/files',
        },
      ],
    });

    // Add registered provider plugins
    for (const [backendId, plugin] of this.providerPlugins) {
      backends.push({
        providerId: backendId,
        displayName: plugin.metadata.displayName,
        description: plugin.metadata.description,
        configFields: plugin.configSchema,
      });

      logger.debug('Added provider plugin to available backends', {
        backendId,
        displayName: plugin.metadata.displayName,
      });
    }

    logger.debug('Retrieved available backends', {
      count: backends.length,
      backendIds: backends.map((b) => b.providerId),
    });

    return backends;
  }

  /**
   * Refresh mount points from the database
   *
   * Reloads all mount points and invalidates cached backends.
   * Called during initialization and when mount points are updated.
   *
   * @throws {Error} If database query fails
   */
  async refreshMountPoints(): Promise<void> {
    logger.debug('Refreshing mount points from database');

    try {
      // Load mount points from MongoDB
      const mountPoints = await mountPointsRepository.findAll();

      // Clear existing state
      this.mountPoints.clear();
      this.backends.clear();
      this.defaultMountPointId = null;

      // Populate mount points map
      for (const mp of mountPoints) {
        this.mountPoints.set(mp.id, mp);
        logger.debug('Loaded mount point', {
          mountPointId: mp.id,
          name: mp.name,
          backendType: mp.backendType,
          isDefault: mp.isDefault,
        });
      }

      logger.info('Mount points refreshed', {
        count: this.mountPoints.size,
      });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown database error';

      logger.error('Failed to refresh mount points', {
        error: errorMsg,
      });

      throw new Error(`Failed to refresh mount points: ${errorMsg}`);
    }
  }

  // ========================================================================
  // FILE OPERATIONS
  // ========================================================================

  /**
   * Upload a file to storage
   *
   * Selects the appropriate backend based on mount point configuration,
   * generates a storage key, and uploads the file.
   *
   * @param params - Upload parameters
   * @returns Upload result with storage key and mount point ID
   * @throws {Error} If upload fails
   */
  async uploadFile(params: UploadFileParams): Promise<UploadResult> {
    const {
      userId,
      fileId,
      filename,
      content,
      contentType,
      projectId,
      folderPath,
      mountPointId: overrideMountPointId,
      metadata,
    } = params;

    logger.debug('Uploading file', {
      userId,
      fileId,
      filename,
      size: content.length,
      contentType,
      projectId,
      overrideMountPointId,
    });

    try {
      // Select mount point (override > project > default)
      let targetMountPointId = overrideMountPointId;

      if (!targetMountPointId) {
        const backend = await this.getBackendForProject(projectId || null);
        // Find the mount point ID for this backend
        for (const [id, cachedBackend] of this.backends) {
          if (cachedBackend === backend) {
            targetMountPointId = id;
            break;
          }
        }

        if (!targetMountPointId && this.defaultMountPointId) {
          targetMountPointId = this.defaultMountPointId;
        }
      }

      if (!targetMountPointId) {
        throw new Error('No suitable mount point found for upload');
      }

      // Get backend
      const backend = await this.getBackend(targetMountPointId);
      if (!backend) {
        throw new Error(`Failed to get backend for mount point ${targetMountPointId}`);
      }

      // Generate storage key
      const storageKey = this.buildStorageKey({
        userId,
        fileId,
        filename,
        projectId,
        folderPath,
      });

      // Upload file
      await backend.upload(storageKey, content, contentType, metadata);

      logger.info('File uploaded successfully', {
        userId,
        fileId,
        filename,
        storageKey,
        mountPointId: targetMountPointId,
        size: content.length,
      });

      return {
        storageKey,
        mountPointId: targetMountPointId,
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown upload error';

      logger.error('File upload failed', {
        userId,
        fileId,
        filename,
        error: errorMsg,
      });

      throw new Error(`Failed to upload file '${filename}': ${errorMsg}`);
    }
  }

  /**
   * Download a file from storage
   *
   * Uses the file's mount point information to locate and download the file.
   *
   * @param file - The file entry containing storage information
   * @returns File content as Buffer
   * @throws {Error} If download fails
   */
  async downloadFile(file: FileEntry): Promise<Buffer> {
    logger.debug('Downloading file', {
      fileId: file.id,
      userId: file.userId,
      storageKey: file.storageKey,
      mountPointId: file.mountPointId,
    });

    try {
      if (!file.storageKey) {
        throw new Error('File has no storage key. Cannot download.');
      }

      const backend = await this.getBackendForFile(file);

      const content = await backend.download(file.storageKey);

      logger.info('File downloaded successfully', {
        fileId: file.id,
        userId: file.userId,
        size: content.length,
      });

      return content;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown download error';

      logger.error('File download failed', {
        fileId: file.id,
        userId: file.userId,
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
   * Uses the file's mount point information to locate and delete the file.
   *
   * @param file - The file entry containing storage information
   * @throws {Error} If deletion fails
   */
  async deleteFile(file: FileEntry): Promise<void> {
    logger.debug('Deleting file', {
      fileId: file.id,
      userId: file.userId,
      storageKey: file.storageKey,
      mountPointId: file.mountPointId,
    });

    try {
      if (!file.storageKey) {
        logger.warn('File has no storage key. Skipping deletion.', {
          fileId: file.id,
        });
        return;
      }

      const backend = await this.getBackendForFile(file);

      await backend.delete(file.storageKey);

      logger.info('File deleted successfully', {
        fileId: file.id,
        userId: file.userId,
      });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown deletion error';

      logger.error('File deletion failed', {
        fileId: file.id,
        userId: file.userId,
        error: errorMsg,
      });

      throw new Error(
        `Failed to delete file '${file.originalFilename}': ${errorMsg}`
      );
    }
  }

  /**
   * Get a URL for accessing a file
   *
   * Returns a proxy URL or presigned URL based on backend capabilities and options.
   *
   * @param file - The file entry
   * @param options - Optional configuration (presigned URL, expiration)
   * @returns Access URL for the file
   * @throws {Error} If URL generation fails
   */
  async getFileUrl(
    file: FileEntry,
    options?: { presigned?: boolean; expiresIn?: number }
  ): Promise<string> {
    logger.debug('Getting file URL', {
      fileId: file.id,
      userId: file.userId,
      presigned: options?.presigned,
      expiresIn: options?.expiresIn,
    });

    try {
      if (!file.storageKey) {
        throw new Error('File has no storage key. Cannot generate URL.');
      }

      const backend = await this.getBackendForFile(file);
      const metadata = backend.getMetadata();

      // Try to generate presigned URL if requested and supported
      if (options?.presigned && metadata.capabilities.presignedUrls) {
        if (!backend.getPresignedUrl) {
          throw new Error('Backend does not support presigned URLs');
        }

        const url = await backend.getPresignedUrl(
          file.storageKey,
          options.expiresIn || 3600
        );

        logger.debug('Generated presigned URL', {
          fileId: file.id,
          expiresIn: options.expiresIn,
        });

        return url;
      }

      // Fall back to proxy URL
      const proxyUrl = backend.getProxyUrl(file.storageKey);

      logger.debug('Generated proxy URL', {
        fileId: file.id,
      });

      return proxyUrl;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown URL generation error';

      logger.error('Failed to get file URL', {
        fileId: file.id,
        userId: file.userId,
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
    logger.debug('Checking if file exists', {
      fileId: file.id,
      userId: file.userId,
      storageKey: file.storageKey,
    });

    try {
      if (!file.storageKey) {
        logger.warn('File has no storage key. Assuming does not exist.', {
          fileId: file.id,
        });
        return false;
      }

      const backend = await this.getBackendForFile(file);
      const exists = await backend.exists(file.storageKey);

      logger.debug('File existence check complete', {
        fileId: file.id,
        exists,
      });

      return exists;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown existence check error';

      logger.error('Failed to check if file exists', {
        fileId: file.id,
        userId: file.userId,
        error: errorMsg,
      });

      throw new Error(`Failed to check if file exists: ${errorMsg}`);
    }
  }

  // ========================================================================
  // FOLDER OPERATIONS
  // ========================================================================

  /**
   * Create a folder in storage
   *
   * For local backends, creates an actual directory.
   * For S3-like backends, this is a no-op since folders are virtual.
   *
   * @param params - Folder creation parameters
   * @throws {Error} If folder creation fails
   */
  async createFolder(params: {
    userId: string;
    projectId: string | null;
    folderPath: string;
    mountPointId?: string;
  }): Promise<void> {
    const { userId, projectId, folderPath, mountPointId } = params;

    logger.debug('Creating folder in storage', {
      userId,
      projectId,
      folderPath,
      mountPointId,
    });

    try {
      // Get the appropriate backend
      let backend: FileStorageBackend;
      if (mountPointId) {
        const b = await this.getBackend(mountPointId);
        if (!b) {
          throw new Error(`Mount point not found: ${mountPointId}`);
        }
        backend = b;
      } else {
        backend = await this.getBackendForProject(projectId);
      }

      const metadata = backend.getMetadata();

      // Check if backend supports folder operations
      if (!metadata.capabilities.folders || !backend.createFolder) {
        logger.debug('Backend does not support folder operations, skipping', {
          providerId: metadata.providerId,
          folderPath,
        });
        return;
      }

      // Build the storage path for the folder
      const storagePath = this.buildFolderStoragePath({
        userId,
        projectId,
        folderPath,
      });

      // Create the folder
      await backend.createFolder(storagePath);

      logger.info('Created folder in storage', {
        userId,
        projectId,
        folderPath,
        storagePath,
      });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown folder creation error';

      logger.error('Failed to create folder in storage', {
        userId,
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
   * For local backends, removes the actual directory (must be empty).
   * For S3-like backends, this is a no-op since folders are virtual.
   *
   * @param params - Folder deletion parameters
   * @throws {Error} If folder deletion fails
   */
  async deleteFolder(params: {
    userId: string;
    projectId: string | null;
    folderPath: string;
    mountPointId?: string;
  }): Promise<void> {
    const { userId, projectId, folderPath, mountPointId } = params;

    logger.debug('Deleting folder from storage', {
      userId,
      projectId,
      folderPath,
      mountPointId,
    });

    try {
      // Get the appropriate backend
      let backend: FileStorageBackend;
      if (mountPointId) {
        const b = await this.getBackend(mountPointId);
        if (!b) {
          throw new Error(`Mount point not found: ${mountPointId}`);
        }
        backend = b;
      } else {
        backend = await this.getBackendForProject(projectId);
      }

      const metadata = backend.getMetadata();

      // Check if backend supports folder operations
      if (!metadata.capabilities.folders || !backend.deleteFolder) {
        logger.debug('Backend does not support folder operations, skipping', {
          providerId: metadata.providerId,
          folderPath,
        });
        return;
      }

      // Build the storage path for the folder
      const storagePath = this.buildFolderStoragePath({
        userId,
        projectId,
        folderPath,
      });

      // Delete the folder
      await backend.deleteFolder(storagePath);

      logger.info('Deleted folder from storage', {
        userId,
        projectId,
        folderPath,
        storagePath,
      });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown folder deletion error';

      logger.error('Failed to delete folder from storage', {
        userId,
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
   * Generates a consistent storage path based on user ID, project ID, and folder path.
   *
   * Format: `users/{userId}/{projectId or '_general'}/{folderPath}`
   *
   * @param params - Path generation parameters
   * @returns Storage path
   */
  private buildFolderStoragePath(params: {
    userId: string;
    projectId: string | null;
    folderPath: string;
  }): string {
    const { userId, projectId, folderPath } = params;

    // Build base path components
    const userPath = `users/${userId}`;
    const projectPath = projectId ? projectId : '_general';
    const folder = folderPath.replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes

    // Build full path
    const pathParts = [userPath, projectPath];
    if (folder) {
      pathParts.push(folder);
    }

    const storagePath = pathParts.join('/');

    logger.debug('Built folder storage path', {
      userId,
      projectId,
      folderPath,
      storagePath,
    });

    return storagePath;
  }

  // ========================================================================
  // STORAGE KEY GENERATION
  // ========================================================================

  /**
   * Build a storage key for a file
   *
   * Generates a consistent storage key based on user ID, project ID, folder path,
   * file ID, and sanitized filename.
   *
   * Format: `users/{userId}/{projectId or '_general'}/{folderPath}{fileId}_{sanitizedFilename}`
   *
   * @param params - Key generation parameters
   * @returns Storage key
   */
  buildStorageKey(params: StorageKeyParams): string {
    const {
      userId,
      fileId,
      filename,
      projectId,
      folderPath,
    } = params;

    // Sanitize filename (remove path separators and special characters)
    const sanitizedFilename = filename
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .toLowerCase();

    // Build base path components
    const userPath = `users/${userId}`;
    const projectPath = projectId ? projectId : '_general';
    const folder = folderPath
      ? folderPath.replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
      : '';

    // Build full key
    const pathParts = [userPath, projectPath];
    if (folder) {
      pathParts.push(folder);
    }

    // Combine with file ID and sanitized filename
    const key = `${pathParts.join('/')}/${fileId}_${sanitizedFilename}`;

    logger.debug('Generated storage key', {
      userId,
      fileId,
      filename,
      projectId,
      folderPath,
      key,
    });

    return key;
  }

  // ========================================================================
  // BACKEND INSTANTIATION
  // ========================================================================

  /**
   * Create a backend instance for a mount point
   *
   * Instantiates the appropriate backend based on the mount point's backend type.
   * For 'local' backends, creates a LocalFileStorageBackend.
   * For other types, looks up the registered provider plugin.
   *
   * @param mountPoint - The mount point configuration
   * @returns Initialized backend instance
   * @throws {Error} If backend creation fails
   */
  private async createBackendForMountPoint(mountPoint: MountPoint): Promise<FileStorageBackend> {
    logger.debug('Creating backend for mount point', {
      mountPointId: mountPoint.id,
      backendType: mountPoint.backendType,
    });

    try {
      // Handle built-in local backend
      if (mountPoint.backendType === 'local') {
        const config = mountPoint.backendConfig as { basePath?: string };

        if (!config.basePath) {
          throw new Error('Local backend configuration missing basePath');
        }

        const backend = new LocalFileStorageBackend({
          basePath: config.basePath,
        });

        // Test connection and ensure directory exists
        const testResult = await backend.testConnection();
        if (!testResult.success) {
          logger.warn('Local backend connection test failed', {
            mountPointId: mountPoint.id,
            basePath: config.basePath,
            message: testResult.message,
          });
        } else {
          logger.debug('Local backend connection test passed', {
            mountPointId: mountPoint.id,
            latencyMs: testResult.latencyMs,
          });
        }

        logger.info('Created local file storage backend', {
          mountPointId: mountPoint.id,
          basePath: config.basePath,
        });

        return backend;
      }

      // Handle plugin-provided backends
      const plugin = this.providerPlugins.get(mountPoint.backendType);
      if (!plugin) {
        throw new Error(
          `Provider plugin for backend type '${mountPoint.backendType}' not registered`
        );
      }

      // Decrypt secrets if available
      let config = { ...mountPoint.backendConfig };

      if (mountPoint.encryptedSecrets) {
        try {
          const secrets = decryptSecrets(mountPoint.encryptedSecrets);
          config = { ...config, ...secrets };

          logger.debug('Decrypted and merged secrets into backend config', {
            mountPointId: mountPoint.id,
          });
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : 'Unknown decryption error';

          logger.warn('Failed to decrypt mount point secrets', {
            mountPointId: mountPoint.id,
            error: errorMsg,
          });
        }
      }

      // Create backend via plugin
      const backend = plugin.createBackend(config);

      logger.info('Created plugin-provided backend', {
        mountPointId: mountPoint.id,
        backendType: mountPoint.backendType,
        displayName: plugin.metadata.displayName,
      });

      return backend;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown backend creation error';

      logger.error('Failed to create backend for mount point', {
        mountPointId: mountPoint.id,
        backendType: mountPoint.backendType,
        error: errorMsg,
      });

      throw new Error(
        `Failed to create backend for mount point ${mountPoint.id}: ${errorMsg}`
      );
    }
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
 *   userId: 'user-123',
 *   fileId: 'file-456',
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
