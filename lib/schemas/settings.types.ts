/**
 * Settings Type Definitions
 *
 * Contains schemas for chat settings, cheap LLM configuration,
 * timestamp configuration, and general settings.
 *
 * @module schemas/settings.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  AvatarDisplayModeEnum,
  TagStyleMapSchema,
  ThemePreferenceSchema,
} from './common.types';
import { UserSchema } from './auth.types';

// ============================================================================
// CHEAP LLM SETTINGS
// ============================================================================

export const CheapLLMStrategyEnum = z.enum(['USER_DEFINED', 'PROVIDER_CHEAPEST', 'LOCAL_FIRST']);
export type CheapLLMStrategy = z.infer<typeof CheapLLMStrategyEnum>;

export const EmbeddingProviderEnum = z.enum(['SAME_PROVIDER', 'OPENAI', 'LOCAL']);
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderEnum>;

export const CheapLLMSettingsSchema = z.object({
  /** Strategy for selecting the cheap LLM provider */
  strategy: CheapLLMStrategyEnum.default('PROVIDER_CHEAPEST'),
  /** If USER_DEFINED, which connection profile to use */
  userDefinedProfileId: UUIDSchema.nullable().optional(),
  /** Global default cheap LLM profile - always use this if set */
  defaultCheapProfileId: UUIDSchema.nullable().optional(),
  /** Whether to fall back to local models if available */
  fallbackToLocal: z.boolean().default(true),
  /** Provider for generating embeddings */
  embeddingProvider: EmbeddingProviderEnum.default('OPENAI'),
  /** Embedding profile ID to use for text embeddings */
  embeddingProfileId: UUIDSchema.nullable().optional(),
});

export type CheapLLMSettings = z.infer<typeof CheapLLMSettingsSchema>;

// ============================================================================
// TIMESTAMP CONFIGURATION
// ============================================================================

export const TimestampModeEnum = z.enum(['NONE', 'START_ONLY', 'EVERY_MESSAGE']);
export type TimestampMode = z.infer<typeof TimestampModeEnum>;

export const TimestampFormatEnum = z.enum(['ISO8601', 'FRIENDLY', 'DATE_ONLY', 'TIME_ONLY', 'CUSTOM']);
export type TimestampFormat = z.infer<typeof TimestampFormatEnum>;

export const TimestampConfigSchema = z.object({
  /** Whether to inject timestamps and how */
  mode: TimestampModeEnum.default('NONE'),
  /** How to format the timestamp */
  format: TimestampFormatEnum.default('FRIENDLY'),
  /** Custom format string (when format is CUSTOM) - uses date-fns format tokens */
  customFormat: z.string().nullable().optional(),
  /** Whether to use fictional/arbitrary timestamp instead of real time */
  useFictionalTime: z.boolean().default(false),
  /** Base fictional timestamp (ISO-8601 format) */
  fictionalBaseTimestamp: z.string().nullable().optional(),
  /** Real timestamp when the fictional base was set (for auto-increment calculation) */
  fictionalBaseRealTime: z.string().nullable().optional(),
  /** Whether to auto-prepend "Current time: [timestamp]" or use {{timestamp}} template variable */
  autoPrepend: z.boolean().default(true),
});

export type TimestampConfig = z.infer<typeof TimestampConfigSchema>;

// ============================================================================
// CHAT SETTINGS
// ============================================================================

export const ChatSettingsSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  avatarDisplayMode: AvatarDisplayModeEnum.default('ALWAYS'),
  avatarDisplayStyle: z.string().default('CIRCULAR'),
  tagStyles: TagStyleMapSchema,
  /** Cheap LLM settings for memory extraction and summarization */
  cheapLLMSettings: CheapLLMSettingsSchema.default({
    strategy: 'PROVIDER_CHEAPEST',
    fallbackToLocal: true,
    embeddingProvider: 'OPENAI',
  }),
  /** Profile ID to use for image description fallback (when provider doesn't support images) */
  imageDescriptionProfileId: UUIDSchema.nullable().optional(),
  /** Default roleplay template ID for all new chats */
  defaultRoleplayTemplateId: UUIDSchema.nullable().optional(),
  /** Theme preference settings */
  themePreference: ThemePreferenceSchema.default({
    activeThemeId: null,
    colorMode: 'system',
  }),
  /** Default timestamp configuration for new chats */
  defaultTimestampConfig: TimestampConfigSchema.default({
    mode: 'NONE',
    format: 'FRIENDLY',
    useFictionalTime: false,
    autoPrepend: true,
  }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

// ============================================================================
// GENERAL SETTINGS (COMPOUND)
// ============================================================================

export const GeneralSettingsSchema = z.object({
  version: z.number().default(1),
  user: UserSchema,
  chatSettings: ChatSettingsSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;
