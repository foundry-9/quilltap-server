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
// CONTEXT COMPRESSION SETTINGS
// ============================================================================

export const ContextCompressionSettingsSchema = z.object({
  /** Whether context compression is enabled (default: true) */
  enabled: z.boolean().default(true),
  /** Number of messages to keep in full context (sliding window size) */
  windowSize: z.number().min(3).max(10).default(5),
  /** Target token count for compressed history (500-1200 tokens) */
  compressionTargetTokens: z.number().min(300).max(2000).default(800),
  /** Target token count for compressed system prompt */
  systemPromptTargetTokens: z.number().min(500).max(3000).default(1500),
  /** How often to re-inject project context into the system prompt (0 = never after initial, matches windowSize by default) */
  projectContextReinjectInterval: z.number().min(0).max(20).default(5),
});

export type ContextCompressionSettings = z.infer<typeof ContextCompressionSettingsSchema>;

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
  /** Optional override for image prompt expansion LLM - when set, uses this instead of global cheap LLM */
  imagePromptProfileId: UUIDSchema.nullable().optional(),
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
  /** IANA timezone name override for this chat (e.g., "America/New_York") */
  timezone: z.string().nullable().optional(),
});

export type TimestampConfig = z.infer<typeof TimestampConfigSchema>;

// ============================================================================
// MEMORY CASCADE PREFERENCES
// ============================================================================

export const MemoryCascadeActionEnum = z.enum([
  'DELETE_MEMORIES',      // Delete associated memories
  'KEEP_MEMORIES',        // Keep memories (orphan them)
  'REGENERATE_MEMORIES',  // Delete old, regenerate new
  'ASK_EVERY_TIME',       // Always show confirmation dialog
]);
export type MemoryCascadeAction = z.infer<typeof MemoryCascadeActionEnum>;

export const MemoryCascadePreferencesSchema = z.object({
  /** What to do when deleting a message with associated memories */
  onMessageDelete: MemoryCascadeActionEnum.default('ASK_EVERY_TIME'),
  /** What to do when generating a new swipe (regenerating response) */
  onSwipeRegenerate: MemoryCascadeActionEnum.default('DELETE_MEMORIES'),
});

export type MemoryCascadePreferences = z.infer<typeof MemoryCascadePreferencesSchema>;

// ============================================================================
// AUTO-HOUSEKEEPING SETTINGS (Commonplace Book)
// ============================================================================

/**
 * Per-character cap override. When a characterId appears in the map, its cap
 * replaces the global `perCharacterCap` for that character only.
 */
export const AutoHousekeepingCapOverrideSchema = z.record(z.string(), z.number().int().positive());
export type AutoHousekeepingCapOverride = z.infer<typeof AutoHousekeepingCapOverrideSchema>;

export const AutoHousekeepingSettingsSchema = z.object({
  /** When true, housekeeping runs automatically (post-write watermark + scheduled sweep). Default off. */
  enabled: z.boolean().default(false),
  /** Global per-character memory cap. Housekeeping engages when count >= 80% of this. */
  perCharacterCap: z.number().int().positive().default(2000),
  /** Per-character cap overrides keyed by characterId. */
  perCharacterCapOverrides: AutoHousekeepingCapOverrideSchema.default({}),
  /** Similarity threshold for the optional merge-similar pass during housekeeping. */
  autoMergeSimilarThreshold: z.number().min(0).max(1).default(0.90),
  /** When true, housekeeping also merges semantically similar memories (on top of retention-policy deletions). */
  mergeSimilar: z.boolean().default(false),
});

export type AutoHousekeepingSettings = z.infer<typeof AutoHousekeepingSettingsSchema>;

// ============================================================================
// MEMORY EXTRACTION RATE LIMITS (Commonplace Book)
// ============================================================================

/**
 * Graduated importance floor is applied when a character's recent extraction
 * volume approaches or exceeds the configured per-hour cap:
 *   - Below `softStartFraction` of the cap: no filter (all significant candidates pass)
 *   - Between `softStartFraction` and 1.0: only candidates with importance >= `softFloor` pass
 *   - At or above 1.0: extraction is skipped entirely for this exchange
 */
export const MemoryExtractionLimitsSchema = z.object({
  /** When true, the rate limiter is active. Off by default. */
  enabled: z.boolean().default(false),
  /** Maximum memories a single character may accrue per hour before the limiter engages. */
  maxPerHour: z.number().int().positive().default(20),
  /** Fraction of maxPerHour at which the graduated floor begins to apply (0–1). */
  softStartFraction: z.number().min(0).max(1).default(0.7),
  /** Importance floor applied to new candidates while in the graduated band. */
  softFloor: z.number().min(0).max(1).default(0.7),
});

export type MemoryExtractionLimits = z.infer<typeof MemoryExtractionLimitsSchema>;

// ============================================================================
// TOKEN DISPLAY SETTINGS
// ============================================================================

export const TokenDisplaySettingsSchema = z.object({
  /** Show per-message token counts in chat */
  showPerMessageTokens: z.boolean().default(false),
  /** Show estimated cost per message */
  showPerMessageCost: z.boolean().default(false),
  /** Show chat-level token aggregation and cost */
  showChatTotals: z.boolean().default(false),
  /** Show system events (cheap LLM operations) in chat */
  showSystemEvents: z.boolean().default(false),
});

export type TokenDisplaySettings = z.infer<typeof TokenDisplaySettingsSchema>;

// ============================================================================
// LLM LOGGING SETTINGS
// ============================================================================

export const LLMLoggingSettingsSchema = z.object({
  /** Whether LLM request/response logging is enabled (default: true) */
  enabled: z.boolean().default(true),
  /** Whether to store full messages in logs (default: false for storage efficiency) */
  verboseMode: z.boolean().default(false),
  /** Number of days to retain logs, 0 = forever (default: 30) */
  retentionDays: z.number().min(0).max(365).default(30),
});

export type LLMLoggingSettings = z.infer<typeof LLMLoggingSettingsSchema>;

// ============================================================================
// DANGEROUS CONTENT SETTINGS
// ============================================================================

export const DangerousContentModeEnum = z.enum(['OFF', 'DETECT_ONLY', 'AUTO_ROUTE']);
export type DangerousContentMode = z.infer<typeof DangerousContentModeEnum>;

export const DangerousContentDisplayModeEnum = z.enum(['SHOW', 'BLUR', 'COLLAPSE']);
export type DangerousContentDisplayMode = z.infer<typeof DangerousContentDisplayModeEnum>;

export const DangerousContentSettingsSchema = z.object({
  /** Operating mode: OFF disables all scanning, DETECT_ONLY flags but doesn't reroute, AUTO_ROUTE flags and reroutes to uncensored provider */
  mode: DangerousContentModeEnum.default('OFF'),
  /** Classification threshold (0-1): content scoring above this is flagged as dangerous */
  threshold: z.number().min(0).max(1).default(0.7),
  /** Whether to scan user text messages for dangerous content */
  scanTextChat: z.boolean().default(true),
  /** Whether to scan user image prompts for dangerous content */
  scanImagePrompts: z.boolean().default(true),
  /** Whether to scan expanded prompts before image generation */
  scanImageGeneration: z.boolean().default(false),
  /** Connection profile ID for uncensored text LLM (must have isDangerousCompatible=true) */
  uncensoredTextProfileId: UUIDSchema.nullable().optional(),
  /** Image profile ID for uncensored image generation (must have isDangerousCompatible=true) */
  uncensoredImageProfileId: UUIDSchema.nullable().optional(),
  /** How flagged messages are displayed in the UI */
  displayMode: DangerousContentDisplayModeEnum.default('SHOW'),
  /** Whether to show warning badges on flagged messages */
  showWarningBadges: z.boolean().default(true),
  /** Custom classification prompt to append to the default classification system prompt */
  customClassificationPrompt: z.string().nullable().optional(),
});

export type DangerousContentSettings = z.infer<typeof DangerousContentSettingsSchema>;

// ============================================================================
// AUTO-LOCK SETTINGS
// ============================================================================

export const AutoLockSettingsSchema = z.object({
  /** Whether auto-lock is enabled (default: false) */
  enabled: z.boolean().default(false),
  /** Number of minutes of inactivity before auto-locking (default: 15, min: 1) */
  idleMinutes: z.number().int().min(1).default(15),
});

export type AutoLockSettings = z.infer<typeof AutoLockSettingsSchema>;

// ============================================================================
// AGENT MODE SETTINGS
// ============================================================================

export const AgentModeSettingsSchema = z.object({
  /** Maximum number of agent turns (iterations) before forcing final response (1-25, default: 10) */
  maxTurns: z.number().min(1).max(25).default(10),
  /** Whether agent mode is enabled by default for new chats (default: false) */
  defaultEnabled: z.boolean().default(false),
});

export type AgentModeSettings = z.infer<typeof AgentModeSettingsSchema>;

// ============================================================================
// STORY BACKGROUNDS SETTINGS
// ============================================================================

export const StoryBackgroundsSettingsSchema = z.object({
  /** Whether story background generation is enabled (default: false) */
  enabled: z.boolean().default(false),
  /** Default image profile ID to use for background generation */
  defaultImageProfileId: UUIDSchema.nullable().optional(),
});

export type StoryBackgroundsSettings = z.infer<typeof StoryBackgroundsSettingsSchema>;

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
    showNavThemeSelector: false,
  }),
  /** Sidebar width in pixels (256-512, default: 256) */
  sidebarWidth: z.number().min(256).max(512).default(256).optional(),
  /** Default timestamp configuration for new chats */
  defaultTimestampConfig: TimestampConfigSchema.default({
    mode: 'NONE',
    format: 'FRIENDLY',
    useFictionalTime: false,
    autoPrepend: true,
  }),
  /** Memory cascade preferences for message deletion/regeneration */
  memoryCascadePreferences: MemoryCascadePreferencesSchema.default({
    onMessageDelete: 'ASK_EVERY_TIME',
    onSwipeRegenerate: 'DELETE_MEMORIES',
  }),
  /** Commonplace Book auto-housekeeping settings (off by default; user opts in from the Commonplace Book tab) */
  autoHousekeepingSettings: AutoHousekeepingSettingsSchema.default({
    enabled: false,
    perCharacterCap: 2000,
    perCharacterCapOverrides: {},
    autoMergeSimilarThreshold: 0.90,
    mergeSimilar: false,
  }),
  /** Per-hour extraction rate limit for the Commonplace Book (off by default) */
  memoryExtractionLimits: MemoryExtractionLimitsSchema.default({
    enabled: false,
    maxPerHour: 20,
    softStartFraction: 0.7,
    softFloor: 0.7,
  }),
  /** Token display settings for showing usage and costs */
  tokenDisplaySettings: TokenDisplaySettingsSchema.default({
    showPerMessageTokens: false,
    showPerMessageCost: false,
    showChatTotals: false,
    showSystemEvents: false,
  }),
  /** Context compression settings for long conversations */
  contextCompressionSettings: ContextCompressionSettingsSchema.default({
    enabled: true,
    windowSize: 5,
    compressionTargetTokens: 800,
    systemPromptTargetTokens: 1500,
    projectContextReinjectInterval: 5,
  }),
  /** LLM logging settings for tracking API calls */
  llmLoggingSettings: LLMLoggingSettingsSchema.default({
    enabled: true,
    verboseMode: false,
    retentionDays: 30,
  }),
  /** Auto-detect RNG patterns (dice rolls, coin flips) in user messages and execute them automatically (default: true) */
  autoDetectRng: z.boolean().default(true),
  /** Whether new chats start in composition mode (Enter = newline, Ctrl/Cmd+Enter = submit) by default */
  compositionModeDefault: z.boolean().default(false),
  /** Agent mode settings for iterative tool use with self-correction */
  agentModeSettings: AgentModeSettingsSchema.default({
    maxTurns: 10,
    defaultEnabled: false,
  }),
  /** Story backgrounds settings for AI-generated chat backgrounds */
  storyBackgroundsSettings: StoryBackgroundsSettingsSchema.default({
    enabled: false,
    defaultImageProfileId: null,
  }),
  /** Dangerous content detection and routing settings */
  dangerousContentSettings: DangerousContentSettingsSchema.default({
    mode: 'OFF',
    threshold: 0.7,
    scanTextChat: true,
    scanImagePrompts: true,
    scanImageGeneration: false,
    displayMode: 'SHOW',
    showWarningBadges: true,
  }),
  /** Auto-lock settings for automatic idle timeout locking */
  autoLockSettings: AutoLockSettingsSchema.default({
    enabled: false,
    idleMinutes: 15,
  }),
  /** Default IANA timezone for timestamp formatting (e.g., "America/New_York"). Falls back to QUILLTAP_TIMEZONE env var or system default. */
  timezone: z.string().nullable().optional(),
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
