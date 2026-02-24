/**
 * Folder Type Definitions
 *
 * Contains schemas for folder entities in the file management system.
 * Folders are first-class entities stored in the database, enabling
 * empty folder persistence and consistent behavior across storage backends.
 *
 * @module schemas/folder.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// FOLDER ENTITY
// ============================================================================

export const FolderSchema = z.object({
  // Identity
  id: UUIDSchema,
  userId: UUIDSchema,

  // Path and name
  // path: Full normalized path like "/documents/reports/" (always starts and ends with /)
  // name: Just the folder name like "reports" (or "Root" for root folder)
  path: z.string(),
  name: z.string(),

  // Hierarchy
  // parentFolderId: null means root level (path = "/")
  parentFolderId: UUIDSchema.nullable(),

  // Scope
  // projectId: null means general files (not associated with a project)
  projectId: UUIDSchema.nullable().optional(),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Folder = z.infer<typeof FolderSchema>;

/**
 * Input type for creating a folder (without auto-generated fields)
 */
export type FolderInput = Omit<Folder, 'id' | 'createdAt' | 'updatedAt'>;
