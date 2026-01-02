/**
 * Tag Type Definitions
 *
 * Contains schemas for tags and tag files used for
 * categorization across the application.
 *
 * @module schemas/tag.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  TagVisualStyleSchema,
} from './common.types';

// ============================================================================
// TAG
// ============================================================================

export const TagSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  nameLower: z.string(),
  quickHide: z.boolean().default(false),
  visualStyle: TagVisualStyleSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Tag = z.infer<typeof TagSchema>;

// ============================================================================
// TAGS FILE
// ============================================================================

export const TagsFileSchema = z.object({
  version: z.number().default(1),
  tags: z.array(TagSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type TagsFile = z.infer<typeof TagsFileSchema>;
