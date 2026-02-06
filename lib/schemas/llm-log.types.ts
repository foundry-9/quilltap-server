/**
 * LLM Log Type Definitions
 *
 * Contains schemas for LLM request/response logging used to track
 * all LLM API calls for debugging and monitoring purposes.
 *
 * @module schemas/llm-log.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// LLM LOG TYPE ENUM
// ============================================================================

export const LLMLogTypeEnum = z.enum([
  'CHAT_MESSAGE',
  'TOOL_CONTINUATION',
  'MEMORY_EXTRACTION',
  'TITLE_GENERATION',
  'CONTEXT_COMPRESSION',
  'SUMMARIZATION',
  'IMAGE_PROMPT_CRAFTING',
  'CHARACTER_WIZARD',
  'IMAGE_DESCRIPTION',
  'DANGER_CLASSIFICATION',
]);
export type LLMLogType = z.infer<typeof LLMLogTypeEnum>;

// ============================================================================
// LLM LOG MESSAGE SUMMARY
// ============================================================================

export const LLMLogMessageSummarySchema = z.object({
  role: z.string(),
  contentPreview: z.string(), // First 500 chars
  contentLength: z.number(),
  hasAttachments: z.boolean().default(false),
});
export type LLMLogMessageSummary = z.infer<typeof LLMLogMessageSummarySchema>;

// ============================================================================
// LLM LOG REQUEST SUMMARY
// ============================================================================

export const LLMLogRequestSummarySchema = z.object({
  messageCount: z.number(),
  messages: z.array(LLMLogMessageSummarySchema),
  temperature: z.number().nullable().optional(),
  maxTokens: z.number().nullable().optional(),
  toolCount: z.number().default(0),
  fullMessages: z.any().nullable().optional(), // JSON only if verbose logging enabled
});
export type LLMLogRequestSummary = z.infer<typeof LLMLogRequestSummarySchema>;

// ============================================================================
// LLM LOG RESPONSE SUMMARY
// ============================================================================

export const LLMLogResponseSummarySchema = z.object({
  contentPreview: z.string(), // First 500 chars
  contentLength: z.number(),
  fullContent: z.string().nullable().optional(), // Only if verbose logging enabled
  error: z.string().nullable().optional(),
});
export type LLMLogResponseSummary = z.infer<typeof LLMLogResponseSummarySchema>;

// ============================================================================
// TOKEN USAGE
// ============================================================================

export const LLMLogTokenUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
});
export type LLMLogTokenUsage = z.infer<typeof LLMLogTokenUsageSchema>;

// ============================================================================
// CACHE USAGE
// ============================================================================

export const LLMLogCacheUsageSchema = z.object({
  cacheCreationInputTokens: z.number().optional(),
  cacheReadInputTokens: z.number().optional(),
});
export type LLMLogCacheUsage = z.infer<typeof LLMLogCacheUsageSchema>;

// ============================================================================
// LLM LOG ENTITY
// ============================================================================

export const LLMLogSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,

  // Type of LLM operation
  type: LLMLogTypeEnum,

  // Entity linkage (at least one should be set for non-standalone operations)
  messageId: UUIDSchema.nullable().optional(), // For chat message operations
  chatId: UUIDSchema.nullable().optional(), // For chat-level operations (title, compression)
  characterId: UUIDSchema.nullable().optional(), // For character wizard

  // Provider info
  provider: z.string(),
  modelName: z.string(),

  // Request summary
  request: LLMLogRequestSummarySchema,

  // Response summary
  response: LLMLogResponseSummarySchema,

  // Token usage
  usage: LLMLogTokenUsageSchema.nullable().optional(),
  cacheUsage: LLMLogCacheUsageSchema.nullable().optional(),

  // Timing
  durationMs: z.number().nullable().optional(),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type LLMLog = z.infer<typeof LLMLogSchema>;
