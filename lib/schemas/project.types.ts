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
  JsonSchema,
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

  // Default tool settings for new chats
  /** Default list of tool IDs that are disabled for new chats in this project */
  defaultDisabledTools: z.array(z.string()).default([]),
  /** Default groups of tools that are disabled (e.g., "plugin:mcp") */
  defaultDisabledToolGroups: z.array(z.string()).default([]),

  /** Default agent mode enabled state for chats in this project (null = inherit from character or global) */
  defaultAgentModeEnabled: z.boolean().nullable().optional(),

  /** Default avatar generation enabled state for chats in this project (null = disabled) */
  defaultAvatarGenerationEnabled: z.boolean().nullable().optional(),

  /** Persistent JSON state for games, inventory, session data, etc. */
  state: JsonSchema.default({}),

  // Story backgrounds
  /** Whether story backgrounds are enabled for this project (null = inherit from global, true/false = override) */
  storyBackgroundsEnabled: z.boolean().nullable().optional(),
  /** Static background image file ID (user-selected, not AI-generated) */
  staticBackgroundImageId: UUIDSchema.nullable().optional(),
  /** AI-generated story background image file ID for the project */
  storyBackgroundImageId: UUIDSchema.nullable().optional(),
  /** How to display backgrounds: 'latest_chat' = from most recent chat, 'project' = project-level generated, 'static' = user-uploaded, 'theme' = default theme */
  backgroundDisplayMode: z.enum(['latest_chat', 'project', 'static', 'theme']).default('theme'),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Project = z.infer<typeof ProjectSchema>;

// Input type for creating projects - makes fields with defaults optional
export type ProjectInput = z.input<typeof ProjectSchema>;

// Background display mode type
export const BackgroundDisplayModeEnum = z.enum(['latest_chat', 'project', 'static', 'theme']);
export type BackgroundDisplayMode = z.infer<typeof BackgroundDisplayModeEnum>;

// ============================================================================
// PROJECT CONTEXT (for system prompt injection)
// ============================================================================

export const ProjectContextSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
});

export type ProjectContext = z.infer<typeof ProjectContextSchema>;
