/**
 * Homepage Types
 *
 * Shared types for the homepage components.
 */

import type { FileEntry } from '@/lib/schemas/types'

/** Lightweight chat data for homepage display */
export interface RecentChat {
  id: string
  title: string
  updatedAt: string
  participants: Array<{
    id: string
    type: 'CHARACTER' | 'PERSONA'
    isActive: boolean
    displayOrder: number
    character?: {
      id: string
      name: string
      avatarUrl?: string
      defaultImageId?: string
      defaultImage?: {
        id: string
        filepath: string
        url?: string
      } | null
      tags?: string[]
    } | null
    persona?: {
      id: string
      name: string
      title?: string | null
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
  updatedAt: string
}

/** Character data for homepage grid */
export interface HomepageCharacter {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string | null
  defaultImageId: string | null
  defaultImage: {
    id: string
    filepath: string
    url?: string | null
  } | null
  tags?: string[]
}

/** Props for WelcomeSection */
export interface WelcomeSectionProps {
  displayName: string
}

/** Props for QuickActionsRow */
export interface QuickActionsRowProps {
  lastChatId: string | null
}

/** Props for RecentChatsSection */
export interface RecentChatsSectionProps {
  chats: RecentChat[]
}

/** Props for ProjectsSection */
export interface ProjectsSectionProps {
  projects: HomepageProject[]
}

/** Props for CharactersSection */
export interface CharactersSectionProps {
  characters: HomepageCharacter[]
}
