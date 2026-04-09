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
  pluginName?: string | null  // Plugin name if provided by a plugin
  tags: string[]
  /** Narration delimiters — single string (same open/close) or [open, close] tuple */
  narrationDelimiters: string | [string, string]
  createdAt: string
  updatedAt: string
}

export interface TemplateFormData {
  name: string
  description: string
  systemPrompt: string
  /** 'single' = same open/close delimiter, 'pair' = different open/close */
  narrationDelimiterMode: 'single' | 'pair'
  /** The delimiter string (single mode) or opening delimiter (pair mode) */
  narrationOpen: string
  /** Closing delimiter (pair mode only) */
  narrationClose: string
}

export const INITIAL_FORM_DATA: TemplateFormData = {
  name: '',
  description: '',
  systemPrompt: '',
  narrationDelimiterMode: 'single',
  narrationOpen: '*',
  narrationClose: '*',
}
