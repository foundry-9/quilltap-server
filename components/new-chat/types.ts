import type { TimestampConfig } from '@/lib/schemas/types'
import type { OutfitSelection } from '@/components/wardrobe'

export interface SystemPrompt {
  id: string
  name: string
  content?: string
  isDefault: boolean
}

export interface CharacterScenario {
  id: string
  title: string
  content: string
}

export interface Character {
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
  defaultConnectionProfileId?: string | null
  controlledBy?: 'llm' | 'user'
  isFavorite?: boolean
  _count?: {
    chats: number
  }
  systemPrompts?: SystemPrompt[]
  scenarios?: CharacterScenario[]
  defaultPartnerId?: string | null
  defaultTimestampConfig?: TimestampConfig | null
  defaultScenarioId?: string | null
  defaultSystemPromptId?: string | null
  defaultImageProfileId?: string | null
}

export interface ConnectionProfile {
  id: string
  name: string
  provider?: string
  modelName?: string
}

export interface ImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

export interface UserControlledCharacter {
  id: string
  name: string
  title?: string | null
}

export interface Project {
  id: string
  name: string
  color?: string | null
  defaultAvatarGenerationEnabled?: boolean | null
  defaultImageProfileId?: string | null
}

export interface SelectedCharacter {
  character: Character
  connectionProfileId: string
  selectedSystemPromptId?: string | null
  controlledBy: 'llm' | 'user'
}

export interface NewChatFormState {
  selectedUserCharacterId: string
  imageProfileId: string
  scenario: string
  scenarioId: string | null
  timestampConfig: TimestampConfig | null
  avatarGenerationEnabled: boolean
  outfitSelections: OutfitSelection[]
}

export const USER_CONTROLLED_PROFILE = '__USER_CONTROLLED__'
export const CUSTOM_SCENARIO_VALUE = '__custom__'
