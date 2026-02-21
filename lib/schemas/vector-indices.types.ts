/**
 * Vector Indices Type Definitions
 *
 * Contains schemas for vector indices (embeddings for semantic search).
 * Each index represents a complete set of embeddings for a single character.
 *
 * @module schemas/vector-indices.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// VECTOR METADATA
// ============================================================================

export const VectorMetadataSchema = z.looseObject({
  memoryId: UUIDSchema,
  characterId: UUIDSchema,
  content: z.string().optional(),
});

export type VectorMetadata = z.infer<typeof VectorMetadataSchema>;

// ============================================================================
// VECTOR ENTRY
// ============================================================================

export const VectorEntrySchema = z.object({
  id: UUIDSchema,
  embedding: z.array(z.number()),
  metadata: VectorMetadataSchema,
  createdAt: TimestampSchema,
});

export type VectorEntry = z.infer<typeof VectorEntrySchema>;

// ============================================================================
// VECTOR INDEX
// ============================================================================

export const VectorIndexSchema = z.object({
  id: UUIDSchema, // characterId
  characterId: UUIDSchema,
  version: z.number(),
  dimensions: z.number(),
  entries: z.array(VectorEntrySchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type VectorIndex = z.infer<typeof VectorIndexSchema>;

// ============================================================================
// NORMALIZED VECTOR STORAGE (v2 — BLOB-backed)
// ============================================================================

/**
 * Per-character metadata row in `vector_indices` table (no entries column).
 */
export const VectorIndexMetaSchema = z.object({
  id: UUIDSchema,
  characterId: UUIDSchema,
  version: z.number(),
  dimensions: z.number(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type VectorIndexMeta = z.infer<typeof VectorIndexMetaSchema>;

/**
 * Per-embedding row in `vector_entries` table.
 * The embedding is stored as a Float32 BLOB in SQLite but
 * hydrated as number[] at the application layer.
 */
export const VectorEntryRowSchema = z.object({
  id: UUIDSchema,
  characterId: UUIDSchema,
  embedding: z.array(z.number()),
  createdAt: TimestampSchema,
});

export type VectorEntryRow = z.infer<typeof VectorEntryRowSchema>;
