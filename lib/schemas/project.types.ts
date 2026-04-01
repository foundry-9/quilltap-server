/**
 * Project Type Definitions
 *
 * Contains schemas for projects that organize files, chats,
 * and provide scoped context for AI conversations.
 *
 * @module schemas/project.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  HexColorSchema,
} from './common.types';

// ============================================================================
// PROJECT
// ============================================================================

export const ProjectSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,

  // Core fields
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(10000).nullable().optional(), // System prompt for project chats

  // Character access control
  allowAnyCharacter: z.boolean().default(false), // When true, any character can participate
  characterRoster: z.array(UUIDSchema).default([]), // Explicit character list (when allowAnyCharacter is false)

  // Display customization
  color: HexColorSchema.nullable().optional(), // Accent color for sidebar/UI
  icon: z.string().max(50).nullable().optional(), // Icon identifier (emoji or icon name)

  // Storage
  mountPointId: UUIDSchema.nullable().optional(), // Storage mount point for project files

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Project = z.infer<typeof ProjectSchema>;

// Input type for creating projects - makes fields with defaults optional
export type ProjectInput = z.input<typeof ProjectSchema>;

// ============================================================================
// PROJECT CONTEXT (for system prompt injection)
// ============================================================================

export const ProjectContextSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
});

export type ProjectContext = z.infer<typeof ProjectContextSchema>;
