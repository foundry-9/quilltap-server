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
  'APPEARANCE_RESOLUTION',
  'AI_IMPORT',
  'SCENE_STATE_TRACKING',
  'CHARACTER_OPTIMIZER',
]);
export type LLMLogType = z.infer<typeof LLMLogTypeEnum>;

// ============================================================================
// LLM LOG MESSAGE SUMMARY
// ============================================================================

export const LLMLogMessageSummarySchema = z.object({
  role: z.string(),
  content: z.string(), // Full message content
  contentPreview: z.string().optional(), // Deprecated: old truncated field, kept for backward compat
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
  fullMessages: z.any().nullable().optional(), // Deprecated: kept for backward compat with old log entries
});
export type LLMLogRequestSummary = z.infer<typeof LLMLogRequestSummarySchema>;

// ============================================================================
// LLM LOG RESPONSE SUMMARY
// ============================================================================

export const LLMLogResponseSummarySchema = z.object({
  content: z.string(), // Full response content
  contentPreview: z.string().optional(), // Deprecated: old truncated field, kept for backward compat
  contentLength: z.number(),
  fullContent: z.string().nullable().optional(), // Deprecated: kept for backward compat with old log entries
  error: z.string().nullable().optional(),
  toolCalls: z.array(z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  })).optional(), // Native tool calls from the LLM response
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
