/**
 * Project Detail Page Types
 *
 * Shared types for the project detail page components.
 */

export interface ProjectCharacter {
  id: string
  name: string
  avatarUrl?: string | null
  defaultImageId?: string | null
  defaultImage?: {
    id: string
    filepath: string
    url?: string | null
  } | null
  tags?: string[]
  chatCount: number
}

export interface ProjectChatParticipant {
  id: string
  name: string
  avatarUrl?: string | null
  defaultImage?: {
    id: string
    filepath: string
    url?: string | null
  } | null
  tags?: string[]
}

export interface ProjectChatTag {
  tag: {
    id: string
    name: string
  }
}

export interface ProjectChat {
  id: string
  title?: string | null
  messageCount: number
  participants: ProjectChatParticipant[]
  tags?: ProjectChatTag[]
  lastMessageAt?: string | null
  updatedAt: string
  storyBackground?: {
    id: string
    filepath: string
  } | null
  isDangerousChat?: boolean
}

export interface ProjectFile {
  id: string
  originalFilename: string
  mimeType: string
  size: number
  category: string
  createdAt: string
}

export type BackgroundDisplayMode = 'latest_chat' | 'project' | 'static' | 'theme'

export interface Project {
  id: string
  name: string
  description?: string | null
  instructions?: string | null
  allowAnyCharacter: boolean
  defaultAgentModeEnabled?: boolean | null
  defaultAvatarGenerationEnabled?: boolean | null
  defaultImageProfileId?: string | null
  defaultAlertCharactersOfLanternImages?: boolean | null
  color?: string | null
  icon?: string | null
  characterRoster: ProjectCharacter[]
  defaultDisabledTools?: string[]
  defaultDisabledToolGroups?: string[]
  // Story backgrounds fields
  storyBackgroundsEnabled?: boolean | null
  staticBackgroundImageId?: string | null
  storyBackgroundImageId?: string | null
  backgroundDisplayMode?: BackgroundDisplayMode
  createdAt: string
  updatedAt: string
}

export interface EditForm {
  name: string
  description: string
  instructions: string
}

export type TabType = 'chats' | 'files' | 'characters' | 'settings'
