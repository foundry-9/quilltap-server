// TypeScript interfaces and types for character view page

import type { TimestampConfig } from '@/lib/schemas/types'

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

export interface CharacterScenario {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface CharacterPhysicalDescription {
  id: string
  name?: string | null
  usageContext?: string | null
  shortPrompt?: string | null
  mediumPrompt?: string | null
  longPrompt?: string | null
  completePrompt?: string | null
  fullDescription?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface Character {
  id: string
  name: string
  title?: string | null
  identity?: string | null
  description?: string | null
  manifesto?: string | null
  personality?: string | null
  scenarios?: CharacterScenario[]
  firstMessage?: string | null
  exampleDialogues?: string | null
  systemPrompts?: CharacterSystemPrompt[]
  physicalDescriptions?: CharacterPhysicalDescription[]
  avatarUrl?: string
  defaultImageId?: string
  defaultConnectionProfileId?: string
  controlledBy?: 'llm' | 'user'
  isFavorite?: boolean
  npc?: boolean
  defaultAgentModeEnabled?: boolean | null
  defaultHelpToolsEnabled?: boolean | null
  canDressThemselves?: boolean | null
  canCreateOutfits?: boolean | null
  defaultTimestampConfig?: TimestampConfig | null
  defaultScenarioId?: string | null
  defaultSystemPromptId?: string | null
  aliases?: string[]
  pronouns?: { subject: string; object: string; possessive: string } | null
  readPropertiesFromDocumentStore?: boolean | null
  characterDocumentMountPointId?: string | null
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
  tags?: string[]
}

export interface TemplateCounts {
  charCount: number
  userCount: number
  fieldCounts: Record<string, { char: number; user: number }>
}
