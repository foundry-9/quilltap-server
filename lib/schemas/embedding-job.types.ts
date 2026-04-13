/**
 * Embedding Job Types
 *
 * Schema definitions for TF-IDF vocabulary storage and embedding status tracking.
 * These support the built-in embedding provider and background job system.
 *
 * @module schemas/embedding-job.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// TF-IDF VOCABULARY
// ============================================================================

/**
 * Embedding status values
 */
export const EmbeddingStatusEnum = z.enum(['PENDING', 'EMBEDDED', 'FAILED']);
export type EmbeddingStatusValue = z.infer<typeof EmbeddingStatusEnum>;

/**
 * Entity types that can be embedded
 */
export const EmbeddableEntityTypeEnum = z.enum(['MEMORY', 'FILE', 'HELP_DOC', 'CONVERSATION_CHUNK']);
export type EmbeddableEntityType = z.infer<typeof EmbeddableEntityTypeEnum>;

/**
 * TF-IDF Vocabulary Schema
 *
 * Stores the vocabulary, IDF weights, and statistics for a BUILTIN embedding profile.
 * Each profile using the BUILTIN provider has one vocabulary record.
 */
export const TfidfVocabularySchema = z.object({
  id: UUIDSchema,
  profileId: UUIDSchema,
  userId: UUIDSchema,
  /** JSON-encoded vocabulary as [[term, index], ...] */
  vocabulary: z.string(),
  /** JSON-encoded IDF weights as number[] */
  idf: z.string(),
  /** Average document length across the corpus */
  avgDocLength: z.number(),
  /** Number of terms in the vocabulary */
  vocabularySize: z.number().int().positive(),
  /** Whether bigrams are included */
  includeBigrams: z.boolean().default(true),
  /** When the vocabulary was last fitted */
  fittedAt: TimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type TfidfVocabulary = z.infer<typeof TfidfVocabularySchema>;

/**
 * TF-IDF Vocabulary input for creation
 */
export type TfidfVocabularyInput = Omit<TfidfVocabulary, 'id' | 'createdAt' | 'updatedAt'>;

// ============================================================================
// EMBEDDING STATUS
// ============================================================================

/**
 * Embedding Status Schema
 *
 * Tracks the embedding status for each embeddable entity (memory, file, etc.).
 * Used to monitor which items need embedding and handle failures.
 */
export const EmbeddingStatusSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  /** Type of entity being embedded (MEMORY, FILE, etc.) */
  entityType: EmbeddableEntityTypeEnum,
  /** ID of the entity being embedded */
  entityId: UUIDSchema,
  /** ID of the embedding profile used */
  profileId: UUIDSchema,
  /** Current status of the embedding */
  status: EmbeddingStatusEnum.default('PENDING'),
  /** When the embedding was successfully generated */
  embeddedAt: TimestampSchema.nullable().optional(),
  /** Error message if embedding failed */
  error: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type EmbeddingStatus = z.infer<typeof EmbeddingStatusSchema>;

/**
 * Embedding Status input for creation
 */
export type EmbeddingStatusInput = Omit<EmbeddingStatus, 'id' | 'createdAt' | 'updatedAt'>;
