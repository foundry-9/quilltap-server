/**
 * File Storage Backend Interfaces
 *
 * Defines the abstraction layer for pluggable file storage backends.
 * Supports various storage providers through a consistent interface,
 * including capabilities negotiation, metadata handling, and optional features.
 *
 * @module file-storage/interfaces
 */

import type { Readable } from 'stream';

// ============================================================================
// CAPABILITIES
// ============================================================================

/**
 * File backend capabilities
 *
 * Describes which features a storage backend supports.
 * Used for capability negotiation and feature detection.
 */
export interface FileBackendCapabilities {
  /** Can generate presigned URLs for temporary access */
  presignedUrls: boolean;

  /** Can generate public URLs for permanent access */
  publicUrls: boolean;

  /** Supports streaming uploads (as opposed to buffered) */
  streamingUpload: boolean;

  /** Supports streaming downloads (as opposed to buffered) */
  streamingDownload: boolean;

  /** Supports server-side copy operations */
  copy: boolean;

  /** Supports listing objects by prefix */
  list: boolean;

  /** Supports retrieving file metadata (size, content type, modification time) */
  metadata: boolean;
}

// ============================================================================
// BACKEND METADATA
// ============================================================================

/**
 * File backend metadata
 *
 * Describes a storage backend and its capabilities.
 * Used for provider registration and UI display.
 */
export interface FileBackendMetadata {
  /** Unique identifier for the provider (e.g., 'local', 's3', 'minio') */
  providerId: string;

  /** Human-readable name for the provider (e.g., 'Amazon S3', 'MinIO Local') */
  displayName: string;

  /** Description of the provider's purpose and characteristics */
  description: string;

  /** Feature capabilities of this backend */
  capabilities: FileBackendCapabilities;
}

// ============================================================================
// FILE METADATA
// ============================================================================

/**
 * File metadata returned by storage backend
 *
 * Contains information about a stored file without the file content itself.
 */
export interface FileMetadata {
  /** Size of the file in bytes */
  size: number;

  /** MIME type of the file */
  contentType: string;

  /** Last modification timestamp */
  lastModified: Date;
}

// ============================================================================
// STORAGE BACKEND INTERFACE
// ============================================================================

/**
 * File storage backend interface
 *
 * Defines the contract for a storage backend implementation.
 * All methods should handle errors gracefully and throw descriptive exceptions.
 *
 * Core operations (required):
 * - upload: Store a file
 * - download: Retrieve a file
 * - delete: Remove a file
 * - exists: Check if a file exists
 * - getProxyUrl: Get a URL for proxied access
 *
 * Optional operations:
 * - copy: Server-side copy
 * - getFileMetadata: Retrieve file metadata
 * - list: List objects by prefix
 * - getPresignedUrl: Get temporary read-only URL
 * - getPresignedUploadUrl: Get temporary upload URL
 * - getPublicUrl: Get permanent public URL
 */
export interface FileStorageBackend {
  /**
   * Get metadata about this storage backend
   */
  getMetadata(): FileBackendMetadata;

  /**
   * Test the connection to the storage backend
   *
   * Performs a health check to verify the backend is accessible and functional.
   *
   * @returns Object with success status, message, and optional latency in milliseconds
   */
  testConnection(): Promise<{
    success: boolean;
    message: string;
    latencyMs?: number;
  }>;

  // ========================================================================
  // CORE OPERATIONS (REQUIRED)
  // ========================================================================

  /**
   * Upload a file to storage
   *
   * Stores a file at the specified key with the given content and metadata.
   *
   * @param key - Storage key/path for the file
   * @param body - File content as Buffer or Readable stream
   * @param contentType - MIME type of the file
   * @param metadata - Optional custom metadata/headers to store with the file
   * @throws {Error} If upload fails (network, permissions, storage full, etc.)
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
   * Retrieves the complete file content as a Buffer.
   *
   * @param key - Storage key/path of the file
   * @returns File content as a Buffer
   * @throws {Error} If file not found or download fails
   */
  download(key: string): Promise<Buffer>;

  /**
   * Delete a file from storage
   *
   * Removes the file at the specified key.
   * Should succeed silently if file does not exist (idempotent).
   *
   * @param key - Storage key/path of the file
   * @throws {Error} If deletion fails (permissions, etc.)
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists in storage
   *
   * Tests whether a file is present at the specified key.
   *
   * @param key - Storage key/path to check
   * @returns True if file exists, false otherwise
   * @throws {Error} If the check fails (network issues, permissions, etc.)
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get a proxy URL for accessing the file
   *
   * Returns a URL that the application can use to proxy access to the file.
   * This URL is used internally by the application to fetch file content
   * without exposing direct storage URLs to the client.
   *
   * For local storage, this might return a file:// URL or local path.
   * For S3, this might return a presigned URL or a proxy endpoint.
   *
   * @param key - Storage key/path of the file
   * @returns URL for proxied access
   */
  getProxyUrl(key: string): string;

  // ========================================================================
  // OPTIONAL OPERATIONS
  // ========================================================================

  /**
   * Copy a file server-side
   *
   * Copies a file from source to destination within the same storage backend.
   * Only available if capabilities.copy is true.
   *
   * @param sourceKey - Storage key of the source file
   * @param destinationKey - Storage key for the destination file
   * @throws {Error} If copy fails
   */
  copy?(sourceKey: string, destinationKey: string): Promise<void>;

  /**
   * Get metadata about a stored file
   *
   * Retrieves information about the file without downloading its content.
   * Only available if capabilities.metadata is true.
   *
   * @param key - Storage key of the file
   * @returns File metadata (size, contentType, lastModified) or null if not found
   * @throws {Error} If metadata retrieval fails
   */
  getFileMetadata?(key: string): Promise<FileMetadata | null>;

  /**
   * List files with a given prefix
   *
   * Lists all files whose keys start with the specified prefix.
   * Only available if capabilities.list is true.
   *
   * @param prefix - Key prefix to match
   * @param maxKeys - Maximum number of keys to return (optional)
   * @returns Array of matching file keys
   * @throws {Error} If listing fails
   */
  list?(prefix: string, maxKeys?: number): Promise<string[]>;

  // ========================================================================
  // URL GENERATION (OPTIONAL)
  // ========================================================================

  /**
   * Get a presigned URL for temporary read access
   *
   * Generates a temporary, time-limited URL that grants read access to the file.
   * Only available if capabilities.presignedUrls is true.
   *
   * @param key - Storage key of the file
   * @param expiresIn - URL expiration time in seconds (default: 3600)
   * @returns Presigned URL for temporary access
   * @throws {Error} If URL generation fails
   */
  getPresignedUrl?(key: string, expiresIn?: number): Promise<string>;

  /**
   * Get a presigned URL for temporary upload access
   *
   * Generates a temporary, time-limited URL that grants upload rights for the specified key.
   * Only available if capabilities.presignedUrls is true.
   *
   * @param key - Storage key where file will be uploaded
   * @param contentType - Expected MIME type of the uploaded file
   * @param expiresIn - URL expiration time in seconds (default: 3600)
   * @returns Presigned upload URL
   * @throws {Error} If URL generation fails
   */
  getPresignedUploadUrl?(
    key: string,
    contentType: string,
    expiresIn?: number
  ): Promise<string>;

  /**
   * Get a public URL for permanent access
   *
   * Generates a permanent, publicly-accessible URL for the file.
   * Only available if capabilities.publicUrls is true.
   *
   * @param key - Storage key of the file
   * @returns Public URL for access
   * @throws {Error} If URL generation fails
   */
  getPublicUrl?(key: string): Promise<string>;
}

// ============================================================================
// PLUGIN INTERFACE
// ============================================================================

/**
 * Configuration field definition for provider setup
 *
 * Describes a configuration parameter that a provider plugin requires.
 */
export interface ProviderConfigField {
  /** Unique identifier for this config field */
  name: string;

  /** Display label for the field (e.g., "AWS Region") */
  label: string;

  /** Type of the configuration value */
  type: 'string' | 'number' | 'boolean' | 'password';

  /** Whether this field is required */
  required: boolean;

  /** Description or help text for the field */
  description?: string;

  /** Default value for the field */
  defaultValue?: string | number | boolean;

  /** Placeholder text for input fields */
  placeholder?: string;
}

/**
 * File storage provider plugin interface
 *
 * Defines the contract for plugins that provide file storage backend implementations.
 * Plugins are responsible for configuration validation, backend instantiation,
 * and describing their capabilities.
 */
export interface FileStorageProviderPlugin {
  /**
   * Metadata about this storage provider plugin
   */
  metadata: {
    /** Unique backend identifier (e.g., 's3', 'local', 'minio') */
    backendId: string;

    /** Display name for the provider */
    displayName: string;

    /** Description of the provider */
    description: string;
  };

  /**
   * Configuration schema
   *
   * Describes the configuration fields this provider requires.
   * Used to generate setup forms and validate configuration.
   */
  configSchema: ProviderConfigField[];

  /**
   * Create a storage backend instance
   *
   * Instantiates a FileStorageBackend with the provided configuration.
   * The configuration should have been validated before calling this method.
   *
   * @param config - Validated configuration object for the backend
   * @returns An initialized FileStorageBackend instance
   * @throws {Error} If backend creation fails due to bad configuration
   */
  createBackend(config: Record<string, unknown>): FileStorageBackend;

  /**
   * Validate a configuration object
   *
   * Checks that the provided configuration is valid for this provider.
   * Should verify that all required fields are present, have correct types,
   * and any cross-field constraints are satisfied.
   *
   * @param config - Configuration object to validate
   * @returns Validation result with status and optional error messages
   */
  validateConfig(
    config: Record<string, unknown>
  ): Promise<{
    valid: boolean;
    errors?: string[];
  }>;
}
