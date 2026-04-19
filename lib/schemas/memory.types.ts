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
  /**
   * The character this memory is about (who is being remembered).
   * When a memory is about another character, their ID goes here.
   */
  aboutCharacterId: UUIDSchema.nullable().optional(),
  chatId: UUIDSchema.nullable().optional(),         // Optional: source chat reference
  projectId: UUIDSchema.nullable().optional(),      // Optional: project this memory belongs to
  content: z.string(),                              // The actual memory content
  summary: z.string(),                              // Distilled version for context injection
  keywords: z.array(z.string()).default([]),        // For text-based search
  tags: z.array(UUIDSchema).default([]),            // Derived from character/chat tags
  importance: z.number().min(0).max(1).default(0.5), // 0-1 scale for prioritization
  // Vector embedding for semantic search.
  // Accepts Float32Array, number[], Buffer (Float32 BLOB from SQLite), or JSON string (legacy TEXT storage).
  // All forms are normalised to Float32Array at validation time — unit-length per
  // the normalize-embeddings-unit-vectors migration.
  embedding: z.union([
    z.instanceof(Float32Array),
    z.array(z.number()).transform((arr): Float32Array => new Float32Array(arr)),
    z.instanceof(Buffer).transform((buf): Float32Array => {
      const view = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
      return new Float32Array(view);
    }),
    z.string().transform((s): Float32Array => {
      const parsed = JSON.parse(s);
      if (!Array.isArray(parsed)) throw new Error('Embedding string is not a JSON array');
      return new Float32Array(parsed);
    }),
  ]).nullable().optional(),
  source: MemorySourceEnum.default('MANUAL'),       // How it was created
  sourceMessageId: UUIDSchema.nullable().optional(), // If auto-created, which message triggered it
  lastAccessedAt: TimestampSchema.nullable().optional(), // For housekeeping decisions
  // Memory Gate fields — reinforcement tracking
  reinforcementCount: z.number().int().min(1).default(1),  // How many times this memory has been observed
  lastReinforcedAt: TimestampSchema.nullable().optional(),  // Null until first reinforcement
  relatedMemoryIds: z.array(UUIDSchema).default([]),       // Bidirectional links to related memories
  reinforcedImportance: z.number().min(0).max(1).default(0.5), // importance + log2(count+1)*0.05, capped at 1.0
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
