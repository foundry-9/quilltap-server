'use client'

/**
 * CharacterKindPicker
 *
 * The "how is this character performed" card shared by the character detail
 * and edit views' Details tabs: roleplay (a person inside a story, the
 * default) or assistant (a character whose job is to do work for you).
 * Presentational: the owning view persists the value (vault
 * `properties.json`) and passes back `saving`.
 *
 * The radio group's name and the hint's id come from `useId`: the workspace
 * keeps the view and edit tabs mounted side by side, and two groups sharing
 * one name in a document would act as a single group.
 */

import { useId } from 'react'
import type { CharacterKind } from '@/lib/characters/kind'

export interface CharacterKindPickerProps {
  kind: CharacterKind
  saving: boolean
  disabled: boolean
  onChange: (kind: CharacterKind) => void | Promise<void>
}

const KIND_OPTIONS: ReadonlyArray<{ value: CharacterKind; label: string; hint: string }> = [
  {
    value: 'roleplay',
    label: 'Roleplay character',
    hint: 'a person in the story, with stakes of their own, who feels what happens and acts on it',
  },
  {
    value: 'assistant',
    label: 'Assistant',
    hint: 'a capable aide whose business is doing work for you: research, drafting, keeping the books',
  },
]

export function CharacterKindPicker({ kind, saving, disabled, onChange }: CharacterKindPickerProps) {
  const inert = saving || disabled
  const groupName = useId()
  const hintId = `${groupName}-hint`
  return (
    <div className="qt-card" data-testid="character-kind">
      <fieldset disabled={inert} aria-describedby={hintId}>
        <legend className="qt-text-label flex items-center gap-3">
          Kind of character
          {saving && <span className="h-4 w-4 animate-spin rounded-full qt-spinner shrink-0" />}
        </legend>
        <p id={hintId} className="qt-text-small qt-text-secondary mt-0.5 mb-2">
          Whether this character is a player in the drama or a member of the
          staff. It decides how they are directed when the curtain is up.
        </p>
        <div className="flex flex-col gap-1">
          {KIND_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-center gap-2 text-sm ${inert ? 'cursor-not-allowed qt-text-muted' : 'cursor-pointer'}`}
            >
              <input
                type="radio"
                name={groupName}
                className="qt-radio"
                value={option.value}
                checked={kind === option.value}
                onChange={() => onChange(option.value)}
                disabled={inert}
              />
              <span>
                {option.label}
                <span className="qt-text-xs qt-text-secondary"> — {option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
