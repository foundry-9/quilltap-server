import type { TagVisualStyle } from '@/lib/schemas/types'

export interface MessageAttachment {
  id: string
  filename: string
  filepath: string
  mimeType: string
}

export interface Message {
  id: string
  role: string
  content: string
  createdAt: string
  swipeGroupId?: string | null
  swipeIndex?: number | null
  attachments?: MessageAttachment[]
  debugMemoryLogs?: string[]
  participantId?: string | null
  /** Input/prompt tokens for this message */
  promptTokens?: number | null
  /** Output/completion tokens for this message */
  completionTokens?: number | null
  /** Total tokens (promptTokens + completionTokens) */
  tokenCount?: number | null
  /** Embedded tool messages that belong to this assistant message */
  toolCalls?: Message[]
  /** Server-side pre-rendered HTML for simple messages (no tools, no attachments) */
  renderedHtml?: string | null
}

export interface CharacterData {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  } | null
  talkativeness?: number
}

export interface PersonaData {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  } | null
}

export interface ConnectionProfileData {
  id: string
  name: string
  provider?: string
  modelName?: string
  apiKey?: {
    id: string
    provider: string
    label?: string
  } | null
}

export interface Participant {
  id: string
  type: 'CHARACTER' | 'PERSONA'
  controlledBy?: 'llm' | 'user'
  displayOrder: number
  isActive: boolean
  systemPromptOverride?: string | null
  characterId?: string | null
  personaId?: string | null
  character?: CharacterData | null
  persona?: PersonaData | null
  connectionProfile?: ConnectionProfileData | null
  imageProfile?: {
    id: string
    name: string
    provider: string
    modelName: string
  } | null
  // Multi-character chat fields
  hasHistoryAccess?: boolean
  joinScenario?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface Chat {
  id: string
  title: string
  roleplayTemplateId?: string | null
  participants: Participant[]
  user: {
    id: string
    name?: string | null
    image?: string | null
  }
  messages: Message[]
  /** Last participant whose turn it was (null = user's turn). Used to restore turn state when returning to chat. */
  lastTurnParticipantId?: string | null
  /** Whether auto-responses are paused in multi-character chats */
  isPaused?: boolean
  /** Whether the user has manually renamed this chat (disables auto-renaming) */
  isManuallyRenamed?: boolean
  /** Array of participant IDs the user is currently impersonating */
  impersonatingParticipantIds?: string[]
  /** Which impersonated participant is currently "active" for typing */
  activeTypingParticipantId?: string | null
  /** Turns since last user input or pause (for all-LLM pause logic) */
  allLLMPauseTurnCount?: number
  /** Whether document editing mode is enabled (Enter = newline, Ctrl/Cmd+Enter = submit) */
  documentEditingMode?: boolean
  /** Whether agent mode is enabled for this chat */
  agentModeEnabled?: boolean | null
  /** Project ID this chat belongs to (if any) */
  projectId?: string | null
  /** Project name for display purposes */
  projectName?: string | null
  /** List of tool IDs that are disabled for this chat */
  disabledTools?: string[]
  /** Groups of tools that are disabled for this chat */
  disabledToolGroups?: string[]
}

export type MemoryCascadeAction = 'DELETE_MEMORIES' | 'KEEP_MEMORIES' | 'REGENERATE_MEMORIES' | 'ASK_EVERY_TIME'

export interface MemoryCascadePreferences {
  onMessageDelete: MemoryCascadeAction
  onSwipeRegenerate: MemoryCascadeAction
}

export interface TokenDisplaySettings {
  showPerMessageTokens: boolean
  showPerMessageCost: boolean
  showChatTotals: boolean
  showSystemEvents: boolean
}

export interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
  avatarDisplayStyle?: 'CIRCULAR' | 'RECTANGULAR'
  tagStyles?: Record<string, TagVisualStyle>
  memoryCascadePreferences?: MemoryCascadePreferences
  tokenDisplaySettings?: TokenDisplaySettings
  createdAt: string
  updatedAt: string
}

export interface AttachedFile {
  id: string
  filename: string
  filepath: string
  mimeType: string
  url?: string
}

/**
 * Pending tool result - shown in composer before sending
 */
export interface PendingToolResult {
  /** Unique ID for this pending result */
  id: string
  /** Tool name (e.g., 'rng') */
  tool: string
  /** Tool display name (e.g., 'Random Number Generator') */
  displayName: string
  /** Icon for the tool (emoji) */
  icon: string
  /** Short summary for chip display (e.g., '🎲 d20: 17') */
  summary: string
  /** Full formatted result for tooltip */
  formattedResult: string
  /** Human-readable request description (e.g., 'Roll a d20') */
  requestPrompt: string
  /** Raw arguments for recreating the request */
  arguments: Record<string, unknown>
  /** Whether the tool execution was successful */
  success: boolean
  /** Timestamp when result was generated */
  createdAt: string
}

export interface ChatParticipantData {
  id: string
  type: 'CHARACTER' | 'PERSONA'
  controlledBy?: 'llm' | 'user'
  displayOrder: number
  isActive: boolean
  character: {
    id: string
    name: string
    title?: string | null
    avatarUrl?: string
    defaultImage?: {
      url?: string
      filepath?: string
    } | null
  } | null
  persona: {
    id: string
    name: string
    title?: string | null
    avatarUrl?: string
    defaultImage?: {
      url?: string
      filepath?: string
    } | null
  } | null
  connectionProfile?: ConnectionProfileData | null
}

export type Character = CharacterData
