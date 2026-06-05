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
  description?: string
}

/**
 * Project-scoped scenario sourced from the project's `Scenarios/` folder
 * (`/api/v1/projects/[id]/scenarios`). Identified by relativePath rather
 * than UUID, since the file system is the source of truth.
 */
export interface ProjectScenarioOption {
  path: string
  filename: string
  name: string
  description?: string
  isDefault: boolean
  body: string
}

/**
 * Instance-wide scenario sourced from the "Quilltap General" mount's
 * `Scenarios/` folder (`/api/v1/scenarios`). Same shape as a project
 * scenario, but applies to every non-help chat regardless of project.
 */
export interface GeneralScenarioOption {
  path: string
  filename: string
  name: string
  description?: string
  isDefault: boolean
  body: string
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

/**
 * Autonomous-room creation slice on NewChatFormState. Only consulted when
 * `autonomous.enabled` is true; the rest of the form continues to operate
 * normally otherwise. Numeric fields are kept in human-friendly units
 * (hours, minutes) and converted to milliseconds at submit time.
 */
export interface NewChatAutonomousState {
  enabled: boolean
  scheduleCron: string
  scheduleFreshnessHours: number | null
  budgetMaxTurns: number | null
  budgetMaxTokens: number | null
  budgetMaxWallClockMinutes: number | null
  budgetEstimatedSpendCapUSD: number | null
  /** Null = inherit user-default visibility from chat_settings. */
  runVisibility: 'owner_only' | 'household' | 'open' | null
  runDestructiveToolsAllowed: boolean
}

export interface NewChatFormState {
  selectedUserCharacterId: string
  imageProfileId: string
  scenario: string
  scenarioId: string | null
  /** Relative path of a selected project scenario; mutually exclusive with `scenarioId` and free-text `scenario`. */
  projectScenarioPath: string | null
  /** Relative path of a selected general scenario; mutually exclusive with the other scenario fields. */
  generalScenarioPath: string | null
  timestampConfig: TimestampConfig | null
  avatarGenerationEnabled: boolean
  outfitSelections: OutfitSelection[]
  autonomous: NewChatAutonomousState
}

export const USER_CONTROLLED_PROFILE = '__USER_CONTROLLED__'
export const CUSTOM_SCENARIO_VALUE = '__custom__'
/**
 * Stable token used in the dropdown's `<option value>` to identify a project
 * scenario. Format: `project:<relativePath>`. Character scenarios continue
 * to use their UUID; "Custom" uses CUSTOM_SCENARIO_VALUE.
 */
export const PROJECT_SCENARIO_PREFIX = 'project:'
/**
 * Stable token for general scenarios in the dropdown. Format:
 * `general:<relativePath>`.
 */
export const GENERAL_SCENARIO_PREFIX = 'general:'
