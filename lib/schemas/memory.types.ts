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
   * @deprecated Use aboutCharacterId instead.
   * Characters Not Personas - Phase 7: This field is migrated to aboutCharacterId.
   * After migration, personaId will be removed from all memories.
   * For backwards compatibility during migration, this field may still exist
   * in the database but should not be used in new code.
   */
  personaId: UUIDSchema.nullable().optional(),
  /**
   * The character this memory is about (who is being remembered).
   * Characters Not Personas - Phase 7: This now includes former persona references.
   * When a memory is about another character or former persona, their ID goes here.
   * The migration copies personaId → aboutCharacterId before removing personaId.
   */
  aboutCharacterId: UUIDSchema.nullable().optional(),
  chatId: UUIDSchema.nullable().optional(),         // Optional: source chat reference
  projectId: UUIDSchema.nullable().optional(),      // Optional: project this memory belongs to
  content: z.string(),                              // The actual memory content
  summary: z.string(),                              // Distilled version for context injection
  keywords: z.array(z.string()).default([]),        // For text-based search
  tags: z.array(UUIDSchema).default([]),            // Derived from character/persona/chat tags
  importance: z.number().min(0).max(1).default(0.5), // 0-1 scale for prioritization
  // Vector embedding for semantic search.
  // Accepts number[], Buffer (Float32 BLOB from SQLite), or JSON string (legacy TEXT storage).
  // All non-array forms are transformed to number[] at validation time.
  embedding: z.union([
    z.array(z.number()),
    z.instanceof(Buffer).transform((buf): number[] => {
      const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
      return Array.from(f32);
    }),
    z.string().transform((s): number[] => {
      const parsed = JSON.parse(s);
      if (!Array.isArray(parsed)) throw new Error('Embedding string is not a JSON array');
      return parsed;
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
