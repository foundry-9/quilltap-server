/**
 * Type definitions for system prompts management
 */

export interface CharacterSystemPrompt {
  id: string
  name: string
  content: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface PromptTemplate {
  id: string
  name: string
  content: string
  description: string | null
  isBuiltIn: boolean
  category: string | null
  modelHint: string | null
}

export interface SamplePrompt {
  name: string
  content: string
  modelHint: string
  category: string
  filename: string
}

export interface SystemPromptsEditorProps {
  characterId: string
  characterName: string
  onUpdate?: () => void
}

export interface PromptFormData {
  name: string
  content: string
  isDefault: boolean
}

export const INITIAL_FORM_DATA: PromptFormData = {
  name: '',
  content: '',
  isDefault: false,
}
