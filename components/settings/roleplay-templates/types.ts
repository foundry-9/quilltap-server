/**
 * TypeScript types and interfaces for Roleplay Templates feature
 */

export interface RoleplayTemplate {
  id: string
  userId: string | null
  name: string
  description: string | null
  systemPrompt: string
  isBuiltIn: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface TemplateFormData {
  name: string
  description: string
  systemPrompt: string
}

export const INITIAL_FORM_DATA: TemplateFormData = {
  name: '',
  description: '',
  systemPrompt: '',
}
