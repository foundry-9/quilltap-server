/**
 * TypeScript types and interfaces for Roleplay Templates feature
 */

import type { TemplateDelimiter } from '@/lib/schemas/template.types'

export interface RoleplayTemplate {
  id: string
  userId: string | null
  name: string
  description: string | null
  systemPrompt: string
  isBuiltIn: boolean
  tags: string[]
  /** Delimiter entries for the formatting toolbar */
  delimiters: TemplateDelimiter[]
  /** Narration delimiters — single string (same open/close) or [open, close] tuple */
  narrationDelimiters: string | [string, string]
  createdAt: string
  updatedAt: string
}

export interface DelimiterFormEntry {
  name: string
  buttonName: string
  /** 'single' = same open/close, 'pair' = different open/close */
  delimiterMode: 'single' | 'pair'
  delimiterOpen: string
  delimiterClose: string
  style: string
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
  /** Delimiter entries for the template */
  delimiters: DelimiterFormEntry[]
}

export const EMPTY_DELIMITER: DelimiterFormEntry = {
  name: '',
  buttonName: '',
  delimiterMode: 'single',
  delimiterOpen: '',
  delimiterClose: '',
  style: '',
}

export const INITIAL_FORM_DATA: TemplateFormData = {
  name: '',
  description: '',
  systemPrompt: '',
  narrationDelimiterMode: 'single',
  narrationOpen: '*',
  narrationClose: '*',
  delimiters: [],
}
