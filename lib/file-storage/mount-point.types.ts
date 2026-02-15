/**
 * Mount Point Type Definitions
 *
 * Contains schemas for storage mount points, supporting multiple backend types
 * (local filesystem, S3, and plugin-provided backends) with encrypted secret
 * management and health tracking.
 *
 * @module file-storage/mount-point.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
} from '../schemas/common.types';

// ============================================================================
// MOUNT POINT ENUMS
// ============================================================================

export const MountPointBackendTypeEnum = z.enum(['local', 's3']);
export type MountPointBackendType = z.infer<typeof MountPointBackendTypeEnum>;

export const MountPointScopeEnum = z.enum(['system', 'user']);
export type MountPointScope = z.infer<typeof MountPointScopeEnum>;

export const HealthStatusEnum = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']);
export type HealthStatus = z.infer<typeof HealthStatusEnum>;

// ============================================================================
// BACKEND-SPECIFIC CONFIG SCHEMAS
// ============================================================================

/**
 * Local filesystem backend configuration
 */
export const LocalBackendConfigSchema = z.object({
  basePath: z.string().min(1, 'Base path is required'),
});

export type LocalBackendConfig = z.infer<typeof LocalBackendConfigSchema>;

/**
 * S3-compatible backend configuration
 *
 * Note: accessKey and secretKey are stored encrypted in the encryptedSecrets field,
 * not in this schema to prevent accidental exposure.
 */
export const S3BackendConfigSchema = z.object({
  bucket: z.string().min(1, 'Bucket name is required'),
  region: z.string().default('us-east-1'),
  endpoint: z.url('Endpoint must be a valid URL').optional(),
  pathPrefix: z.string().optional(),
  forcePathStyle: z.boolean().default(false),
  publicUrl: z.url('Public URL must be a valid URL').optional(),
});

export type S3BackendConfig = z.infer<typeof S3BackendConfigSchema>;

// ============================================================================
// MOUNT POINT SCHEMA
// ============================================================================

/**
 * Storage mount point configuration
 *
 * Represents a configured storage backend (local, S3, or plugin-provided).
 * Supports multiple scopes (system-wide or per-user) with health monitoring
 * and secret encryption.
 */
export const MountPointSchema = z.object({
  // Identity
  id: UUIDSchema,
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  description: z.string().max(500, 'Description must be 500 characters or less').nullish(),

  // Backend configuration
  backendType: z.string().min(1, 'Backend type is required'),
  backendConfig: z.record(z.string(), z.unknown()),
  encryptedSecrets: z.string().nullish(),

  // Scope and ownership
  scope: MountPointScopeEnum,
  userId: UUIDSchema.nullish(),

  // Default mount point flag
  isDefault: z.boolean().default(false),

  // Status
  enabled: z.boolean().default(true),
  healthStatus: HealthStatusEnum.default('unknown'),
  lastHealthCheck: TimestampSchema.nullable().optional(),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type MountPoint = z.infer<typeof MountPointSchema>;

// ============================================================================
// VALIDATION UNIONS
// ============================================================================

/**
 * Union type for backend-specific configs
 * Can be extended with additional backend types from plugins
 */
export const BackendConfigUnionSchema = z.union([
  LocalBackendConfigSchema,
  S3BackendConfigSchema,
  z.record(z.string(), z.unknown()), // Fallback for plugin-provided backends
]);

export type BackendConfigUnion = z.infer<typeof BackendConfigUnionSchema>;
