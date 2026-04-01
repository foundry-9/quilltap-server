/**
 * File Storage Plugin types for Quilltap plugin development
 *
 * Defines the interfaces and types needed to create custom file storage
 * backend providers as Quilltap plugins.
 *
 * @module @quilltap/plugin-types/plugins/file-storage
 */

import type { Readable } from 'stream';

// ============================================================================
// CAPABILITIES
// ============================================================================

/**
 * Describes what features a storage backend supports
 */
export interface FileBackendCapabilities {
  /** Whether the backend supports presigned URLs for direct access */
  presignedUrls: boolean;

  /** Whether the backend supports public URLs (no authentication required) */
  publicUrls: boolean;

  /** Whether the backend supports streaming uploads */
  streamingUpload: boolean;

  /** Whether the backend supports streaming downloads */
  streamingDownload: boolean;

  /** Whether the backend supports copying files between locations */
  copy: boolean;

  /** Whether the backend supports listing files in a prefix/directory */
  list: boolean;

  /** Whether the backend supports retrieving file metadata */
  metadata: boolean;
}

// ============================================================================
// METADATA
// ============================================================================

/**
 * Metadata about a file storage backend
 */
export interface FileBackendMetadata {
  /** Unique identifier for this provider */
  providerId: string;

  /** Human-readable display name for UI */
  displayName: string;

  /** Description of the storage backend */
  description: string;

  /** Capabilities supported by this backend */
  capabilities: FileBackendCapabilities;
}

/**
 * Metadata about a stored file
 */
export interface FileMetadata {
  /** Size in bytes */
  size: number;

  /** MIME type */
  contentType: string;

  /** Last modified timestamp */
  lastModified: Date;
}

// ============================================================================
// STORAGE BACKEND
// ============================================================================

/**
 * Interface for a file storage backend implementation
 *
 * Plugins implementing this interface can provide custom storage backends
 * such as S3, Google Cloud Storage, Azure Blob Storage, etc.
 */
export interface FileStorageBackend {
  /**
   * Get metadata about this storage backend
   *
   * @returns Backend metadata including capabilities
   */
  getMetadata(): FileBackendMetadata;

  /**
   * Test the connection to the storage backend
   *
   * Verifies that the backend is properly configured and accessible.
   * This is called during plugin initialization and setup verification.
   *
   * @returns Promise resolving to connection test result
   */
  testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }>;

  // =========================================================================
  // CORE OPERATIONS (Required)
  // =========================================================================

  /**
   * Upload a file to storage
   *
   * @param key The storage key/path for the file
   * @param body The file content as Buffer or Readable stream
   * @param contentType MIME type of the file
   * @param metadata Optional custom metadata to store with the file
   */
  upload(
    key: string,
    body: Buffer | Readable,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<void>;

  /**
   * Download a file from storage
   *
   * @param key The storage key/path of the file
   * @returns Promise resolving to the file content as Buffer
   */
  download(key: string): Promise<Buffer>;

  /**
   * Delete a file from storage
   *
   * @param key The storage key/path of the file
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists in storage
   *
   * @param key The storage key/path to check
   * @returns Promise resolving to true if file exists, false otherwise
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get a URL that can be used to access the file through the application proxy
   *
   * This is the primary URL used by Quilltap to serve files to users.
   * It should point back to the Quilltap application, not directly to the
   * storage provider.
   *
   * @param key The storage key/path of the file
   * @returns The proxy URL for accessing the file
   */
  getProxyUrl(key: string): string;

  // =========================================================================
  // OPTIONAL OPERATIONS
  // =========================================================================

  /**
   * Copy a file from one location to another
   *
   * Only required if capabilities.copy is true
   *
   * @param sourceKey The source storage key/path
   * @param destinationKey The destination storage key/path
   */
  copy?(sourceKey: string, destinationKey: string): Promise<void>;

  /**
   * Get metadata about a stored file
   *
   * Only required if capabilities.metadata is true
   *
   * @param key The storage key/path of the file
   * @returns Promise resolving to file metadata or null if file doesn't exist
   */
  getFileMetadata?(key: string): Promise<FileMetadata | null>;

  /**
   * List files in a prefix/directory
   *
   * Only required if capabilities.list is true
   *
   * @param prefix The prefix or directory to list
   * @param maxKeys Optional maximum number of keys to return
   * @returns Promise resolving to array of keys
   */
  list?(prefix: string, maxKeys?: number): Promise<string[]>;

  /**
   * Get a presigned URL for direct access to the file
   *
   * The returned URL can be used by clients to access the file directly
   * without going through the Quilltap application, and will expire
   * after the specified time.
   *
   * Only required if capabilities.presignedUrls is true
   *
   * @param key The storage key/path of the file
   * @param expiresIn Expiration time in seconds (default 3600)
   * @returns Promise resolving to presigned URL
   */
  getPresignedUrl?(key: string, expiresIn?: number): Promise<string>;

  /**
   * Get a presigned URL for uploading a file directly
   *
   * The returned URL can be used by clients to upload a file directly
   * to storage without going through the Quilltap application.
   *
   * Only required if capabilities.presignedUrls is true
   *
   * @param key The storage key/path where the file will be stored
   * @param contentType The MIME type of the file being uploaded
   * @param expiresIn Expiration time in seconds (default 3600)
   * @returns Promise resolving to presigned upload URL
   */
  getPresignedUploadUrl?(key: string, contentType: string, expiresIn?: number): Promise<string>;

  /**
   * Get a public URL for the file
   *
   * The returned URL is permanent and requires no authentication.
   * Only call this if the file is intended to be publicly accessible.
   *
   * Only required if capabilities.publicUrls is true
   *
   * @param key The storage key/path of the file
   * @returns Promise resolving to public URL
   */
  getPublicUrl?(key: string): Promise<string>;
}

// ============================================================================
// CONFIG FIELD
// ============================================================================

/**
 * Definition of a configuration field for a file storage plugin
 *
 * Used to generate the UI form for configuring the plugin.
 */
export interface FileStorageConfigField {
  /** Field name (used as key in config object) */
  name: string;

  /** Label displayed in the UI */
  label: string;

  /** Input type for this field */
  type: 'string' | 'number' | 'boolean' | 'secret';

  /** Whether this field is required */
  required: boolean;

  /** Description or help text for the field */
  description?: string;

  /** Default value for the field */
  defaultValue?: string | number | boolean;

  /** Placeholder text for input fields */
  placeholder?: string;
}

// ============================================================================
// PLUGIN INTERFACE
// ============================================================================

/**
 * File Storage Provider Plugin Interface
 *
 * Plugins implementing this interface can provide custom file storage backends
 * to Quilltap, enabling support for different storage providers.
 *
 * @example
 * ```typescript
 * import type { FileStorageProviderPlugin, FileStorageBackend } from '@quilltap/plugin-types';
 * import { S3Client } from '@aws-sdk/client-s3';
 *
 * const s3Plugin: FileStorageProviderPlugin = {
 *   metadata: {
 *     backendId: 's3',
 *     displayName: 'Amazon S3',
 *     description: 'Store files in Amazon S3',
 *   },
 *   configSchema: [
 *     {
 *       name: 'accessKeyId',
 *       label: 'Access Key ID',
 *       type: 'secret',
 *       required: true,
 *     },
 *     // ... more fields
 *   ],
 *   createBackend: (config) => {
 *     return new S3StorageBackend(config);
 *   },
 *   validateConfig: async (config) => {
 *     // Validate configuration
 *     return { valid: true };
 *   },
 * };
 *
 * export const plugin = s3Plugin;
 * ```
 */
export interface FileStorageProviderPlugin {
  /**
   * Metadata identifying this plugin
   */
  metadata: {
    /** Unique identifier for the backend (e.g., 's3', 'gcs', 'azure') */
    backendId: string;

    /** Human-readable display name for UI */
    displayName: string;

    /** Description of what this plugin provides */
    description: string;
  };

  /**
   * Configuration schema for this plugin
   *
   * Defines the fields that users need to configure to use this storage backend.
   * Used to generate the configuration UI form.
   */
  configSchema: FileStorageConfigField[];

  /**
   * Create a backend instance with the given configuration
   *
   * @param config Configuration object from user input
   * @returns A new FileStorageBackend instance
   */
  createBackend(config: Record<string, unknown>): FileStorageBackend;

  /**
   * Validate plugin configuration
   *
   * Checks whether the provided configuration is valid for this plugin.
   * Can perform more thorough validation than what's possible with just
   * the config schema (e.g., connecting to the service to verify credentials).
   *
   * @param config Configuration object to validate
   * @returns Promise resolving to validation result
   */
  validateConfig(config: Record<string, unknown>): Promise<{ valid: boolean; errors?: string[] }>;
}

/**
 * Standard export type for file storage plugins
 *
 * This is the expected export structure from file storage plugin modules.
 *
 * @example
 * ```typescript
 * // In plugin-s3/index.ts
 * export const plugin: FileStorageProviderPlugin = { ... };
 *
 * // Or with the export type:
 * const pluginExport: FileStoragePluginExport = {
 *   plugin: { ... }
 * };
 * export default pluginExport;
 * ```
 */
export interface FileStoragePluginExport {
  /** The file storage plugin instance */
  plugin: FileStorageProviderPlugin;
}
