/**
 * TypeScript interfaces and types for character editing functionality
 */

export interface Character {
  id: string
  name: string
  title?: string | null
  description?: string | null
  personality?: string | null
  scenario?: string | null
  firstMessage?: string | null
  exampleDialogues?: string | null
  systemPrompt?: string
  avatarUrl?: string
  defaultImageId?: string
  defaultConnectionProfileId?: string
  npc?: boolean
  aliases?: string[]
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
}

export interface CharacterFormData {
  name: string
  aliases: string[]
  title: string
  description: string
  personality: string
  scenario: string
  firstMessage: string
  exampleDialogues: string
  systemPrompt: string
  avatarUrl: string
  defaultConnectionProfileId: string
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
