/**
 * Job Type Definitions
 *
 * Contains schemas for background jobs used for async processing
 * like memory extraction, context summarization, and title updates.
 *
 * @module schemas/job.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// BACKGROUND JOB ENUMS
// ============================================================================

export const BackgroundJobTypeEnum = z.enum([
  'MEMORY_EXTRACTION',
  'INTER_CHARACTER_MEMORY',
  'CONTEXT_SUMMARY',
  'TITLE_UPDATE',
  'LLM_LOG_CLEANUP',
  'EMBEDDING_GENERATE',    // Generate embedding for a single entity (memory)
  'EMBEDDING_REFIT',       // Rebuild TF-IDF vocabulary from all memories
  'EMBEDDING_REINDEX_ALL', // Re-embed all memories after vocabulary change
  'STORY_BACKGROUND_GENERATION', // Generate story background image for chat/project
  'CHAT_DANGER_CLASSIFICATION', // Classify chat-level danger from context summary
  'SCENE_STATE_TRACKING', // Track scene state (location, character actions, appearance, clothing)
  'CHARACTER_AVATAR_GENERATION', // Generate character avatar based on equipped wardrobe items
  'CONVERSATION_RENDER', // Deterministic Markdown rendering of conversation (Scriptorium)
  'MEMORY_HOUSEKEEPING', // Prune / merge a character's memories against retention policy
]);
export type BackgroundJobType = z.infer<typeof BackgroundJobTypeEnum>;

export const BackgroundJobStatusEnum = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'DEAD',
  'PAUSED',
]);
export type BackgroundJobStatus = z.infer<typeof BackgroundJobStatusEnum>;

// ============================================================================
// BACKGROUND JOB
// ============================================================================

export const BackgroundJobSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  type: BackgroundJobTypeEnum,
  status: BackgroundJobStatusEnum.default('PENDING'),
  payload: z.record(z.string(), z.unknown()),               // Type-specific payload
  priority: z.number().default(0),              // Higher = more urgent
  attempts: z.number().default(0),
  maxAttempts: z.number().default(3),
  lastError: z.string().nullable().optional(),
  scheduledAt: TimestampSchema,                 // When job becomes eligible to run
  startedAt: TimestampSchema.nullable().optional(),
  completedAt: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type BackgroundJob = z.infer<typeof BackgroundJobSchema>;
