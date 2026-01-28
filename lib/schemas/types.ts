/**
 * Shared Type Definitions - Barrel File
 *
 * Central re-export file for all schema types used across the application.
 * These correspond to entity schemas stored in the database.
 *
 * This file re-exports all types from domain-specific files for backwards
 * compatibility with existing imports from '@/lib/schemas/types'.
 *
 * @module schemas/types
 */

// ============================================================================
// COMMON TYPES (version constants, enums, common schemas)
// ============================================================================
export {
  // Version constants
  SCHEMA_VERSION,
  // Enums
  ProviderEnum,
  ImageProviderEnum,
  EmbeddingProfileProviderEnum,
  RoleEnum,
  ImageTagTypeEnum,
  AvatarDisplayModeEnum,
  // Common schemas
  UUIDSchema,
  TimestampSchema,
  JsonSchema,
  EncryptedFieldSchema,
  HexColorSchema,
  TagVisualStyleSchema,
  TagStyleMapSchema,
  // Theme re-exports
  ThemePreferenceSchema,
} from './common.types';

export type {
  Provider,
  ImageProvider,
  EmbeddingProfileProvider,
  Role,
  ImageTagType,
  AvatarDisplayMode,
  EncryptedField,
  TagVisualStyle,
  TagStyleMap,
  ThemePreference,
} from './common.types';

// ============================================================================
// USER TYPES (Single-User Mode)
// ============================================================================
export { UserSchema } from './auth.types';

export type { User } from './auth.types';

// ============================================================================
// SETTINGS TYPES
// ============================================================================
export {
  CheapLLMStrategyEnum,
  EmbeddingProviderEnum,
  CheapLLMSettingsSchema,
  TimestampModeEnum,
  TimestampFormatEnum,
  TimestampConfigSchema,
  TokenDisplaySettingsSchema,
  ChatSettingsSchema,
  GeneralSettingsSchema,
} from './settings.types';

export type {
  CheapLLMStrategy,
  EmbeddingProvider,
  CheapLLMSettings,
  TimestampMode,
  TimestampFormat,
  TimestampConfig,
  TokenDisplaySettings,
  ChatSettings,
  GeneralSettings,
} from './settings.types';

// ============================================================================
// PLUGIN CONFIGURATION TYPES
// ============================================================================
export { PluginConfigSchema, PluginConfigInputSchema } from './plugin-config.types';

export type { PluginConfig, PluginConfigInput } from './plugin-config.types';

// ============================================================================
// PROFILE TYPES
// ============================================================================
export {
  ApiKeySchema,
  ConnectionProfileSchema,
  ConnectionProfilesFileSchema,
  ImageProfileSchema,
  ImageProfilesFileSchema,
  EmbeddingProfileSchema,
  EmbeddingProfilesFileSchema,
} from './profile.types';

export type {
  ApiKey,
  ConnectionProfile,
  ConnectionProfilesFile,
  ImageProfile,
  ImageProfilesFile,
  EmbeddingProfile,
  EmbeddingProfilesFile,
} from './profile.types';

// ============================================================================
// CHARACTER TYPES
// ============================================================================
export {
  CharacterSystemPromptSchema,
  PhysicalDescriptionSchema,
  CharacterSchema,
} from './character.types';

export type {
  CharacterSystemPrompt,
  PhysicalDescription,
  Character,
  CharacterInput,
} from './character.types';

// ============================================================================
// CHAT TYPES
// ============================================================================
export {
  MessageEventSchema,
  ContextSummaryEventSchema,
  SystemEventTypeEnum,
  SystemEventSchema,
  ChatEventSchema,
  ParticipantTypeEnum,
  ChatParticipantSchema,
  ChatParticipantBaseSchema,
  ChatMetadataSchema,
  ChatMetadataBaseSchema,
  ChatMetadataLegacySchema,
} from './chat.types';

export type {
  MessageEvent,
  ContextSummaryEvent,
  SystemEventType,
  SystemEvent,
  ChatEvent,
  ParticipantType,
  ChatParticipant,
  ChatParticipantBase,
  ChatParticipantBaseInput,
  ChatMetadata,
  ChatMetadataBase,
  ChatMetadataInput,
  ChatMetadataLegacy,
} from './chat.types';

// ============================================================================
// FILE TYPES
// ============================================================================
export {
  FileSourceEnum,
  FileCategoryEnum,
  FileEntrySchema,
  BinaryIndexEntrySchema,
} from './file.types';

export type {
  FileSource,
  FileCategory,
  FileEntry,
  BinaryIndexEntry,
} from './file.types';

// ============================================================================
// FOLDER TYPES
// ============================================================================
export { FolderSchema } from './folder.types';

export type { Folder, FolderInput } from './folder.types';

// ============================================================================
// FILE WRITE PERMISSION TYPES
// ============================================================================
export {
  FileWritePermissionScopeEnum,
  FileWritePermissionSchema,
  CreateFileWritePermissionSchema,
  UpdateFileWritePermissionSchema,
} from './file-permissions.types';

export type {
  FileWritePermissionScope,
  FileWritePermission,
  CreateFileWritePermission,
  UpdateFileWritePermission,
} from './file-permissions.types';

// ============================================================================
// TAG TYPES
// ============================================================================
export {
  TagSchema,
  TagsFileSchema,
} from './tag.types';

export type {
  Tag,
  TagsFile,
} from './tag.types';

// ============================================================================
// MEMORY TYPES
// ============================================================================
export {
  MemorySourceEnum,
  MemorySchema,
  MemoriesFileSchema,
} from './memory.types';

export type {
  MemorySource,
  Memory,
  MemoriesFile,
} from './memory.types';

// ============================================================================
// PROJECT TYPES
// ============================================================================
export {
  ProjectSchema,
  ProjectContextSchema,
} from './project.types';

export type {
  Project,
  ProjectInput,
  ProjectContext,
} from './project.types';

// ============================================================================
// TEMPLATE TYPES
// ============================================================================
export {
  RoleplayTemplateSchema,
  PromptTemplateSchema,
} from './template.types';

export type {
  RoleplayTemplate,
  PromptTemplate,
} from './template.types';

// ============================================================================
// JOB TYPES
// ============================================================================
export {
  BackgroundJobTypeEnum,
  BackgroundJobStatusEnum,
  BackgroundJobSchema,
} from './job.types';

export type {
  BackgroundJobType,
  BackgroundJobStatus,
  BackgroundJob,
} from './job.types';

// ============================================================================
// MODEL TYPES
// ============================================================================
export {
  ModelTypeEnum,
  ProviderModelSchema,
} from './model.types';

export type {
  ModelType,
  ProviderModel,
} from './model.types';

// ============================================================================
// LLM LOG TYPES
// ============================================================================
export {
  LLMLogTypeEnum,
  LLMLogMessageSummarySchema,
  LLMLogRequestSummarySchema,
  LLMLogResponseSummarySchema,
  LLMLogTokenUsageSchema,
  LLMLogCacheUsageSchema,
  LLMLogSchema,
} from './llm-log.types';

export type {
  LLMLogType,
  LLMLogMessageSummary,
  LLMLogRequestSummary,
  LLMLogResponseSummary,
  LLMLogTokenUsage,
  LLMLogCacheUsage,
  LLMLog,
} from './llm-log.types';

// ============================================================================
// VECTOR INDICES TYPES
// ============================================================================
export {
  VectorMetadataSchema,
  VectorEntrySchema,
  VectorIndexSchema,
} from './vector-indices.types';

export type {
  VectorMetadata,
  VectorEntry,
  VectorIndex,
} from './vector-indices.types';
