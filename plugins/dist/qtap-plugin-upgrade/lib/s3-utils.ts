/**
 * S3 Utilities for Upgrade Plugin Migrations
 *
 * This module provides S3 functionality specifically for migrations.
 * It's embedded in the upgrade plugin because migrations run before plugins are loaded,
 * so we can't depend on the S3 storage plugin being available.
 */

import { z } from 'zod';
import {
  S3Client,
  S3ClientConfig,
  HeadBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

/**
 * S3 storage mode type
 */
export type S3Mode = 'embedded' | 'external' | 'disabled';

/**
 * S3 Configuration Interface
 */
export interface S3Config {
  mode: S3Mode;
  endpoint?: string;
  region: string;
  accessKey?: string;
  secretKey?: string;
  bucket: string;
  pathPrefix?: string;
  publicUrl?: string;
  forcePathStyle: boolean;
  isConfigured: boolean;
  errors: string[];
}

/**
 * Zod schema for S3 configuration validation
 */
const s3ConfigSchema = z.object({
  mode: z.enum(['embedded', 'external', 'disabled']),
  endpoint: z.string().url().optional(),
  region: z.string().min(1, 'S3 region is required'),
  accessKey: z.string().optional(),
  secretKey: z.string().optional(),
  bucket: z.string().min(1, 'S3 bucket name is required'),
  pathPrefix: z.string().optional(),
  publicUrl: z.string().url().optional(),
  forcePathStyle: z.boolean(),
});

/**
 * Singleton S3 client instance
 */
let s3Client: S3Client | null = null;

/**
 * Validates S3 configuration from environment variables
 */
export function validateS3Config(): S3Config {
  const modeEnv = process.env.S3_MODE || 'disabled';
  const errors: string[] = [];

  // Validate mode is valid
  if (modeEnv !== 'embedded' && modeEnv !== 'external' && modeEnv !== 'disabled') {
    return {
      mode: 'disabled',
      region: 'us-east-1',
      bucket: '',
      forcePathStyle: false,
      isConfigured: false,
      errors: [`Invalid S3_MODE="${modeEnv}". Must be "embedded", "external", or "disabled".`],
    };
  }

  const mode: S3Mode = modeEnv as S3Mode;

  // If disabled, return early
  if (mode === 'disabled') {
    return {
      mode,
      region: 'us-east-1',
      bucket: '',
      forcePathStyle: false,
      isConfigured: false,
      errors: ['S3 storage is disabled'],
    };
  }

  // Extract configuration values from environment
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || 'us-east-1';
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET || 'quilltap-files';
  const pathPrefix = process.env.S3_PATH_PREFIX;
  const publicUrl = process.env.S3_PUBLIC_URL;
  const forcePathStyle = endpoint ? true : process.env.S3_FORCE_PATH_STYLE === 'true';

  // Only require explicit credentials when using a custom endpoint (MinIO)
  if (endpoint) {
    if (!accessKey) {
      errors.push('S3_ACCESS_KEY is required when using S3_ENDPOINT');
    }
    if (!secretKey) {
      errors.push('S3_SECRET_KEY is required when using S3_ENDPOINT');
    }
  }

  // Build configuration object
  const configData = {
    mode,
    endpoint: endpoint || undefined,
    region,
    accessKey: accessKey || undefined,
    secretKey: secretKey || undefined,
    bucket,
    pathPrefix: pathPrefix || undefined,
    publicUrl: publicUrl || undefined,
    forcePathStyle,
  };

  // If custom validation errors exist, return early
  if (errors.length > 0) {
    return {
      ...configData,
      isConfigured: false,
      errors,
    };
  }

  // Validate with Zod schema
  try {
    const validated = s3ConfigSchema.parse(configData);
    return {
      ...validated,
      isConfigured: true,
      errors: [],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      errors.push(...error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
    } else {
      errors.push(error instanceof Error ? error.message : 'Unknown validation error');
    }
    return {
      ...configData,
      isConfigured: false,
      errors,
    };
  }
}

/**
 * Test S3 connection by attempting to access the configured bucket
 */
export async function testS3Connection(): Promise<{
  success: boolean;
  message: string;
  latencyMs?: number;
}> {
  const config = validateS3Config();

  if (!config.isConfigured) {
    return {
      success: false,
      message: `S3 configuration is invalid: ${config.errors.join('; ')}`,
    };
  }

  try {
    const clientConfig: S3ClientConfig = {
      region: config.region,
      ...(config.accessKey && config.secretKey && {
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey,
        },
      }),
      ...(config.endpoint && {
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
      }),
    };

    const testClient = new S3Client(clientConfig);
    const startTime = Date.now();

    try {
      const command = new HeadBucketCommand({ Bucket: config.bucket });
      await testClient.send(command);

      const latencyMs = Date.now() - startTime;
      return {
        success: true,
        message: `Successfully connected to S3 bucket "${config.bucket}"`,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (error instanceof Error) {
        const errorName = error.name;

        if (errorName === 'NotFound') {
          return {
            success: false,
            message: `S3 bucket "${config.bucket}" does not exist or is not accessible`,
            latencyMs,
          };
        }

        if (errorName === 'Forbidden') {
          return {
            success: false,
            message: `Access denied to S3 bucket "${config.bucket}". Check credentials and bucket permissions`,
            latencyMs,
          };
        }

        if (errorName === 'InvalidAccessKeyId' || errorName === 'SignatureDoesNotMatch') {
          return {
            success: false,
            message: 'Invalid S3 credentials (access key or secret key)',
            latencyMs,
          };
        }

        return {
          success: false,
          message: `S3 connection test failed: ${error.message}`,
          latencyMs,
        };
      }

      return {
        success: false,
        message: 'S3 connection test failed with unknown error',
        latencyMs,
      };
    } finally {
      testClient.destroy();
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to initialize S3 client: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get or create the singleton S3 client
 */
export function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  const config = validateS3Config();

  if (!config.isConfigured) {
    throw new Error(`S3 configuration is invalid: ${config.errors.join('; ')}`);
  }

  const clientConfig: S3ClientConfig = {
    region: config.region,
  };

  if (config.accessKey && config.secretKey) {
    clientConfig.credentials = {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    };
  }

  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
    clientConfig.forcePathStyle = config.forcePathStyle;
  }

  s3Client = new S3Client(clientConfig);
  return s3Client;
}

/**
 * Get the configured S3 bucket name
 */
export function getS3Bucket(): string {
  const config = validateS3Config();
  if (!config.bucket) {
    throw new Error('S3 bucket not configured');
  }
  return config.bucket;
}

/**
 * Parameters for building an S3 key
 */
export interface BuildS3KeyParams {
  userId: string;
  fileId: string;
  filename: string;
  projectId?: string | null;
  folderPath?: string;
}

/**
 * Sanitize filename for S3 key
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Normalize a folder path for use in S3 keys
 */
function normalizeS3FolderPath(folderPath: string | undefined): string {
  if (!folderPath || folderPath === '/') {
    return '';
  }
  return folderPath.replace(/^\//, '');
}

/**
 * Build a properly formatted S3 key path for storing files
 */
export function buildS3Key(params: BuildS3KeyParams): string {
  const { userId, fileId, filename, projectId, folderPath } = params;

  const config = validateS3Config();
  const prefix = config.pathPrefix || '';
  const safeFilename = sanitizeFilename(filename);
  const normalizedFolder = normalizeS3FolderPath(folderPath);

  if (projectId) {
    return `${prefix}users/${userId}/${projectId}/${normalizedFolder}${fileId}_${safeFilename}`;
  }
  return `${prefix}users/${userId}/_general/${fileId}_${safeFilename}`;
}

/**
 * Upload a file to S3
 */
export async function uploadFile(
  key: string,
  body: Buffer | Readable,
  contentType: string,
  metadata?: Record<string, string>
): Promise<void> {
  const client = getS3Client();
  const bucket = getS3Bucket();

  // Sanitize metadata for HTTP headers
  const sanitizedMetadata = metadata
    ? Object.fromEntries(
        Object.entries(metadata).map(([k, v]) =>
          /[^\x00-\x7F]/.test(v)
            ? [k, `base64:${Buffer.from(v, 'utf-8').toString('base64')}`]
            : [k, v]
        )
      )
    : undefined;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: sanitizedMetadata,
  });

  await client.send(command);
}

/**
 * Delete a file from S3
 */
export async function deleteFile(key: string): Promise<void> {
  const client = getS3Client();
  const bucket = getS3Bucket();

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await client.send(command);
}

/**
 * Copy a file within S3 from one key to another
 */
export async function copyObject(sourceKey: string, destinationKey: string): Promise<void> {
  const client = getS3Client();
  const bucket = getS3Bucket();

  const command = new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${sourceKey}`,
    Key: destinationKey,
  });

  await client.send(command);
}

/**
 * Check if a file exists in S3
 */
export async function fileExists(key: string): Promise<boolean> {
  const client = getS3Client();
  const bucket = getS3Bucket();

  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await client.send(command);
    return true;
  } catch (error) {
    const err = error as any;

    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }

    throw error;
  }
}
