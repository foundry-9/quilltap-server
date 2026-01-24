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
