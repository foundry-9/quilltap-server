/**
 * Sync System Types
 *
 * Zod schemas and TypeScript types for the Quilltap Sync API.
 * These define the data structures for synchronizing data between
 * Quilltap instances.
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  EncryptedFieldSchema,
  SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
} from '@/lib/schemas/types';

// Re-export version constants for convenience
export { SCHEMA_VERSION, SYNC_PROTOCOL_VERSION };

/**
 * File size threshold for inline content vs streaming.
 * Files smaller than this are included as base64 in deltas.
 * Files larger require a separate content fetch.
 */
export const FILE_CONTENT_SIZE_THRESHOLD = 1024 * 1024; // 1MB

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Entity types that can be synchronized between instances.
 * Connection profiles sync metadata only (API keys are stripped, replaced with _apiKeyLabel).
 */
export const SyncableEntityTypeEnum = z.enum([
  // Sync order is enforced - entities with dependencies come after their dependencies
  'TAG', // No dependencies
  'FILE', // Depends on TAG (for tags[])
  'PROJECT', // No dependencies (characterRoster reconciled after CHARACTER)
  'CONNECTION_PROFILE', // Depends on TAG (for tags[]); apiKeyId stripped, _apiKeyLabel added
  'PERSONA', // Depends on TAG
  'CHARACTER', // Depends on TAG, FILE (for defaultImageId), PERSONA (for personaLinks)
  'ROLEPLAY_TEMPLATE', // Depends on TAG
  'PROMPT_TEMPLATE', // Depends on TAG
  'CHAT', // Depends on CHARACTER, PERSONA, TAG, FILE, ROLEPLAY_TEMPLATE, PROJECT
  'MEMORY', // Depends on CHARACTER, PERSONA, CHAT, TAG
]);
export type SyncableEntityType = z.infer<typeof SyncableEntityTypeEnum>;

/**
 * Status of a sync operation
 */
export const SyncStatusEnum = z.enum(['SUCCESS', 'PARTIAL', 'FAILED']);
export type SyncStatus = z.infer<typeof SyncStatusEnum>;

/**
 * Status of a sync operation in progress
 */
export const SyncOperationStatusEnum = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED']);
export type SyncOperationStatus = z.infer<typeof SyncOperationStatusEnum>;

/**
 * Direction of sync operation
 */
export const SyncDirectionEnum = z.enum(['PUSH', 'PULL', 'BIDIRECTIONAL']);
export type SyncDirection = z.infer<typeof SyncDirectionEnum>;

/**
 * Conflict resolution outcome
 */
export const ConflictResolutionEnum = z.enum(['LOCAL_WINS', 'REMOTE_WINS']);
export type ConflictResolution = z.infer<typeof ConflictResolutionEnum>;

// ============================================================================
// SYNC INSTANCE
// ============================================================================

/**
 * Configuration for a remote Quilltap instance to sync with.
 * The apiKey is stored encrypted at rest.
 */
export const SyncInstanceSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string().min(1).max(100),
  url: z.string().url(),
  // API key for authenticating to the remote instance (encrypted at rest)
  apiKey: EncryptedFieldSchema,
  // Remote user ID received after successful authentication
  remoteUserId: UUIDSchema.nullable().optional(),
  isActive: z.boolean().default(true),
  // Last successful sync timestamp
  lastSyncAt: TimestampSchema.nullable().optional(),
  lastSyncStatus: SyncStatusEnum.nullable().optional(),
  // Remote instance version info (cached from last handshake)
  schemaVersion: z.string().nullable().optional(),
  appVersion: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type SyncInstance = z.infer<typeof SyncInstanceSchema>;

/**
 * Data required to create a new sync instance
 */
export const CreateSyncInstanceSchema = SyncInstanceSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  remoteUserId: true,
  lastSyncAt: true,
  lastSyncStatus: true,
  schemaVersion: true,
  appVersion: true,
});
export type CreateSyncInstance = z.infer<typeof CreateSyncInstanceSchema>;

// ============================================================================
// SYNC MAPPING
// ============================================================================

/**
 * Permanent UUID mapping between local and remote entities.
 * This ensures that "character X locally" always maps to "character X remotely"
 * across all sync operations.
 */
export const SyncMappingSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  instanceId: UUIDSchema, // Which remote instance this mapping is for
  entityType: SyncableEntityTypeEnum,
  localId: UUIDSchema, // Local entity UUID
  remoteId: UUIDSchema, // Remote entity UUID
  // Track when this mapping was last synced
  lastSyncedAt: TimestampSchema,
  // Track the updatedAt from both sides to detect changes
  lastLocalUpdatedAt: TimestampSchema,
  lastRemoteUpdatedAt: TimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type SyncMapping = z.infer<typeof SyncMappingSchema>;

/**
 * Data required to create a new sync mapping
 */
export const CreateSyncMappingSchema = SyncMappingSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateSyncMapping = z.infer<typeof CreateSyncMappingSchema>;

// ============================================================================
// SYNC PROGRESS
// ============================================================================

/**
 * Phases of a sync operation
 */
export const SyncPhaseEnum = z.enum([
  'HANDSHAKE',
  'PULL',
  'FETCH_FILES',
  'PUSH',
  'COMPLETE',
  'ERROR',
]);
export type SyncPhase = z.infer<typeof SyncPhaseEnum>;

/**
 * Real-time progress tracking for a sync operation.
 * Updated during sync to allow clients to display progress.
 */
export const SyncProgressSchema = z.object({
  phase: SyncPhaseEnum,
  currentEntity: SyncableEntityTypeEnum.optional(), // Entity type being synced
  currentItemName: z.string().optional(), // Name/title of current item
  pulled: z.number().default(0),
  pushed: z.number().default(0),
  filesFetched: z.number().default(0),
  estimatedTotal: z.number().optional(), // Estimated total items (if known)
  message: z.string().optional(), // Human-readable status message
});
export type SyncProgress = z.infer<typeof SyncProgressSchema>;

// ============================================================================
// SYNC OPERATION
// ============================================================================

/**
 * Record of a conflict that occurred during sync
 */
export const SyncConflictSchema = z.object({
  entityType: SyncableEntityTypeEnum,
  localId: UUIDSchema,
  remoteId: UUIDSchema,
  resolution: ConflictResolutionEnum,
  localUpdatedAt: TimestampSchema,
  remoteUpdatedAt: TimestampSchema,
});
export type SyncConflict = z.infer<typeof SyncConflictSchema>;

/**
 * Audit log entry for a sync operation.
 * Tracks the progress and results of sync operations for debugging
 * and user visibility.
 */
export const SyncOperationSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  instanceId: UUIDSchema,
  direction: SyncDirectionEnum,
  status: SyncOperationStatusEnum,
  // Real-time progress tracking (updated during sync)
  progress: SyncProgressSchema.optional(),
  // Count of entities synced by type
  entityCounts: z.record(z.number()).default({}),
  // Record of conflicts that were resolved
  conflicts: z.array(SyncConflictSchema).default([]),
  // Any errors that occurred
  errors: z.array(z.string()).default([]),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type SyncOperation = z.infer<typeof SyncOperationSchema>;

/**
 * Data required to create a new sync operation
 */
export const CreateSyncOperationSchema = SyncOperationSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});
export type CreateSyncOperation = z.infer<typeof CreateSyncOperationSchema>;

// ============================================================================
// SYNC PROTOCOL MESSAGES
// ============================================================================

/**
 * Version information for compatibility checking during handshake
 */
export const SyncVersionInfoSchema = z.object({
  appVersion: z.string(),
  schemaVersion: z.string(),
  syncProtocolVersion: z.string(),
  supportedEntityTypes: z.array(SyncableEntityTypeEnum),
});
export type SyncVersionInfo = z.infer<typeof SyncVersionInfoSchema>;

/**
 * Handshake request sent to remote instance
 */
export const SyncHandshakeRequestSchema = z.object({
  versionInfo: SyncVersionInfoSchema,
  // User credentials for initial authentication (not stored)
  email: z.string().email().optional(),
  password: z.string().optional(),
  // Or use existing API key
  apiKey: z.string().optional(),
});
export type SyncHandshakeRequest = z.infer<typeof SyncHandshakeRequestSchema>;

/**
 * Handshake response from remote instance
 */
export const SyncHandshakeResponseSchema = z.object({
  compatible: z.boolean(),
  reason: z.string().optional(), // Reason if not compatible
  versionInfo: SyncVersionInfoSchema.optional(),
  // Session token for subsequent requests (if authenticated)
  sessionToken: z.string().optional(),
  remoteUserId: UUIDSchema.optional(),
});
export type SyncHandshakeResponse = z.infer<typeof SyncHandshakeResponseSchema>;

/**
 * Request to get changes since a timestamp
 */
export const SyncDeltaRequestSchema = z.object({
  instanceId: UUIDSchema.optional(), // For tracking on server side
  entityTypes: z.array(SyncableEntityTypeEnum).optional(), // Filter by type
  sinceTimestamp: TimestampSchema.nullable().optional(), // Get changes since this time
  limit: z.number().int().positive().max(1000).default(100),
  cursor: z.string().optional(), // For pagination
});
export type SyncDeltaRequest = z.infer<typeof SyncDeltaRequestSchema>;

/**
 * A single entity delta (change record)
 */
export const SyncEntityDeltaSchema = z.object({
  entityType: SyncableEntityTypeEnum,
  id: UUIDSchema,
  createdAt: TimestampSchema, // Original creation timestamp (for ID preservation)
  updatedAt: TimestampSchema,
  isDeleted: z.boolean().default(false),
  // Full entity data (null if deleted)
  data: z.record(z.unknown()).nullable().optional(),
});
export type SyncEntityDelta = z.infer<typeof SyncEntityDeltaSchema>;

/**
 * Response containing deltas
 */
export const SyncDeltaResponseSchema = z.object({
  serverTimestamp: TimestampSchema,
  deltas: z.array(SyncEntityDeltaSchema),
  hasMore: z.boolean().default(false),
  nextCursor: z.string().nullable().optional(),
});
export type SyncDeltaResponse = z.infer<typeof SyncDeltaResponseSchema>;

/**
 * Request to push changes to remote
 */
export const SyncPushRequestSchema = z.object({
  deltas: z.array(SyncEntityDeltaSchema),
  // Mappings for the pushed entities
  mappings: z.array(
    z.object({
      localId: UUIDSchema,
      remoteId: UUIDSchema.optional(), // May be null for new entities
      entityType: SyncableEntityTypeEnum,
    })
  ),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

/**
 * Response from push operation
 */
export const SyncPushResponseSchema = z.object({
  success: z.boolean(),
  // Mapping updates (new remote IDs for entities that were created)
  mappingUpdates: z.array(
    z.object({
      localId: UUIDSchema,
      remoteId: UUIDSchema,
      entityType: SyncableEntityTypeEnum,
    })
  ),
  conflicts: z.array(SyncConflictSchema),
  errors: z.array(z.string()),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Result of a version compatibility check
 */
export interface VersionCompatibilityResult {
  compatible: boolean;
  reason?: string;
  localVersion: SyncVersionInfo;
  remoteVersion?: SyncVersionInfo;
}

/**
 * Result of a complete sync operation
 */
export interface SyncResult {
  success: boolean;
  operationId: string;
  direction: SyncDirection;
  entityCounts: Record<string, number>;
  conflicts: SyncConflict[];
  errors: string[];
  duration: number; // milliseconds
  /** Logs collected from the remote server during sync operations */
  remoteLogs?: SyncLogEntry[];
}

// ============================================================================
// SYNC LOGGING
// ============================================================================

/**
 * Log levels for sync operations
 */
export const SyncLogLevelEnum = z.enum(['debug', 'info', 'warn', 'error']);
export type SyncLogLevel = z.infer<typeof SyncLogLevelEnum>;

/**
 * A single log entry collected during sync operations.
 * Used to transmit server-side logs to the requesting client for debugging.
 */
export const SyncLogEntrySchema = z.object({
  timestamp: TimestampSchema,
  level: SyncLogLevelEnum,
  message: z.string(),
  context: z.record(z.unknown()).optional(),
});
export type SyncLogEntry = z.infer<typeof SyncLogEntrySchema>;

/**
 * Extended response schema that includes server logs.
 * Used by endpoints that participate in sync to provide debugging info.
 */
export const SyncDeltaResponseWithLogsSchema = SyncDeltaResponseSchema.extend({
  serverLogs: z.array(SyncLogEntrySchema).optional(),
});
export type SyncDeltaResponseWithLogs = z.infer<typeof SyncDeltaResponseWithLogsSchema>;

export const SyncPushResponseWithLogsSchema = SyncPushResponseSchema.extend({
  serverLogs: z.array(SyncLogEntrySchema).optional(),
});
export type SyncPushResponseWithLogs = z.infer<typeof SyncPushResponseWithLogsSchema>;
