/**
 * Chat Settings Types and Interfaces
 * Defines all TypeScript types and interfaces used in the chat settings module
 */

export type AvatarDisplayMode = 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
export type AvatarDisplayStyle = 'CIRCULAR' | 'RECTANGULAR'
export type CheapLLMStrategy = 'USER_DEFINED' | 'PROVIDER_CHEAPEST' | 'LOCAL_FIRST'
export type EmbeddingProvider = 'SAME_PROVIDER' | 'OPENAI' | 'LOCAL'

export interface CheapLLMSettings {
  strategy: CheapLLMStrategy
  userDefinedProfileId?: string | null
  defaultCheapProfileId?: string | null
  fallbackToLocal: boolean
  embeddingProvider: EmbeddingProvider
  embeddingProfileId?: string | null
}

export interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: AvatarDisplayMode
  avatarDisplayStyle: AvatarDisplayStyle
  cheapLLMSettings: CheapLLMSettings
  imageDescriptionProfileId?: string | null
  createdAt: string
  updatedAt: string
}

export interface ConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
  isCheap?: boolean
}

export interface EmbeddingProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
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
