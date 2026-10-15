'use client'

/**
 * TriggerPhrasesField — the Workbench's editor for a tool's `triggers`: a
 * chip list of phrases that, said by anyone in a chat, run the tool with its
 * defaults (only while the chat setting is on). Add with Enter or the button,
 * remove with the chip's ×. Rule violations arrive as `validateDraft` issues;
 * the self-echo warnings render on the messages that carry them.
 */

import { useState } from 'react'
import {
  MAX_TRIGGERS,
  MAX_TRIGGER_PHRASE_LENGTH,
  MIN_TRIGGER_PHRASE_LENGTH,
} from '@/lib/pascal/custom-tool.types'
import type { DraftIssue } from '@/lib/pascal/tool-draft'

interface TriggerPhrasesFieldProps {
  triggers: string[]
  issues: DraftIssue[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

export function TriggerPhrasesField({ triggers, issues, onChange, disabled = false }: Readonly<TriggerPhrasesFieldProps>) {
  const [pending, setPending] = useState('')

  const triggerErrors = issues.filter((i) => i.severity === 'error' && i.where.section === 'triggers')
  const errorAt = (index: number) =>
    triggerErrors.find((i) => i.where.section === 'triggers' && i.where.index === index)?.message ?? null
  const listError =
    triggerErrors.find((i) => i.where.section === 'triggers' && i.where.index === undefined)?.message ?? null

  const candidate = pending.trim()
  const atCap = triggers.length >= MAX_TRIGGERS
  const canAdd = !disabled && !atCap && candidate.length >= MIN_TRIGGER_PHRASE_LENGTH

  const add = () => {
    if (!canAdd) return
    onChange([...triggers, candidate])
    setPending('')
  }

  return (
    <div>
      <label htmlFor="wb-trigger-phrase" className="qt-label">
        Trigger phrases
      </label>
      {triggers.length > 0 && (
        <ul className="flex flex-wrap gap-2 mb-2" aria-label="Trigger phrases">
          {triggers.map((phrase, index) => {
            const error = errorAt(index)
            return (
              <li
                key={`${index}-${phrase}`}
                className={`qt-badge-secondary inline-flex items-center gap-1 ${error ? 'qt-text-destructive' : ''}`}
                title={error ?? undefined}
              >
                <span>{phrase}</span>
                <button
                  type="button"
                  className="qt-button qt-button-ghost qt-button-sm px-1"
                  onClick={() => onChange(triggers.filter((_, i) => i !== index))}
                  disabled={disabled}
                  aria-label={`Remove trigger phrase ${phrase}`}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id="wb-trigger-phrase"
          type="text"
          value={pending}
          maxLength={MAX_TRIGGER_PHRASE_LENGTH}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder={atCap ? `At most ${MAX_TRIGGERS} phrases` : 'abracadabra'}
          disabled={disabled || atCap}
          className="qt-input w-full"
        />
        <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={add} disabled={!canAdd}>
          Add
        </button>
      </div>
      <p className="qt-hint">
        Said by anyone in the chat, these words run the tool with its defaults — only when the chat setting is on.
        Exact words, any case. {MIN_TRIGGER_PHRASE_LENGTH}–{MAX_TRIGGER_PHRASE_LENGTH} characters each, up to{' '}
        {MAX_TRIGGERS}.
      </p>
      {[listError, ...triggers.map((_, index) => errorAt(index))]
        .filter((message): message is string => message !== null)
        .map((message) => (
          <p key={message} className="text-xs qt-text-destructive mt-1">
            {message}
          </p>
        ))}
    </div>
  )
}
