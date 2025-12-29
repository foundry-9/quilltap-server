/**
 * Memory Type Definitions
 *
 * Contains schemas for memories extracted from conversations
 * for long-term character memory and context.
 *
 * @module schemas/memory.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// MEMORY ENUMS
// ============================================================================

export const MemorySourceEnum = z.enum(['AUTO', 'MANUAL']);
export type MemorySource = z.infer<typeof MemorySourceEnum>;

// ============================================================================
// MEMORY
// ============================================================================

export const MemorySchema = z.object({
  id: UUIDSchema,
  characterId: UUIDSchema,
  personaId: UUIDSchema.nullable().optional(),      // Optional: specific persona interaction
  aboutCharacterId: UUIDSchema.nullable().optional(), // Optional: memory about another character (for inter-character memories)
  chatId: UUIDSchema.nullable().optional(),         // Optional: source chat reference
  content: z.string(),                              // The actual memory content
  summary: z.string(),                              // Distilled version for context injection
  keywords: z.array(z.string()).default([]),        // For text-based search
  tags: z.array(UUIDSchema).default([]),            // Derived from character/persona/chat tags
  importance: z.number().min(0).max(1).default(0.5), // 0-1 scale for prioritization
  embedding: z.array(z.number()).nullable().optional(), // Vector embedding for semantic search
  source: MemorySourceEnum.default('MANUAL'),       // How it was created
  sourceMessageId: UUIDSchema.nullable().optional(), // If auto-created, which message triggered it
  lastAccessedAt: TimestampSchema.nullable().optional(), // For housekeeping decisions
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Memory = z.infer<typeof MemorySchema>;

// ============================================================================
// MEMORIES FILE
// ============================================================================

export const MemoriesFileSchema = z.object({
  version: z.number().default(1),
  memories: z.array(MemorySchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type MemoriesFile = z.infer<typeof MemoriesFileSchema>;
