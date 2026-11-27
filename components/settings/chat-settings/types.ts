/**
 * Chat Settings Types and Interfaces
 * Defines all TypeScript types and interfaces used in the chat settings module
 */

import type { z } from 'zod'
import {
  AgentModeSettingsSchema,
  AnswerConfirmationSettingsSchema,
  AutonomousRoomSettingsSchema,
  ChatSettingsSchema,
  ContextCompressionSettingsSchema,
  CoreWhisperSettingsSchema,
  DEFAULT_DYNAMIC_BACKGROUNDS_SETTINGS as SERVER_DEFAULT_DYNAMIC_BACKGROUNDS_SETTINGS,
  LLMLoggingSettingsSchema,
  MemoryCascadePreferencesSchema,
  SmartTypographySettingsSchema,
  ThinkingDisplaySettingsSchema,
  TokenDisplaySettingsSchema,
  WardrobeImageSettingsSchema,
} from '@/lib/schemas/settings.types'
import type {
  AgentModeSettings as AgentModeSettingsType,
  AnswerConfirmationSettings as AnswerConfirmationSettingsType,
  AutoLockSettings as AutoLockSettingsType,
  AutonomousRoomSettings as AutonomousRoomSettingsType,
  CheapLLMSettings as CheapLLMSettingsType,
  ConciergeSettings as ConciergeSettingsType,
  ConciergeDisplaySettings,
  ConciergePreScreenSettings,
  ContextCompressionSettings as ContextCompressionSettingsType,
  CoreWhisperSettings as CoreWhisperSettingsType,
  DynamicBackgroundsSettings as DynamicBackgroundsSettingsType,
  ImpersonationVoiceMode,
  LLMLoggingSettings as LLMLoggingSettingsType,
  MemoryCascadePreferences as MemoryCascadePreferencesType,
  SmartTypographySettings as SmartTypographySettingsType,
  StoryBackgroundsSettings as StoryBackgroundsSettingsType,
  ThinkingDisplaySettings as ThinkingDisplaySettingsType,
  TimestampConfig as TimestampConfigType,
  TokenDisplaySettings as TokenDisplaySettingsType,
  WardrobeImageSettings as WardrobeImageSettingsType,
} from '@/lib/schemas/settings.types'
import type { AvatarDisplayMode } from '@/lib/schemas/common.types'
import { DEFAULT_CONCIERGE_SETTINGS as SERVER_DEFAULT_CONCIERGE_SETTINGS } from '@/lib/services/dangerous-content/resolver.service'
import type { ApiKeyRow, ImageProfileRow } from '@/lib/hooks/use-profiles'

/*
 * The settings shapes and their defaults are the server's (`lib/schemas/
 * settings.types.ts`): each type is the schema's inferred type and each
 * default is what the schema fills in for an empty object, so the client can
 * never drift from what the server would store.
 */

type ChatSettingsShape = typeof ChatSettingsSchema.shape

/** What the server stores for a top-level chat-settings key that was never set. */
function chatSettingDefault<K extends keyof ChatSettingsShape>(key: K): z.output<ChatSettingsShape[K]> {
  return ChatSettingsSchema.shape[key].parse(undefined) as z.output<ChatSettingsShape[K]>
}

export type { AvatarDisplayMode, ImpersonationVoiceMode }
export type {
  CheapLLMStrategy,
  EmbeddingProvider,
  MemoryCascadeAction,
  TimestampFormat,
  TimestampMode,
} from '@/lib/schemas/settings.types'
export type AvatarDisplayStyle = 'CIRCULAR' | 'RECTANGULAR'

/**
 * Token Display Settings
 * Controls visibility of token and cost information in the UI
 */
export type TokenDisplaySettings = TokenDisplaySettingsType

export type CheapLLMSettings = CheapLLMSettingsType

export type TimestampConfig = TimestampConfigType

export type MemoryCascadePreferences = MemoryCascadePreferencesType

/**
 * Story Backgrounds Settings
 * Controls AI-generated background images for chats
 */
export type StoryBackgroundsSettings = StoryBackgroundsSettingsType

/**
 * Wardrobe Image Settings
 * The designated image profile that draws pictures of wardrobe items.
 * `imageProfileId: null` = the default image profile.
 */
export type WardrobeImageSettings = WardrobeImageSettingsType

/**
 * Dynamic Backgrounds
 * The collage behind the home, project and character pages.
 */
export type DynamicBackgroundsSettings = DynamicBackgroundsSettingsType

export type AutoLockSettings = AutoLockSettingsType

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
  /** Whether Pascal's custom pseudo-tools are offered to models and the composer gutter button is shown */
  customTools?: boolean
  /** Whether a custom tool's trigger phrases, said by anyone in a chat, run it automatically with its defaults */
  customToolTriggers?: boolean
  /** Whether a custom tool marked intervenable is held for the operator's say-so before Pascal announces it */
  customToolIntervention?: boolean
  /** Whether new chats start in composition mode by default */
  compositionModeDefault?: boolean
  /** Whether browser spellcheck is enabled in the composer and rich-text Document Mode editor */
  composerSpellcheck?: boolean
  /** Whether the `:` emoji typeahead fires in the composer and Document Mode editor (the toolbar picker is not gated by this) */
  composerEmoji?: boolean
  /** Whether the `\` Unicode typeahead fires in the composer and Document Mode editor (the toolbar picker is not gated by this) */
  composerUnicode?: boolean
  /** Whether `/` opens the slash-command menu in the Salon composer (the gutter buttons and sidebar are not gated by this) */
  composerSlashCommands?: boolean
  /** What happens to a line typed while impersonating a character: posts as typed ('off'), opens the review dialog without a model call ('ask'), or opens it and restates at once ('always') */
  impersonationVoiceMode?: ImpersonationVoiceMode
  /** Master switch for user-defined word-boundary text replacements in the composer and Document Mode editor */
  textReplacementsEnabled?: boolean
  /** Whether the Salon auto-scrolls to the newest message when a response completes (only when already near the bottom) */
  autoScrollOnResponseComplete?: boolean
  /** Agent mode settings for iterative tool use with self-correction */
  agentModeSettings?: AgentModeSettings
  /** Story backgrounds settings for AI-generated chat backgrounds */
  storyBackgroundsSettings?: StoryBackgroundsSettings
  /** The image profile that draws wardrobe item pictures */
  wardrobeImageSettings?: WardrobeImageSettings
  /** The changing collage behind the home, project and character pages */
  dynamicBackgrounds?: DynamicBackgroundsSettings
  /** The Concierge: failover, the uncensored desk, display, and the optional pre-screen */
  conciergeSettings?: ConciergeSettings
  /** Default IANA timezone for timestamp formatting */
  timezone?: string | null
  /** 4.6 Private Character Rooms — user-level defaults */
  autonomousRoomSettings?: AutonomousRoomSettings
  /** Aurora's Core whisper — global defaults */
  coreWhisper?: CoreWhisperSettings
  /** Thinking / reasoning display — global defaults. DISPLAY ONLY. */
  thinkingDisplay?: ThinkingDisplaySettings
  /** Answer confirmation — global default for the Salon consistency check. */
  answerConfirmationSettings?: AnswerConfirmationSettings
  /** Smart typography — render-time curly quotes plus type-time dashes/ellipsis. */
  smartTypographySettings?: SmartTypographySettings
  /** The roleplay template a new chat starts with */
  defaultRoleplayTemplateId?: string | null
  /** Lock the app after a stretch of idleness (requires a passphrase) */
  autoLockSettings?: AutoLockSettings
  createdAt: string
  updatedAt: string
}

/**
 * Thinking / reasoning display — global defaults for showing reasoning models'
 * chain-of-thought in the Salon. Per-chat override (`showThinking`, tri-state)
 * lives on the chat row. DISPLAY ONLY.
 */
export type ThinkingDisplaySettings = ThinkingDisplaySettingsType

export const DEFAULT_THINKING_DISPLAY_SETTINGS: ThinkingDisplaySettings = ThinkingDisplaySettingsSchema.parse({})

/**
 * Answer confirmation — global default for the Salon consistency check that
 * vets a character's tool-using reply against what it recalled and looked up.
 * Off by default; a per-project or per-chat override can flip it on.
 */
export type AnswerConfirmationSettings = AnswerConfirmationSettingsType

export const DEFAULT_ANSWER_CONFIRMATION_SETTINGS: AnswerConfirmationSettings = AnswerConfirmationSettingsSchema.parse({})

/**
 * Smart typography — two mechanisms split by confidence.
 *
 * `displayQuotes` curls quotes at *render* time only: the stored message keeps
 * its straight quotes, so the model, the embeddings and every export are
 * unaffected and turning the toggle off restores the old appearance everywhere.
 *
 * `dashes` and `ellipsis` write real characters into the text as it is typed,
 * because a writer typing `--` means a dash. Both are undone by one Backspace.
 */
export type SmartTypographySettings = SmartTypographySettingsType

export const DEFAULT_SMART_TYPOGRAPHY_SETTINGS: SmartTypographySettings = SmartTypographySettingsSchema.parse({})

/**
 * Aurora's Core whisper — global defaults. Per-chat and per-character overrides
 * live on chat / character rows. Precedence: chat → character → global.
 */
export type CoreWhisperSettings = CoreWhisperSettingsType

export const DEFAULT_CORE_WHISPER_SETTINGS: CoreWhisperSettings = CoreWhisperSettingsSchema.parse({})

/**
 * 4.6 Private Character Rooms — user-level defaults applied across the
 * householder's autonomous rooms. Per-room overrides live on the chat row.
 */
export type AutonomousRoomSettings = AutonomousRoomSettingsType

export const DEFAULT_AUTONOMOUS_ROOM_SETTINGS: AutonomousRoomSettings = AutonomousRoomSettingsSchema.parse({})

/** An API key row, as every settings list reads it. */
export type ApiKey = ApiKeyRow

export interface ConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
  isCheap?: boolean
  isDangerousCompatible?: boolean
  supportsImageUpload?: boolean
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

/** An image profile row, as every settings list reads it. */
export type ImageProfile = ImageProfileRow

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
  {
    value: 'EVERY_N_MINUTES' as const,
    label: 'Every X Minutes',
    description: 'Have the Host announce the time only when at least this many minutes have passed since the last announcement',
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
 * Default timestamp configuration. Defined with the timestamp helpers that
 * consume it and re-exported here so the settings form keeps its usual import.
 */
export { DEFAULT_TIMESTAMP_CONFIG } from '@/lib/chat/timestamp-utils'

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
export const DEFAULT_MEMORY_CASCADE_PREFERENCES: MemoryCascadePreferences = MemoryCascadePreferencesSchema.parse({})

/**
 * Default token display settings
 */
export const DEFAULT_TOKEN_DISPLAY_SETTINGS: TokenDisplaySettings = TokenDisplaySettingsSchema.parse({})

/**
 * Context Compression Settings
 * Controls how older messages are compressed to reduce token costs
 */
export type ContextCompressionSettings = ContextCompressionSettingsType

/**
 * Default context compression settings
 */
export const DEFAULT_CONTEXT_COMPRESSION_SETTINGS: ContextCompressionSettings = ContextCompressionSettingsSchema.parse({})

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
 */
export type LLMLoggingSettings = LLMLoggingSettingsType

/**
 * Default LLM logging settings
 */
export const DEFAULT_LLM_LOGGING_SETTINGS: LLMLoggingSettings = LLMLoggingSettingsSchema.parse({})

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
  {
    key: 'customToolTriggers' as const,
    label: 'Auto-Run Custom Tools on Trigger Phrases',
    description: 'When anyone in a chat says a phrase one of Pascal\'s custom tools declares, run that tool automatically with its defaults. Requires Custom Tools.',
  },
  {
    key: 'customToolIntervention' as const,
    label: 'Hold intervenable rolls for me',
    description: 'A custom tool marked for intervention pauses for your say-so before Pascal announces it. A held roll waits for you indefinitely; switch this off and every roll goes ahead as dealt, which is how a chat may be left to run unattended. Requires Custom Tools.',
  },
] as const

/** The settings an Automation row toggles. */
export type AutomationKey = (typeof AUTOMATION_OPTIONS)[number]['key']

/**
 * Default automation settings
 */
export const DEFAULT_AUTO_DETECT_RNG = chatSettingDefault('autoDetectRng')

/**
 * Default custom-tools setting
 */
export const DEFAULT_CUSTOM_TOOLS = chatSettingDefault('customTools')

/**
 * Default trigger-phrase setting — off: overhearing is a surprise the first time
 */
export const DEFAULT_CUSTOM_TOOL_TRIGGERS = chatSettingDefault('customToolTriggers')

/**
 * Default intervention setting — on: a held roll is the safe state, and the operator opts out to run unattended
 */
export const DEFAULT_CUSTOM_TOOL_INTERVENTION = chatSettingDefault('customToolIntervention')

/** Defaults for the composer and Salon toggles, read where a stored row lacks the key. */
export const DEFAULT_COMPOSITION_MODE_DEFAULT = chatSettingDefault('compositionModeDefault')
export const DEFAULT_COMPOSER_SPELLCHECK = chatSettingDefault('composerSpellcheck')
export const DEFAULT_COMPOSER_EMOJI = chatSettingDefault('composerEmoji')
export const DEFAULT_COMPOSER_UNICODE = chatSettingDefault('composerUnicode')
export const DEFAULT_COMPOSER_SLASH_COMMANDS = chatSettingDefault('composerSlashCommands')
export const DEFAULT_IMPERSONATION_VOICE_MODE = chatSettingDefault('impersonationVoiceMode')
export const DEFAULT_TEXT_REPLACEMENTS_ENABLED = chatSettingDefault('textReplacementsEnabled')
export const DEFAULT_AUTO_SCROLL_ON_RESPONSE_COMPLETE = chatSettingDefault('autoScrollOnResponseComplete')

/**
 * Agent Mode Settings
 * Controls iterative tool use with self-correction
 */
export type AgentModeSettings = AgentModeSettingsType

/**
 * Default agent mode settings
 */
export const DEFAULT_AGENT_MODE_SETTINGS: AgentModeSettings = AgentModeSettingsSchema.parse({})

/**
 * Default story backgrounds settings. Spelled out rather than parsed: the
 * schema leaves `defaultImageProfileId` absent, and this explicit `null` is
 * what a merged save sends today.
 */
export const DEFAULT_STORY_BACKGROUNDS_SETTINGS: StoryBackgroundsSettings = {
  enabled: false,
  defaultImageProfileId: null,
}

/**
 * Default wardrobe image settings — no designated profile, so the default image profile draws;
 * the wardrobe tools do not queue pictures.
 */
export const DEFAULT_WARDROBE_IMAGE_SETTINGS: WardrobeImageSettings = WardrobeImageSettingsSchema.parse({})

/** Default dynamic-backgrounds settings — off, uncensored pictures kept out, a new collage every three minutes. */
export const DEFAULT_DYNAMIC_BACKGROUNDS_SETTINGS: DynamicBackgroundsSettings = SERVER_DEFAULT_DYNAMIC_BACKGROUNDS_SETTINGS

/**
 * The Concierge's settings.
 */
export type ConciergeSettings = ConciergeSettingsType

/**
 * A partial Concierge update: top-level fields replace, `display` and
 * `preScreen` deep-merge (see `handleConciergeUpdate` in `useChatSettings`).
 */
export type ConciergeSettingsUpdate =
  Partial<Omit<ConciergeSettings, 'display' | 'preScreen'>> & {
    display?: Partial<ConciergeDisplaySettings>
    preScreen?: Partial<ConciergePreScreenSettings>
  }

/**
 * Default Concierge settings — the server's defaults, single-sourced.
 */
export const DEFAULT_CONCIERGE_SETTINGS: ConciergeSettings = SERVER_DEFAULT_CONCIERGE_SETTINGS
