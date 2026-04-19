/**
 * TypeScript interfaces and types for character editing functionality
 */

export interface CharacterScenario {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface Character {
  id: string
  name: string
  title?: string | null
  description?: string | null
  personality?: string | null
  scenarios?: CharacterScenario[]
  firstMessage?: string | null
  exampleDialogues?: string | null
  systemPrompt?: string
  avatarUrl?: string
  defaultImageId?: string
  defaultConnectionProfileId?: string
  npc?: boolean
  aliases?: string[]
  pronouns?: { subject: string; object: string; possessive: string } | null
  characterDocumentMountPointId?: string | null
  readPropertiesFromDocumentStore?: boolean | null
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
}

export interface CharacterFormData {
  name: string
  aliases: string[]
  pronouns: { subject: string; object: string; possessive: string } | null
  title: string
  description: string
  personality: string
  scenarios: CharacterScenario[]
  firstMessage: string
  exampleDialogues: string
  systemPrompt: string
  avatarUrl: string
  defaultConnectionProfileId: string
  readPropertiesFromDocumentStore: boolean
}

export interface CharacterEditState {
  loading: boolean
  saving: boolean
  error: string | null
  showUploadDialog: boolean
  showAvatarSelector: boolean
  character: Character | null
  formData: CharacterFormData
  originalFormData: CharacterFormData
  avatarRefreshKey: number
}
