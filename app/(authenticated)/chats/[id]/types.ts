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
}

export interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
  avatarDisplayStyle?: 'CIRCULAR' | 'RECTANGULAR'
  tagStyles?: Record<string, TagVisualStyle>
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

export interface ChatParticipantData {
  id: string
  type: 'CHARACTER' | 'PERSONA'
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
