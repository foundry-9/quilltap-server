/**
 * Template Type Definitions
 *
 * Contains schemas for roleplay templates and prompt templates
 * used for system prompts and character interactions.
 *
 * @module schemas/template.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// ROLEPLAY TEMPLATES
// ============================================================================

export const RoleplayTemplateSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema.nullable().optional(),  // null for built-in templates
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  systemPrompt: z.string().min(1),           // The template content
  isBuiltIn: z.boolean().default(false),     // Built-in templates are read-only
  pluginName: z.string().nullable().optional(), // Plugin name if provided by a plugin
  tags: z.array(UUIDSchema).default([]),     // Optional categorization
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type RoleplayTemplate = z.infer<typeof RoleplayTemplateSchema>;

// ============================================================================
// PROMPT TEMPLATES
// ============================================================================

// User-created prompt templates (stored in MongoDB) for reusable system prompts
export const PromptTemplateSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema.nullable().optional(),   // null for built-in sample prompts
  name: z.string().min(1).max(100),
  content: z.string().min(1),                 // The prompt content (markdown)
  description: z.string().max(500).nullable().optional(),
  isBuiltIn: z.boolean().default(false),      // True for sample prompts from prompts/ directory
  category: z.string().nullable().optional(), // e.g., "COMPANION", "ROMANTIC" from filename
  modelHint: z.string().nullable().optional(), // e.g., "CLAUDE", "GPT-4O" from filename
  tags: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;
