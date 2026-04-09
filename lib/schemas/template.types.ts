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
// ANNOTATION BUTTONS (for formatting toolbar)
// ============================================================================

/**
 * Configuration for annotation buttons shown in the formatting toolbar.
 * Each roleplay template can define its own set of formatting buttons.
 */
export const AnnotationButtonSchema = z.object({
  /** Full name displayed in tooltip (e.g., "Narration", "Internal Monologue") */
  label: z.string().min(1).max(50),
  /** Abbreviated label displayed on button (e.g., "Nar", "Int", "OOC") */
  abbrev: z.string().min(1).max(10),
  /** Opening delimiter (e.g., "[", "*", "{{") */
  prefix: z.string(),
  /** Closing delimiter (e.g., "]", "*", "}}") - empty string for line-end delimiters */
  suffix: z.string(),
});

export type AnnotationButton = z.infer<typeof AnnotationButtonSchema>;

// ============================================================================
// RENDERING PATTERNS (for message content styling)
// ============================================================================

/**
 * Pattern for styling roleplay text in message content.
 * Defines how to match and style specific text patterns (narration, OOC, etc.)
 */
export const RenderingPatternSchema = z.object({
  /** Regex pattern as a string (converted to RegExp at runtime) */
  pattern: z.string().min(1),
  /** CSS class to apply to matched text (e.g., qt-chat-narration, qt-chat-ooc) */
  className: z.string().min(1),
  /** Optional regex flags (e.g., 'm' for multiline) */
  flags: z.string().optional(),
});

export type RenderingPattern = z.infer<typeof RenderingPatternSchema>;

/**
 * Configuration for detecting dialogue at the paragraph level.
 * When dialogue contains markdown formatting, inline patterns can't match.
 * This detects paragraphs that start/end with quote characters.
 */
export const DialogueDetectionSchema = z.object({
  /** Opening quote characters to detect (e.g., ['"', '"']) */
  openingChars: z.array(z.string()),
  /** Closing quote characters to detect (e.g., ['"', '"']) */
  closingChars: z.array(z.string()),
  /** CSS class to apply to dialogue paragraphs */
  className: z.string().min(1),
});

export type DialogueDetection = z.infer<typeof DialogueDetectionSchema>;

// ============================================================================
// NARRATION DELIMITERS
// ============================================================================

/**
 * Narration delimiters define how narration/action text is marked in roleplay output.
 * Required for all roleplay templates.
 *
 * - A single string means the same character is used for opening and closing (e.g., '*')
 * - A tuple of two strings means different opening and closing delimiters (e.g., ['[', ']'])
 */
export const NarrationDelimitersSchema = z.union([
  z.string().min(1),
  z.tuple([z.string().min(1), z.string().min(1)]),
]);

export type NarrationDelimiters = z.infer<typeof NarrationDelimitersSchema>;

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
  /** Annotation buttons for the formatting toolbar - defines available formatting options */
  annotationButtons: z.array(AnnotationButtonSchema).default([]),
  /** Patterns for styling roleplay text in message content */
  renderingPatterns: z.array(RenderingPatternSchema).default([]),
  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection: DialogueDetectionSchema.nullable().optional(),
  /** Narration delimiters — required for new templates. Defaults to '*' for backward compatibility */
  narrationDelimiters: NarrationDelimitersSchema.default('*'),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type RoleplayTemplate = z.infer<typeof RoleplayTemplateSchema>;

// ============================================================================
// PROMPT TEMPLATES
// ============================================================================

// User-created prompt templates (stored in database) for reusable system prompts
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
