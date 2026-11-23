/**
 * Homepage Types
 *
 * Shared types for the homepage components.
 */

import type { FileEntry } from '@/lib/schemas/types'
import type { ConciergeProvenance, ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import type { ConciergeModeReason } from '@/lib/schemas/chat.types'

/** Lightweight chat data for homepage display */
export interface RecentChat {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
  /** The derived Concierge state — never a stored column */
  conciergeState?: ConciergeState
  /** Who put the chat in its state; `null` for Moderated */
  conciergeSetBy?: ConciergeProvenance
  /** Why the chat is in its state; `null` for Moderated */
  conciergeReason?: ConciergeModeReason | null
  /** The classifier's categories, shown on the mark's tooltip */
  dangerCategories?: string[]
  /** Story background image URL - displayed instead of avatars when present */
  storyBackgroundUrl?: string | null
  /** The project the chat is filed under, when it has one */
  project?: { id: string; name: string; color?: string | null } | null
  /** One plain line from the chat's context summary: where things stand */
  summaryExcerpt?: string | null
  participants: Array<{
    id: string
    type: 'CHARACTER'
    isActive: boolean
    displayOrder: number
    character?: {
      id: string
      name: string
      defaultImageId?: string
      defaultImage?: {
        id: string
        filepath: string
        url?: string
      } | null
      tags?: string[]
    } | null
  }>
  _count: {
    messages: number
  }
}

/** Lightweight project data for homepage display */
export interface HomepageProject {
  id: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  chatCount: number
  lastActivity: string // Most recent activity (file, chat message, or metadata change)
}

/** Character data for homepage grid */
export interface HomepageCharacter {
  id: string
  name: string
  title?: string | null
  defaultImageId: string | null
  defaultImage: {
    id: string
    filepath: string
    url?: string | null
  } | null
  tags?: string[]
  // Sorting fields (same as /characters page)
  isFavorite: boolean
  npc: boolean
  chatCount: number
  /** Default connection profile ID for showing provider badge */
  defaultConnectionProfileId?: string | null
  /** The most recently active chat this character sits in, for "resume" */
  latestChat?: HomepageCharacterLatestChat | null
}

/**
 * A character's latest chat. Carries what quick-hide asks about a chat, so the
 * home page can leave the link out when the chat itself is hidden.
 */
export interface HomepageCharacterLatestChat {
  id: string
  title: string
  /** Tags of every character in the chat */
  characterTags: string[]
  conciergeState?: ConciergeState
}

/** Props for WelcomeSection */
export interface WelcomeSectionProps {
  displayName: string
  /** No chats yet: greet a newcomer rather than welcome them "back" */
  firstVisit?: boolean
}

/** Props for ChatsBand: the resume card and the recent list beside it */
export interface ChatsBandProps {
  chats: RecentChat[]
}

/** Props for RecentChatsSection */
export interface RecentChatsSectionProps {
  /** Already filtered by quick-hide, newest first */
  chats: RecentChat[]
}

/** Props for ProjectsSection */
export interface ProjectsSectionProps {
  projects: HomepageProject[]
}

/** Props for CharactersSection */
export interface CharactersSectionProps {
  characters: HomepageCharacter[]
  /** How many characters there are in all, shown ones included */
  total: number
}
