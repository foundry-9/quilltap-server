/**
 * Chat Settings Types and Interfaces
 * Defines all TypeScript types and interfaces used in the chat settings module
 */

import type { LLMLoggingSettings as LLMLoggingSettingsType } from '@/lib/schemas/settings.types'

export type AvatarDisplayMode = 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
export type AvatarDisplayStyle = 'CIRCULAR' | 'RECTANGULAR'
export type CheapLLMStrategy = 'USER_DEFINED' | 'PROVIDER_CHEAPEST' | 'LOCAL_FIRST'
export type EmbeddingProvider = 'SAME_PROVIDER' | 'OPENAI' | 'LOCAL'
export type TimestampMode = 'NONE' | 'START_ONLY' | 'EVERY_MESSAGE'
export type TimestampFormat = 'ISO8601' | 'FRIENDLY' | 'DATE_ONLY' | 'TIME_ONLY' | 'CUSTOM'
export type MemoryCascadeAction = 'DELETE_MEMORIES' | 'KEEP_MEMORIES' | 'REGENERATE_MEMORIES' | 'ASK_EVERY_TIME'

/**
 * Token Display Settings
 * Controls visibility of token and cost information in the UI
 */
export interface TokenDisplaySettings {
  showPerMessageTokens: boolean
  showPerMessageCost: boolean
  showChatTotals: boolean
  showSystemEvents: boolean
}

export interface CheapLLMSettings {
  strategy: CheapLLMStrategy
  userDefinedProfileId?: string | null
  defaultCheapProfileId?: string | null
  fallbackToLocal: boolean
  embeddingProvider: EmbeddingProvider
  embeddingProfileId?: string | null
  /** Optional override for image prompt expansion LLM - when set, uses this instead of global cheap LLM */
  imagePromptProfileId?: string | null
}

export interface TimestampConfig {
  mode: TimestampMode
  format: TimestampFormat
  customFormat?: string | null
  useFictionalTime: boolean
  fictionalBaseTimestamp?: string | null
  fictionalBaseRealTime?: string | null
  autoPrepend: boolean
}

export interface MemoryCascadePreferences {
  onMessageDelete: MemoryCascadeAction
  onSwipeRegenerate: MemoryCascadeAction
}

export interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: AvatarDisplayMode
  avatarDisplayStyle: AvatarDisplayStyle
  cheapLLMSettings: CheapLLMSettings
  imageDescriptionProfileId?: string | null
  defaultTimestampConfig?: TimestampConfig
  memoryCascadePreferences?: MemoryCascadePreferences
  tokenDisplaySettings?: TokenDisplaySettings
  contextCompressionSettings?: ContextCompressionSettings
  llmLoggingSettings?: LLMLoggingSettings
  /** Auto-detect RNG patterns (dice rolls, coin flips) in user messages and execute them automatically */
  autoDetectRng?: boolean
  createdAt: string
  updatedAt: string
}

export interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

export interface ConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
  isCheap?: boolean
  apiKeyId?: string
  apiKey?: ApiKey | null
}

export interface EmbeddingProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
  apiKeyId?: string
  apiKey?: ApiKey | null
}

/**
 * Avatar Display Mode Options
 * Defines the available avatar display modes with labels and descriptions
 */
export const AVATAR_MODES = [
  {
    value: 'ALWAYS' as const,
    label: 'Always Show Avatars',
    description: 'Display avatar for every message (character on left, user on right)',
  },
  {
    value: 'GROUP_ONLY' as const,
    label: 'Group Chats Only',
    description: 'Only show avatars in group chats (will be implemented in the future)',
  },
  {
    value: 'NEVER' as const,
    label: 'Never Show Avatars',
    description: 'Hide avatars in all chats',
  },
] as const

/**
 * Avatar Display Style Options
 * Defines the available avatar display styles with labels, descriptions, and visual previews
 */
export const AVATAR_STYLES = [
  {
    value: 'CIRCULAR' as const,
    label: 'Circular',
    description: 'Display avatars as circles',
    preview: '⭕',
  },
  {
    value: 'RECTANGULAR' as const,
    label: 'Rectangular (5:4)',
    description: 'Display avatars as rectangles with 5:4 aspect ratio',
    preview: '▭',
  },
] as const

/**
 * Vision-Capable Providers
 * List of providers that support vision/image analysis capabilities
 */
export const VISION_PROVIDERS = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROK'] as const

/**
 * Timestamp Injection Mode Options
 * Defines when timestamps should be injected into system prompts
 */
export const TIMESTAMP_MODES = [
  {
    value: 'NONE' as const,
    label: 'Disabled',
    description: 'No timestamp injection',
  },
  {
    value: 'START_ONLY' as const,
    label: 'Conversation Start',
    description: 'Include timestamp only in the initial system prompt',
  },
  {
    value: 'EVERY_MESSAGE' as const,
    label: 'Every Message',
    description: 'Update timestamp with each message sent',
  },
] as const

/**
 * Timestamp Format Options
 * Defines how timestamps should be formatted
 */
export const TIMESTAMP_FORMATS = [
  {
    value: 'FRIENDLY' as const,
    label: 'Friendly',
    description: 'Human-readable format (e.g., "March 15, 2024 at 2:30 PM")',
    example: 'March 15, 2024 at 2:30 PM',
  },
  {
    value: 'ISO8601' as const,
    label: 'ISO 8601',
    description: 'Standard machine-readable format',
    example: '2024-03-15T14:30:00Z',
  },
  {
    value: 'DATE_ONLY' as const,
    label: 'Date Only',
    description: 'Just the date, no time',
    example: 'March 15, 2024',
  },
  {
    value: 'TIME_ONLY' as const,
    label: 'Time Only',
    description: 'Just the time, no date',
    example: '2:30 PM',
  },
  {
    value: 'CUSTOM' as const,
    label: 'Custom',
    description: 'Use a custom format string (date-fns tokens)',
    example: '',
  },
] as const

/**
 * Default timestamp configuration
 */
export const DEFAULT_TIMESTAMP_CONFIG: TimestampConfig = {
  mode: 'NONE',
  format: 'FRIENDLY',
  useFictionalTime: false,
  autoPrepend: true,
}

/**
 * Memory Cascade Action Options
 * Defines what to do with memories when messages are deleted or regenerated
 */
export const MEMORY_CASCADE_ACTIONS = [
  {
    value: 'ASK_EVERY_TIME' as const,
    label: 'Ask every time',
    description: 'Show a confirmation dialog to choose what to do',
  },
  {
    value: 'DELETE_MEMORIES' as const,
    label: 'Always delete memories',
    description: 'Automatically delete associated memories',
  },
  {
    value: 'KEEP_MEMORIES' as const,
    label: 'Always keep memories',
    description: 'Keep memories (they will become orphaned)',
  },
  {
    value: 'REGENERATE_MEMORIES' as const,
    label: 'Delete and regenerate',
    description: 'Delete old memories and extract new ones from context',
  },
] as const

/**
 * Default memory cascade preferences
 */
export const DEFAULT_MEMORY_CASCADE_PREFERENCES: MemoryCascadePreferences = {
  onMessageDelete: 'ASK_EVERY_TIME',
  onSwipeRegenerate: 'DELETE_MEMORIES',
}

/**
 * Default token display settings
 */
export const DEFAULT_TOKEN_DISPLAY_SETTINGS: TokenDisplaySettings = {
  showPerMessageTokens: false,
  showPerMessageCost: false,
  showChatTotals: false,
  showSystemEvents: false,
}

/**
 * Context Compression Settings
 * Controls how older messages are compressed to reduce token costs
 */
export interface ContextCompressionSettings {
  enabled: boolean
  windowSize: number
  compressionTargetTokens: number
  systemPromptTargetTokens: number
  /** How often to re-inject project context (0 = never after initial, must be >= windowSize) */
  projectContextReinjectInterval: number
}

/**
 * Default context compression settings
 */
export const DEFAULT_CONTEXT_COMPRESSION_SETTINGS: ContextCompressionSettings = {
  enabled: true,
  windowSize: 5,
  compressionTargetTokens: 800,
  systemPromptTargetTokens: 1500,
  projectContextReinjectInterval: 5,
}

/**
 * Token Display Options
 * Defines the available token display toggles
 */
export const TOKEN_DISPLAY_OPTIONS = [
  {
    key: 'showPerMessageTokens' as const,
    label: 'Show Token Count on Messages',
    description: 'Display the number of prompt and completion tokens for each message',
  },
  {
    key: 'showPerMessageCost' as const,
    label: 'Show Cost Estimate on Messages',
    description: 'Display estimated cost for each message (requires pricing data)',
  },
  {
    key: 'showChatTotals' as const,
    label: 'Show Chat Token Totals',
    description: 'Display aggregate token counts and cost at the top of the chat',
  },
  {
    key: 'showSystemEvents' as const,
    label: 'Show System Events in Chat',
    description: 'Display background LLM operations (memory extraction, summarization, etc.) in the chat timeline',
  },
] as const

/**
 * LLM Logging Settings
 * Re-exported from schema types for use in chat settings components
 */
export type LLMLoggingSettings = LLMLoggingSettingsType

/**
 * Default LLM logging settings
 */
export const DEFAULT_LLM_LOGGING_SETTINGS: LLMLoggingSettings = {
  enabled: true,
  verboseMode: false,
  retentionDays: 30,
}

/**
 * Automation Settings Options
 * Defines the available automation toggles
 */
export const AUTOMATION_OPTIONS = [
  {
    key: 'autoDetectRng' as const,
    label: 'Auto-Detect RNG Calls',
    description: 'Automatically detect dice rolls (e.g., 2d6), coin flips, and "spin the bottle" in your messages and execute them',
  },
] as const

/**
 * Default automation settings
 */
export const DEFAULT_AUTO_DETECT_RNG = true
