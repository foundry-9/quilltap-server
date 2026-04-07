/**
 * Shared types for cheap LLM task modules.
 */

import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import type { ConnectionProfile } from '@/lib/schemas/types'

/**
 * Candidate memory extracted from a conversation
 */
export interface MemoryCandidate {
  /** Whether the message contains something significant worth remembering */
  significant: boolean
  /** Full memory content (if significant) */
  content?: string
  /** Brief 1-sentence summary (if significant) */
  summary?: string
  /** Keywords for text-based search */
  keywords?: string[]
  /** Importance score from 0.0 to 1.0 */
  importance?: number
}

/**
 * Chat message format for summarization tasks
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Attachment metadata for description task
 */
export interface Attachment {
  id: string
  filename: string
  mimeType: string
  /** Base64 encoded data */
  data?: string
}

/**
 * Result of a cheap LLM task
 */
export interface CheapLLMTaskResult<T> {
  success: boolean
  result?: T
  error?: string
  /** Token usage for cost tracking */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Options for uncensored provider fallback when empty responses are detected
 * Only used when the Concierge is in AUTO_ROUTE mode with an uncensored text profile configured
 */
export interface UncensoredFallbackOptions {
  dangerSettings: DangerousContentSettings
  availableProfiles: ConnectionProfile[]
  isDangerousChat?: boolean
}

/**
 * Expansion context for image prompt crafting
 */
export interface ImagePromptExpansionContext {
  /** Original prompt with placeholders */
  originalPrompt: string
  /** Placeholder data with all available description tiers */
  placeholders: Array<{
    placeholder: string
    name: string
    /** Gender derived from pronouns: 'male', 'female', or undefined */
    gender?: string
    usageContext?: string
    tiers: {
      short?: string
      medium?: string
      long?: string
      complete?: string
    }
    clothing?: Array<{
      name: string
      usageContext?: string | null
      description?: string | null
    }>
  }>
  /** Target maximum length */
  targetLength: number
  /** Target provider (for context) */
  provider: string
  /**
   * Style trigger phrase to incorporate into the prompt.
   * When a style/LoRA is selected that has a trigger phrase,
   * the LLM should naturally incorporate this phrase into the prompt.
   */
  styleTriggerPhrase?: string
  /**
   * Name of the selected style (for context in the prompt crafting)
   */
  styleName?: string
}

/**
 * Input for scene context derivation
 */
export interface DeriveSceneContextInput {
  /** Chat title for basic context */
  chatTitle: string
  /** Existing context summary if available */
  contextSummary?: string | null
  /** Recent messages from the chat */
  recentMessages: ChatMessage[]
  /** Names of characters in the chat */
  characterNames: string[]
}

/**
 * Input for scene state tracking
 */
export interface SceneStateInput {
  /** Previous scene state JSON (null for first turn) */
  previousSceneState: Record<string, unknown> | null
  /** Character baseline data (defaults only — conversation overrides these) */
  characters: Array<{
    characterId: string
    characterName: string
    physicalDescription: string
    clothingDescription: string
    scenario?: string
  }>
  /** Messages since last scene state update (or all messages for first turn) */
  recentMessages: ChatMessage[]
  /** Current message count for tracking */
  messageCount: number
  /** Chat-level scenario/system prompt that establishes the opening scene */
  chatScenario?: string
}

/**
 * Context for story background prompt crafting
 */
export interface StoryBackgroundPromptContext {
  /** Scene context from chat title or summary */
  sceneContext: string
  /** Characters to include in the scene */
  characters: Array<{
    name: string
    description: string
  }>
  /** Target image provider for length constraints */
  provider: string
}

/**
 * Result of compressing conversation context or system prompt
 */
export interface CompressionResult {
  /** The compressed text */
  compressedText: string
  /** Approximate token count of original */
  originalTokens: number
  /** Approximate token count of compressed output */
  compressedTokens: number
}

/**
 * Result of resolving a single character's appearance from context
 */
export interface AppearanceResolutionItem {
  characterId: string
  /** ID of the selected physical description, or null to use the first/default */
  selectedDescriptionId: string | null
  /** What the character is currently wearing */
  clothingDescription: string
  /** How clothing was determined */
  clothingSource: 'narrative' | 'stored' | 'default'
}

/**
 * Input describing a character's available appearances
 */
export interface CharacterAppearanceInput {
  characterId: string
  characterName: string
  physicalDescriptions: Array<{
    id: string
    name: string
    usageContext?: string | null
    shortPrompt?: string | null
    mediumPrompt?: string | null
  }>
  clothingRecords: Array<{
    id: string
    name: string
    usageContext?: string | null
    description?: string | null
  }>
  /** Equipped wardrobe items (from the wardrobe system). Takes precedence over clothingRecords for clothing descriptions. */
  equippedWardrobeItems?: Array<{
    slot: string        // 'top', 'bottom', 'footwear', 'accessories'
    title: string
    description?: string | null
  }>
}
