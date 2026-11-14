/**
 * Field bindings for the character field blocks.
 *
 * The blocks in this folder are presentational: a binding says what a field
 * shows and what to call when it changes. The character page binds them to
 * its autosave engine (`app/aurora/[id]/components/autosave-bindings.ts`); the
 * New Character form binds them to plain local state, since there is no row to
 * save against until Create. One set of field components, two owners.
 *
 * @module components/characters/fields/types
 */

export interface TextFieldBinding {
  value: string
  onChange: (value: string) => void
  /** The user is done with the field (blur, Enter). Optional in create mode. */
  onCommit?: () => void
  /** The last save of this field failed; the text is still the user's. */
  failed?: boolean
  /** A reason the value cannot be saved as it stands (e.g. an empty name). */
  error?: string | null
}

export interface MarkdownFieldBinding extends TextFieldBinding {
  /** Remounts the editor when an outside write replaced the value. */
  remountKey?: string | number
  /** Focus entered the editor (its toolbar included). */
  onFocus?: () => void
}

export interface ValueBinding<T> {
  value: T
  onChange: (value: T) => void
  onCommit?: () => void
  failed?: boolean
}

export type Pronouns = { subject: string; object: string; possessive: string }

/** The six prose fields of the Dossier, in the glossary's vantage-point order. */
export const DOSSIER_FIELDS = [
  'identity',
  'description',
  'manifesto',
  'personality',
  'firstMessage',
  'exampleDialogues',
] as const
export type DossierField = (typeof DOSSIER_FIELDS)[number]
