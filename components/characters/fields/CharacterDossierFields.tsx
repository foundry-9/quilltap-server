'use client'

/**
 * The Dossier block: the six prose fields — identity, description, manifesto,
 * personality, first message, example dialogues — in the glossary's
 * vantage-point order, each with its hint and its example as the empty
 * editor's placeholder, so a blank character shows its whole shape.
 *
 * Presentational (see `./types`).
 *
 * @module components/characters/fields/CharacterDossierFields
 */

import type { ReactNode } from 'react'
import { PROMPT_FIELD_HINTS } from '@/components/prompt-fields/field-hints'
import { MarkdownField } from './MarkdownField'
import { DOSSIER_FIELDS, type DossierField, type MarkdownFieldBinding } from './types'

const MIN_HEIGHTS: Record<DossierField, string> = {
  identity: '6rem',
  description: '8rem',
  manifesto: '8rem',
  personality: '8rem',
  firstMessage: '6rem',
  exampleDialogues: '12rem',
}

export interface CharacterDossierFieldsProps {
  bindings: Record<DossierField, MarkdownFieldBinding>
  /** Namespace prefix for the editors (devtools). */
  namespace: string
  disabled?: boolean
  templateHighlight?: { characterName?: string | null; userName?: string | null }
  /** Rendered above the fields (the template tools). */
  toolbar?: ReactNode
}

export function CharacterDossierFields({
  bindings,
  namespace,
  disabled = false,
  templateHighlight,
  toolbar,
}: CharacterDossierFieldsProps) {
  return (
    <div className="space-y-6">
      {toolbar}
      {DOSSIER_FIELDS.map((field) => (
        <MarkdownField
          key={field}
          binding={bindings[field]}
          hint={PROMPT_FIELD_HINTS[field]}
          namespace={`${namespace}.${field}`}
          minHeight={MIN_HEIGHTS[field]}
          disabled={disabled}
          templateHighlight={templateHighlight}
        />
      ))}
    </div>
  )
}
