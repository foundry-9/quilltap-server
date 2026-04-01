/**
 * Model Type Definitions
 *
 * Contains schemas for provider models including chat, image,
 * and embedding model configurations.
 *
 * @module schemas/model.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  ProviderEnum,
} from './common.types';

// ============================================================================
// MODEL ENUMS
// ============================================================================

export const ModelTypeEnum = z.enum(['chat', 'image', 'embedding']);
export type ModelType = z.infer<typeof ModelTypeEnum>;

// ============================================================================
// PROVIDER MODEL
// ============================================================================

export const ProviderModelSchema = z.object({
  id: UUIDSchema,
  provider: ProviderEnum,
  modelId: z.string().min(1),
  modelType: ModelTypeEnum.default('chat'),               // Type of model (chat, image, embedding)
  displayName: z.string(),
  baseUrl: z.string().nullable().optional(),              // For custom endpoints
  contextWindow: z.number().nullable().optional(),        // Max context size in tokens
  maxOutputTokens: z.number().nullable().optional(),      // Max generation tokens
  deprecated: z.boolean().default(false),                 // Is this model deprecated
  experimental: z.boolean().default(false),               // Is this model experimental
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ProviderModel = z.infer<typeof ProviderModelSchema>;
