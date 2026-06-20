/**
 * TypeScript types and interfaces for Roleplay Templates feature
 */

import type { TemplateDelimiter, DelimiterAddOns } from '@/lib/schemas/template.types'
import { DEFAULT_TAG_TOKEN_PATTERN } from '@/lib/schemas/template.types'

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
  /** Which delimiter kind this entry authors. */
  kind: 'wrap' | 'linePrefix' | 'tagPrefix'
  name: string
  buttonName: string
  /** wrap only: 'single' = same open/close, 'pair' = different open/close */
  delimiterMode: 'single' | 'pair'
  delimiterOpen: string
  delimiterClose: string
  /** linePrefix only: the line-start marker (e.g. "// ") */
  marker: string
  /** tagPrefix only: opening bracket (e.g. "[") */
  tagOpen: string
  /** tagPrefix only: closing bracket (e.g. "]") */
  tagClose: string
  /** tagPrefix only: the inner-token constraint regex (default prefilled, editable) */
  tokenPattern: string
  style: string
  /** Hide the delimiter/prefix from the rendered output. */
  hideDelimiter: boolean
  /** Layered text decorations applied on top of `style`. */
  addOns: DelimiterAddOns
}

/** All add-ons off — the starting point for a fresh delimiter row. */
export const EMPTY_ADD_ONS: DelimiterAddOns = {
  bold: false,
  italic: false,
  reverse: false,
  underline: 'none',
  border: 'none',
  font: '',
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
  kind: 'wrap',
  name: '',
  buttonName: '',
  delimiterMode: 'single',
  delimiterOpen: '',
  delimiterClose: '',
  marker: '',
  tagOpen: '[',
  tagClose: ']',
  tokenPattern: DEFAULT_TAG_TOKEN_PATTERN,
  style: '',
  hideDelimiter: false,
  addOns: { ...EMPTY_ADD_ONS },
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
