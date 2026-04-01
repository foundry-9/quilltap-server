/**
 * Type definitions for prompt templates
 */

export interface PromptTemplate {
  id: string
  userId: string | null
  name: string
  content: string
  description: string | null
  isBuiltIn: boolean
  category: string | null
  modelHint: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface TemplateFormData {
  name: string
  content: string
  description: string
}

export const INITIAL_FORM_DATA: TemplateFormData = {
  name: '',
  content: '',
  description: '',
}
