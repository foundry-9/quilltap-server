/**
 * Shared Type Definitions - Barrel File
 *
 * Central re-export file for all schema types used across the application.
 * These correspond to entity schemas stored in MongoDB.
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
  SYNC_PROTOCOL_VERSION,
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
// AUTHENTICATION TYPES
// ============================================================================
export {
  TOTPSecretSchema,
  BackupCodesSchema,
  TOTPAttemptsSchema,
  TrustedDeviceSchema,
  UserSchema,
  AccountSchema,
  SessionSchema,
  VerificationTokenSchema,
  AuthAccountsSchema,
} from './auth.types';

export type {
  TOTPSecret,
  BackupCodes,
  TOTPAttempts,
  TrustedDevice,
  User,
  Account,
  Session,
  VerificationToken,
  AuthAccounts,
} from './auth.types';

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
  ChatSettings,
  GeneralSettings,
} from './settings.types';

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
// PERSONA TYPES
// ============================================================================
export {
  PersonaSchema,
} from './persona.types';

export type {
  Persona,
} from './persona.types';

// ============================================================================
// CHAT TYPES
// ============================================================================
export {
  MessageEventSchema,
  ContextSummaryEventSchema,
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
