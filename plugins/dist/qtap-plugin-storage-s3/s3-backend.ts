/**
 * S3 File Storage Backend Implementation
 *
 * Implements the FileStorageBackend interface for Amazon S3 and S3-compatible services.
 * Supports presigned URLs, public URLs, streaming uploads/downloads, and server-side operations.
 *
 * @module s3-backend
 */

import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import type {
  FileStorageBackend,
  FileBackendMetadata,
  FileMetadata,
} from '@quilltap/plugin-types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for the S3 file storage backend
 */
interface S3BackendConfig {
  /** S3 bucket name */
  bucket: string;
  /** AWS region or custom endpoint region */
  region: string;
  /** Custom S3-compatible endpoint URL (e.g., MinIO, DigitalOcean Spaces) */
  endpoint?: string;
  /** AWS access key ID (optional - uses IAM role if not provided) */
  accessKey?: string;
  /** AWS secret access key (optional - uses IAM role if not provided) */
  secretKey?: string;
  /** Optional prefix for all object keys */
  pathPrefix?: string;
  /** Force path-style URLs (required for some S3-compatible services) */
  forcePathStyle?: boolean;
  /** Custom public/CDN URL for file access */
  publicUrl?: string;
}

// ============================================================================
// S3 BACKEND IMPLEMENTATION
// ============================================================================

/**
 * S3 file storage backend
 *
 * Stores files in Amazon S3 or S3-compatible services with features:
 * - Streaming upload and download support
 * - Presigned URLs for temporary access
 * - Public URLs with optional CDN support
 * - Server-side copy operations
 * - File metadata retrieval
 * - Object listing with prefix matching
 */
export class S3FileStorageBackend implements FileStorageBackend {
  private client: S3Client;
  private bucket: string;
  private pathPrefix: string;
  private publicUrl?: string;
  private forcePathStyle: boolean;

  /**
   * Initialize the S3 file storage backend
   *
   * @param config - S3 configuration object
   * @throws {Error} If required configuration is missing
   */
  constructor(config: S3BackendConfig) {
    if (!config.bucket) {
      throw new Error('S3 backend requires bucket name');
    }

    this.bucket = config.bucket;
    this.pathPrefix = config.pathPrefix ? config.pathPrefix.replace(/\/$/, '') : '';
    this.publicUrl = config.publicUrl;
    this.forcePathStyle = config.forcePathStyle ?? false;

    // Initialize S3 client with configuration
    const s3Config: any = {
      region: config.region || 'us-east-1',
      forcePathStyle: this.forcePathStyle,
    };

    // Add custom endpoint if provided (for MinIO, DigitalOcean Spaces, etc.)
    if (config.endpoint) {
      s3Config.endpoint = config.endpoint;
    }

    // Add credentials if provided, otherwise use IAM role
    if (config.accessKey && config.secretKey) {
      s3Config.credentials = {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      };
    }

    this.client = new S3Client(s3Config);
  }

  // ========================================================================
  // UTILITIES
  // ========================================================================

  /**
   * Build a full key with optional path prefix
   */
  private buildKey(key: string): string {
    if (this.pathPrefix) {
      return `${this.pathPrefix}/${key}`;
    }
    return key;
  }

  /**
   * Convert a stream to a buffer
   */
  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => {
        // Use type assertion to avoid TypeScript compatibility issue with Buffer.concat
        resolve(Buffer.concat(chunks as any));
      });
    });
  }

  // ========================================================================
  // METADATA
  // ========================================================================

  /**
   * Get metadata about this storage backend
   */
  getMetadata(): FileBackendMetadata {
    return {
      providerId: 's3',
      displayName: 'Amazon S3 / S3-Compatible',
      description: 'Store files in Amazon S3 or S3-compatible storage (MinIO, DigitalOcean Spaces, etc.)',
      capabilities: {
        presignedUrls: true,
        publicUrls: true,
        streamingUpload: true,
        streamingDownload: true,
        copy: true,
        list: true,
        metadata: true,
      },
    };
  }

  /**
   * Test the connection to S3
   */
  async testConnection(): Promise<{
    success: boolean;
    message: string;
    latencyMs?: number;
  }> {
    try {
      const startTime = Date.now();

      // Try to list objects with a limit of 1 to test connectivity
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          MaxKeys: 1,
        })
      );

      const latencyMs = Date.now() - startTime;

      return {
        success: true,
        message: `Connected to S3 bucket "${this.bucket}"`,
        latencyMs,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to connect to S3: ${error.message}`,
      };
    }
  }

  // ========================================================================
  // CORE OPERATIONS
  // ========================================================================

  /**
   * Upload a file to S3
   */
  async upload(
    key: string,
    body: Buffer | Readable,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    const fullKey = this.buildKey(key);
    const body_content = body instanceof Readable ? await this.streamToBuffer(body) : body;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: fullKey,
          Body: body_content,
          ContentType: contentType,
          Metadata: metadata,
        })
      );
    } catch (error: any) {
      throw new Error(`S3 upload failed for "${key}": ${error.message}`);
    }
  }

  /**
   * Download a file from S3
   */
  async download(key: string): Promise<Buffer> {
    const fullKey = this.buildKey(key);

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: fullKey,
        })
      );

      if (!response.Body) {
        throw new Error('No body in response');
      }

      // Convert the response body stream to buffer
      return await this.streamToBuffer(response.Body as Readable);
    } catch (error: any) {
      throw new Error(`S3 download failed for "${key}": ${error.message}`);
    }
  }

  /**
   * Delete a file from S3
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.buildKey(key);

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: fullKey,
        })
      );
    } catch (error: any) {
      throw new Error(`S3 delete failed for "${key}": ${error.message}`);
    }
  }

  /**
   * Check if a file exists in S3
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.buildKey(key);

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: fullKey,
        })
      );
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw new Error(`S3 exists check failed for "${key}": ${error.message}`);
    }
  }

  /**
   * Get a proxy URL for accessing the file
   */
  getProxyUrl(key: string): string {
    const fullKey = this.buildKey(key);
    // For proxy URLs, we typically return a presigned URL or internal API endpoint
    // This would be the internal proxy endpoint
    return `/api/v1/files/${key}`;
  }

  // ========================================================================
  // OPTIONAL OPERATIONS
  // ========================================================================

  /**
   * Copy a file server-side
   */
  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const sourceFullKey = this.buildKey(sourceKey);
    const destFullKey = this.buildKey(destinationKey);

    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${sourceFullKey}`,
          Key: destFullKey,
        })
      );
    } catch (error: any) {
      throw new Error(
        `S3 copy failed from "${sourceKey}" to "${destinationKey}": ${error.message}`
      );
    }
  }

  /**
   * Get file metadata from S3
   */
  async getFileMetadata(key: string): Promise<FileMetadata | null> {
    const fullKey = this.buildKey(key);

    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: fullKey,
        })
      );

      return {
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
        lastModified: response.LastModified ?? new Date(),
      };
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw new Error(`S3 metadata retrieval failed for "${key}": ${error.message}`);
    }
  }

  /**
   * List files with a given prefix
   */
  async list(prefix: string, maxKeys?: number): Promise<string[]> {
    const fullPrefix = this.buildKey(prefix);

    try {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: fullPrefix,
          MaxKeys: maxKeys || 1000,
        })
      );

      // Strip the pathPrefix from the returned keys
      const keys = (response.Contents ?? [])
        .map((obj) => obj.Key!)
        .filter((key) => key !== fullPrefix) // Filter out the prefix itself if it's a "file"
        .map((key) => {
          // Remove the path prefix from the key for return
          if (this.pathPrefix && key.startsWith(this.pathPrefix + '/')) {
            return key.substring(this.pathPrefix.length + 1);
          }
          return key;
        });

      return keys;
    } catch (error: any) {
      throw new Error(`S3 list operation failed for prefix "${prefix}": ${error.message}`);
    }
  }

  /**
   * Get a presigned URL for temporary read access
   */
  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const fullKey = this.buildKey(key);

    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: fullKey,
        }),
        { expiresIn }
      );

      return url;
    } catch (error: any) {
      throw new Error(`S3 presigned URL generation failed for "${key}": ${error.message}`);
    }
  }

  /**
   * Get a presigned URL for temporary upload access
   */
  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600
  ): Promise<string> {
    const fullKey = this.buildKey(key);

    try {
      const url = await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: fullKey,
          ContentType: contentType,
        }),
        { expiresIn }
      );

      return url;
    } catch (error: any) {
      throw new Error(
        `S3 presigned upload URL generation failed for "${key}": ${error.message}`
      );
    }
  }

  /**
   * Get a public URL for permanent access
   */
  async getPublicUrl(key: string): Promise<string> {
    const fullKey = this.buildKey(key);

    // If a custom public URL is provided, use it
    if (this.publicUrl) {
      return `${this.publicUrl}/${fullKey}`;
    }

    // Otherwise, construct the standard S3 URL
    // This assumes the bucket is publicly accessible
    const region = (this.client.config.region as string) || 'us-east-1';
    const endpointConfig = this.client.config.endpoint as string | undefined;
    const defaultEndpoint = `https://s3.${region}.amazonaws.com`;
    const endpoint = endpointConfig || defaultEndpoint;

    if (this.forcePathStyle) {
      // Path-style URL: https://s3.region.amazonaws.com/bucket/key
      return `${endpoint}/${this.bucket}/${fullKey}`;
    } else {
      // Virtual-hosted-style URL: https://bucket.s3.region.amazonaws.com/key
      return `${endpoint.replace('s3.', `${this.bucket}.s3.`)}/${fullKey}`;
    }
  }
}
