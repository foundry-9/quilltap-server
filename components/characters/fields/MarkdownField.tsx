'use client'

/**
 * A labelled Markdown prose field: the `PromptFieldLabel` hint above, the
 * Lexical editor below, the hint's example (or helper) as the empty editor's
 * placeholder, and a failed-save outline. The editor *is* the view — a filled
 * field reads as prose, an empty one invites.
 *
 * Focus is tracked on the whole frame (toolbar included): `onFocus` when it
 * enters, `onCommit` when it leaves the frame altogether.
 *
 * @module components/characters/fields/MarkdownField
 */

import { useId } from 'react'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { PromptFieldLabel } from '@/components/prompt-fields/PromptFieldLabel'
import type { PromptFieldHint } from '@/components/prompt-fields/field-hints'
import type { MarkdownFieldBinding } from './types'

export interface MarkdownFieldProps {
  binding: MarkdownFieldBinding
  hint: PromptFieldHint
  /** Lexical namespace, for devtools. */
  namespace: string
  minHeight?: string
  disabled?: boolean
  templateHighlight?: { characterName?: string | null; userName?: string | null }
  /** Overrides the placeholder taken from the hint. */
  placeholder?: string
}

export function placeholderFromHint(hint: PromptFieldHint): string {
  return hint.example ? `For instance: ${hint.example}` : hint.helper
}

export function MarkdownField({
  binding,
  hint,
  namespace,
  minHeight = '6rem',
  disabled = false,
  templateHighlight,
  placeholder,
}: MarkdownFieldProps) {
  const labelId = useId()
  return (
    <div
      className="space-y-1"
      onFocus={() => binding.onFocus?.()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) binding.onCommit?.()
      }}
    >
      <div id={labelId}>
        <PromptFieldLabel hint={hint} />
      </div>
      <div
        className={binding.failed ? 'rounded-lg border-2 qt-border-destructive' : undefined}
        data-save-failed={binding.failed ? 'true' : undefined}
      >
        <MarkdownLexicalEditor
          value={binding.value}
          onChange={binding.onChange}
          remountKey={binding.remountKey}
          namespace={namespace}
          ariaLabel={hint.label}
          minHeight={minHeight}
          disabled={disabled}
          placeholder={placeholder ?? placeholderFromHint(hint)}
          templateHighlight={templateHighlight}
        />
      </div>
      {binding.failed && (
        <p className="qt-text-small qt-text-destructive" role="alert">
          This field could not be saved. Your words are still here; the header will retry.
        </p>
      )}
    </div>
  )
}
