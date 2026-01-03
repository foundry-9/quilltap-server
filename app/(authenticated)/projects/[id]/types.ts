/**
 * Project Detail Page Types
 *
 * Shared types for the project detail page components.
 */

export interface ProjectCharacter {
  id: string
  name: string
  avatarUrl?: string | null
  chatCount: number
}

export interface ProjectChat {
  id: string
  title?: string | null
  messageCount: number
  participants: Array<{ id: string; name: string; avatarUrl?: string | null }>
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
  createdAt: string
  updatedAt: string
}

export interface EditForm {
  name: string
  description: string
  instructions: string
}

export type TabType = 'chats' | 'files' | 'characters' | 'settings'
