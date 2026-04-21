/**
 * Profile Type Definitions
 *
 * Contains schemas for API keys, connection profiles, image profiles,
 * and embedding profiles.
 *
 * @module schemas/profile.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  JsonSchema,
  ProviderEnum,
  ImageProviderEnum,
  EmbeddingProfileProviderEnum,
} from './common.types';

// ============================================================================
// API KEYS
// ============================================================================

export const ApiKeySchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  label: z.string(),
  provider: ProviderEnum,
  key_value: z.string(),
  isActive: z.boolean().default(true),
  lastUsed: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ApiKey = z.infer<typeof ApiKeySchema>;

// ============================================================================
// CONNECTION PROFILES
// ============================================================================

export const ConnectionProfileSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  provider: ProviderEnum,
  apiKeyId: UUIDSchema.nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  modelName: z.string(),
  parameters: JsonSchema.default({}),
  isDefault: z.boolean().default(false),
  /** Whether this profile is suitable for use as a "cheap" LLM (low-cost tasks) */
  isCheap: z.boolean().default(false),
  /** Whether the search_web tool is enabled for this profile */
  allowWebSearch: z.boolean().default(false),
  /** Whether to use the provider's native web search integration (if supported) */
  useNativeWebSearch: z.boolean().default(false),
  /** Whether tool use is allowed for this profile (master override — when false, no tools are sent regardless of chat/project settings) */
  allowToolUse: z.boolean().default(true),
  /** Optional model class name for capability tier classification (e.g., 'Compact', 'Standard', 'Extended', 'Deep') */
  modelClass: z.string().nullable().optional(),
  /** Optional override for the context window size in tokens (caps how much input the model accepts) */
  maxContext: z.number().int().positive().nullable().optional(),
  /** Optional override for the maximum output/completion tokens the model can generate */
  maxTokens: z.number().int().positive().nullable().optional(),
  /** Whether this profile is suitable for uncensored/dangerous content (user must explicitly opt in) */
  isDangerousCompatible: z.boolean().default(false),
  /** Whether this profile accepts image attachments (vision input). Set per-profile so users can enable it on OpenRouter/Ollama models that proxy vision-capable LLMs. */
  supportsImageUpload: z.boolean().default(false),
  tags: z.array(UUIDSchema).default([]),

  /** Custom sort order for display (lower numbers appear first) */
  sortIndex: z.number().default(0),

  // Token usage tracking (persisted, incremented after each message)
  /** Total tokens used through this profile */
  totalTokens: z.number().default(0),
  /** Total prompt/input tokens used through this profile */
  totalPromptTokens: z.number().default(0),
  /** Total completion/output tokens used through this profile */
  totalCompletionTokens: z.number().default(0),
  /** Total messages sent through this profile */
  messageCount: z.number().default(0),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ConnectionProfile = z.infer<typeof ConnectionProfileSchema>;

export const ConnectionProfilesFileSchema = z.object({
  version: z.number().default(1),
  apiKeys: z.array(ApiKeySchema).default([]),
  llmProfiles: z.array(ConnectionProfileSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ConnectionProfilesFile = z.infer<typeof ConnectionProfilesFileSchema>;

// ============================================================================
// IMAGE PROFILES
// ============================================================================

export const ImageProfileSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  provider: ImageProviderEnum,
  apiKeyId: UUIDSchema.nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  modelName: z.string(),
  parameters: JsonSchema.default({}),
  isDefault: z.boolean().default(false),
  /** Whether this profile is suitable for uncensored/dangerous image content (user must explicitly opt in) */
  isDangerousCompatible: z.boolean().default(false),
  tags: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ImageProfile = z.infer<typeof ImageProfileSchema>;

export const ImageProfilesFileSchema = z.object({
  version: z.number().default(1),
  profiles: z.array(ImageProfileSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ImageProfilesFile = z.infer<typeof ImageProfilesFileSchema>;

// ============================================================================
// EMBEDDING PROFILES
// ============================================================================

export const EmbeddingProfileSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  provider: EmbeddingProfileProviderEnum,
  apiKeyId: UUIDSchema.nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  modelName: z.string(),
  /** Embedding dimension size (provider-specific) */
  dimensions: z.number().nullable().optional(),
  isDefault: z.boolean().default(false),
  tags: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type EmbeddingProfile = z.infer<typeof EmbeddingProfileSchema>;

export const EmbeddingProfilesFileSchema = z.object({
  version: z.number().default(1),
  profiles: z.array(EmbeddingProfileSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type EmbeddingProfilesFile = z.infer<typeof EmbeddingProfilesFileSchema>;
