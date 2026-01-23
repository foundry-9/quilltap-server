/**
 * S3 File Storage Plugin
 *
 * Provides Amazon S3 and S3-compatible storage backend for Quilltap.
 * Supports presigned URLs, public URLs, streaming uploads/downloads,
 * server-side copy operations, and more.
 *
 * @module qtap-plugin-storage-s3
 */

import type {
  FileStorageProviderPlugin,
  FileStoragePluginExport,
  FileStorageConfigField,
} from '@quilltap/plugin-types';
import { S3FileStorageBackend } from './s3-backend';

/**
 * Plugin metadata and configuration
 */
const plugin: FileStorageProviderPlugin = {
  metadata: {
    backendId: 's3',
    displayName: 'Amazon S3 / S3-Compatible',
    description:
      'Store files in Amazon S3 or S3-compatible storage like MinIO, DigitalOcean Spaces, Backblaze B2, Wasabi, etc.',
  },

  configSchema: [
    {
      name: 'bucket',
      label: 'Bucket Name',
      type: 'string',
      required: true,
      description: 'The S3 bucket name where files will be stored',
      placeholder: 'my-quilltap-bucket',
    },
    {
      name: 'region',
      label: 'Region',
      type: 'string',
      required: false,
      defaultValue: 'us-east-1',
      description: 'AWS region (e.g., us-east-1, eu-west-1, ap-southeast-1)',
      placeholder: 'us-east-1',
    },
    {
      name: 'endpoint',
      label: 'Custom Endpoint URL',
      type: 'string',
      required: false,
      description:
        'For S3-compatible services like MinIO, DigitalOcean Spaces, etc. Leave empty for AWS S3.',
      placeholder: 'https://minio.example.com:9000',
    },
    {
      name: 'accessKey',
      label: 'Access Key ID',
      type: 'secret',
      required: false,
      description: 'AWS access key or S3-compatible service API key. Leave empty to use IAM role auth.',
      placeholder: 'AKIAIOSFODNN7EXAMPLE',
    },
    {
      name: 'secretKey',
      label: 'Secret Access Key',
      type: 'secret',
      required: false,
      description: 'AWS secret key or S3-compatible service secret key.',
      placeholder: '••••••••••••••••••••••••••••••••••••••••',
    },
    {
      name: 'pathPrefix',
      label: 'Path Prefix',
      type: 'string',
      required: false,
      description: 'Optional prefix for all object keys (e.g., "quilltap/files" stores files under that prefix)',
      placeholder: 'quilltap/files',
    },
    {
      name: 'forcePathStyle',
      label: 'Force Path Style URLs',
      type: 'boolean',
      required: false,
      defaultValue: false,
      description:
        'Use path-style URLs (required for some S3-compatible services like MinIO without virtual host)',
    },
    {
      name: 'publicUrl',
      label: 'Public/CDN URL',
      type: 'string',
      required: false,
      description:
        'Custom public URL or CDN distribution URL for serving files. If not set, standard S3 URLs will be used.',
      placeholder: 'https://cdn.example.com',
    },
  ] as FileStorageConfigField[],

  /**
   * Create a backend instance with the provided configuration
   */
  createBackend(config: Record<string, unknown>) {
    return new S3FileStorageBackend({
      bucket: config.bucket as string,
      region: (config.region as string) || 'us-east-1',
      endpoint: config.endpoint as string | undefined,
      accessKey: config.accessKey as string | undefined,
      secretKey: config.secretKey as string | undefined,
      pathPrefix: config.pathPrefix as string | undefined,
      forcePathStyle: (config.forcePathStyle as boolean) || false,
      publicUrl: config.publicUrl as string | undefined,
    });
  },

  /**
   * Validate configuration before using it
   */
  async validateConfig(config: Record<string, unknown>) {
    const errors: string[] = [];

    // Bucket is required
    if (!config.bucket || typeof config.bucket !== 'string') {
      errors.push('Bucket name is required');
    } else if (config.bucket.length < 3) {
      errors.push('Bucket name must be at least 3 characters');
    }

    // Validate credentials: if one is provided, both must be
    const hasAccessKey = config.accessKey && typeof config.accessKey === 'string';
    const hasSecretKey = config.secretKey && typeof config.secretKey === 'string';

    if ((hasAccessKey && !hasSecretKey) || (!hasAccessKey && hasSecretKey)) {
      errors.push('Both Access Key and Secret Key must be provided together, or both left empty to use IAM role');
    }

    // Validate endpoint URL if provided
    if (config.endpoint && typeof config.endpoint === 'string') {
      try {
        new URL(config.endpoint);
      } catch {
        errors.push('Endpoint must be a valid URL (e.g., https://minio.example.com:9000)');
      }
    }

    // Validate public URL if provided
    if (config.publicUrl && typeof config.publicUrl === 'string') {
      try {
        new URL(config.publicUrl);
      } catch {
        errors.push('Public URL must be a valid URL');
      }
    }

    // Validate region if provided
    if (config.region && typeof config.region !== 'string') {
      errors.push('Region must be a string');
    }

    // Validate pathPrefix if provided (should not start with /)
    if (config.pathPrefix && typeof config.pathPrefix === 'string') {
      if (config.pathPrefix.startsWith('/')) {
        errors.push('Path prefix should not start with /');
      }
    }

    // Validate forcePathStyle if provided
    if (config.forcePathStyle !== undefined && typeof config.forcePathStyle !== 'boolean') {
      errors.push('Force Path Style must be a boolean');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
};

/**
 * Export the plugin with standard plugin export format
 */
export { plugin };

export default {
  plugin,
} satisfies FileStoragePluginExport;
