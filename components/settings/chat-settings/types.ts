/**
 * Chat Settings Types and Interfaces
 * Defines all TypeScript types and interfaces used in the chat settings module
 */

export type AvatarDisplayMode = 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
export type AvatarDisplayStyle = 'CIRCULAR' | 'RECTANGULAR'
export type CheapLLMStrategy = 'USER_DEFINED' | 'PROVIDER_CHEAPEST' | 'LOCAL_FIRST'
export type EmbeddingProvider = 'SAME_PROVIDER' | 'OPENAI' | 'LOCAL'
export type TimestampMode = 'NONE' | 'START_ONLY' | 'EVERY_MESSAGE'
export type TimestampFormat = 'ISO8601' | 'FRIENDLY' | 'DATE_ONLY' | 'TIME_ONLY' | 'CUSTOM'

export interface CheapLLMSettings {
  strategy: CheapLLMStrategy
  userDefinedProfileId?: string | null
  defaultCheapProfileId?: string | null
  fallbackToLocal: boolean
  embeddingProvider: EmbeddingProvider
  embeddingProfileId?: string | null
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

export interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: AvatarDisplayMode
  avatarDisplayStyle: AvatarDisplayStyle
  cheapLLMSettings: CheapLLMSettings
  imageDescriptionProfileId?: string | null
  defaultTimestampConfig?: TimestampConfig
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
