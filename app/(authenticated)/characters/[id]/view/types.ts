// TypeScript interfaces and types for character view page

export interface Tag {
  id: string
  name: string
}

export interface ConnectionProfile {
  id: string
  name: string
}

export interface UserControlledCharacter {
  id: string
  name: string
  title: string | null
}

export interface ImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
}

export interface CharacterSystemPrompt {
  id: string
  name: string
  content: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface Character {
  id: string
  name: string
  title?: string | null
  description?: string | null
  personality?: string | null
  scenario?: string | null
  firstMessage?: string | null
  exampleDialogues?: string | null
  systemPrompts?: CharacterSystemPrompt[]
  avatarUrl?: string
  defaultImageId?: string
  defaultConnectionProfileId?: string
  controlledBy?: 'llm' | 'user'
  isFavorite?: boolean
  npc?: boolean
  defaultAgentModeEnabled?: boolean | null
  aliases?: string[]
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
  tags?: string[]
}

export interface TemplateFields extends Record<string, string | null | undefined> {
  description?: string | null
  personality?: string | null
  scenario?: string | null
  firstMessage?: string | null
  exampleDialogues?: string | null
  systemPrompt?: string | null
}

export interface TemplateCounts {
  charCount: number
  userCount: number
  fieldCounts: Record<string, { char: number; user: number }>
}
