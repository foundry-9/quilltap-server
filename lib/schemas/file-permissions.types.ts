/**
 * File Write Permission Type Definitions
 *
 * Contains schemas for LLM file write permissions used to control
 * when an LLM can write files without user approval.
 *
 * @module schemas/file-permissions.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// FILE WRITE PERMISSION ENUMS
// ============================================================================

/**
 * Scope of file write permission
 * - SINGLE_FILE: Permission to write a single specific file
 * - PROJECT: Permission to write any file in a specific project
 * - GENERAL: Permission to write any general (non-project) file
 */
export const FileWritePermissionScopeEnum = z.enum([
  'SINGLE_FILE',
  'PROJECT',
  'GENERAL',
]);
export type FileWritePermissionScope = z.infer<typeof FileWritePermissionScopeEnum>;

// ============================================================================
// FILE WRITE PERMISSION
// ============================================================================

/**
 * Schema for file write permissions
 *
 * Permissions are user-scoped and persist across sessions until revoked.
 * The scope determines what the permission applies to:
 * - SINGLE_FILE: fileId must be set
 * - PROJECT: projectId must be set
 * - GENERAL: no additional target needed
 */
export const FileWritePermissionSchema = z.object({
  // Identity
  id: UUIDSchema,
  userId: UUIDSchema,

  // Permission scope
  scope: FileWritePermissionScopeEnum,

  // Scope targets (set based on scope type)
  fileId: UUIDSchema.nullable().optional(), // For SINGLE_FILE scope
  projectId: UUIDSchema.nullable().optional(), // For PROJECT scope

  // Metadata
  grantedAt: TimestampSchema, // When the permission was granted
  grantedInChatId: UUIDSchema.nullable().optional(), // Which chat the permission was granted from

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type FileWritePermission = z.infer<typeof FileWritePermissionSchema>;

// ============================================================================
// CREATE/UPDATE TYPES
// ============================================================================

/**
 * Schema for creating a new file write permission
 */
export const CreateFileWritePermissionSchema = FileWritePermissionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateFileWritePermission = z.infer<typeof CreateFileWritePermissionSchema>;

/**
 * Schema for updating a file write permission
 */
export const UpdateFileWritePermissionSchema = FileWritePermissionSchema.partial().omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type UpdateFileWritePermission = z.infer<typeof UpdateFileWritePermissionSchema>;
