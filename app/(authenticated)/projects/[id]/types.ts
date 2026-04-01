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
  updatedAt: string
}

export interface ProjectFile {
  id: string
  originalFilename: string
  mimeType: string
  size: number
  category: string
  createdAt: string
}

export interface Project {
  id: string
  name: string
  description?: string | null
  instructions?: string | null
  allowAnyCharacter: boolean
  color?: string | null
  icon?: string | null
  characterRoster: ProjectCharacter[]
  mountPointId?: string | null
  createdAt: string
  updatedAt: string
}

export interface MountPointInfo {
  id: string
  name: string
  backendType: string
  healthStatus: string
}

export interface EditForm {
  name: string
  description: string
  instructions: string
}

export type TabType = 'chats' | 'files' | 'characters' | 'settings'
