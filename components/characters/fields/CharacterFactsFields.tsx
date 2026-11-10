'use client'

/**
 * The Facts block: name, title, aliases, pronouns, birthday — the short,
 * public particulars of a character — plus slots for the kind picker and the
 * tag editor, which keep their own components.
 *
 * Presentational (see `./types`): the character page binds it to autosave, the
 * New Character form to local state.
 *
 * @module components/characters/fields/CharacterFactsFields
 */

import { useId, useState, type ReactNode } from 'react'
import { STANDARD_PRONOUNS } from '@/lib/characters/pronoun-presets'
import { ageOn, dateStampIn } from '@/lib/characters/birthday'
import type { Pronouns, TextFieldBinding, ValueBinding } from './types'

const PRONOUN_PRESETS = [
  { label: 'Not set', value: null },
  ...STANDARD_PRONOUNS,
  { label: 'Custom', value: 'custom' as const },
] as const

export function pronounPresetLabel(pronouns: Pronouns | null): string {
  if (!pronouns) return 'Not set'
  for (const preset of PRONOUN_PRESETS) {
    if (
      preset.value &&
      preset.value !== 'custom' &&
      preset.value.subject === pronouns.subject &&
      preset.value.object === pronouns.object &&
      preset.value.possessive === pronouns.possessive
    ) {
      return preset.label
    }
  }
  return 'Custom'
}

function AliasInput({ onAdd, disabled }: { onAdd: (alias: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState('')
  const add = () => {
    const trimmed = value.trim()
    if (trimmed) {
      onAdd(trimmed)
      setValue('')
    }
  }
  return (
    <input
      aria-label="Add alias"
      type="text"
      value={value}
      disabled={disabled}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          add()
        }
      }}
      onBlur={add}
      className="qt-input"
      placeholder="Type an alias and press Enter"
    />
  )
}

function commitOnEnter(binding: { onCommit?: () => void }) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      binding.onCommit?.()
    }
  }
}

export interface CharacterFactsFieldsProps {
  name: TextFieldBinding
  title: TextFieldBinding
  aliases: ValueBinding<string[]>
  pronouns: ValueBinding<Pronouns | null>
  birthday: ValueBinding<string | null>
  /** The kind picker, saved by its owner. */
  kindSlot?: ReactNode
  /** The tag editor; absent in create mode (tags need a saved row). */
  tagsSlot?: ReactNode
  disabled?: boolean
}

export function CharacterFactsFields({
  name,
  title,
  aliases,
  pronouns,
  birthday,
  kindSlot,
  tagsSlot,
  disabled = false,
}: CharacterFactsFieldsProps) {
  const fieldId = useId()
  // Today on the browser's calendar, read once — for the age preview and the
  // picker's upper bound. (The server counts on the instance calendar; the two
  // differ only for the hours around midnight on the day itself.)
  const [today] = useState(() => dateStampIn(Date.now()))
  const age = birthday.value ? ageOn(birthday.value, today) : null
  const pronounValue = pronouns.value
  const isCustom = pronounValue !== null && pronounPresetLabel(pronounValue) === 'Custom'

  return (
    <div className="space-y-5">
      {/* Name */}
      <div>
        <label htmlFor={`${fieldId}-name`} className="block qt-text-label mb-2">
          Name <span className="qt-text-destructive">*</span>
        </label>
        <input
          type="text"
          id={`${fieldId}-name`}
          value={name.value}
          disabled={disabled}
          onChange={(e) => name.onChange(e.target.value)}
          onBlur={() => name.onCommit?.()}
          onKeyDown={commitOnEnter(name)}
          aria-invalid={name.error ? true : undefined}
          aria-describedby={name.error ? `${fieldId}-name-error` : undefined}
          className={`qt-input ${name.error || name.failed ? 'qt-border-destructive' : ''}`}
          placeholder="What everyone calls them"
        />
        {name.error && (
          <p id={`${fieldId}-name-error`} className="mt-1 qt-text-small qt-text-destructive" role="alert">
            {name.error}
          </p>
        )}
      </div>

      {/* Title */}
      <div>
        <label htmlFor={`${fieldId}-title`} className="block qt-text-label mb-2">
          Title
        </label>
        <input
          type="text"
          id={`${fieldId}-title`}
          value={title.value}
          disabled={disabled}
          onChange={(e) => title.onChange(e.target.value)}
          onBlur={() => title.onCommit?.()}
          onKeyDown={commitOnEnter(title)}
          className={`qt-input ${title.failed ? 'qt-border-destructive' : ''}`}
          placeholder="Your private label for this character — e.g., the protagonist, the rival, the love interest. Not how strangers refer to them."
        />
      </div>

      {/* Aliases */}
      <div>
        <span id={`${fieldId}-aliases`} className="block qt-text-label mb-1">
          Aliases
        </span>
        <p className="text-xs qt-text-secondary mb-2">
          Alternate names this character goes by. Press Enter to add.
        </p>
        {aliases.value.length > 0 && (
          <ul className="flex flex-wrap gap-2 mb-2" aria-labelledby={`${fieldId}-aliases`}>
            {aliases.value.map((alias, index) => (
              <li
                key={`${alias}-${index}`}
                className="inline-flex items-center gap-1 rounded-full qt-bg-muted px-3 py-1 text-sm qt-text"
              >
                {alias}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => aliases.onChange(aliases.value.filter((_, i) => i !== index))}
                  className="ml-1 qt-text-secondary hover:qt-text"
                  aria-label={`Remove alias ${alias}`}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
        <AliasInput
          disabled={disabled}
          onAdd={(alias) => {
            if (!aliases.value.some((a) => a.toLowerCase() === alias.toLowerCase())) {
              aliases.onChange([...aliases.value, alias])
            }
          }}
        />
      </div>

      {/* Pronouns */}
      <div>
        <label htmlFor={`${fieldId}-pronouns`} className="block qt-text-label mb-1">
          Pronouns
        </label>
        <p className="text-xs qt-text-secondary mb-2">
          Included in system prompts so the model refers to the character correctly.
        </p>
        <select
          id={`${fieldId}-pronouns`}
          value={pronounPresetLabel(pronounValue)}
          disabled={disabled}
          onChange={(e) => {
            const selected = PRONOUN_PRESETS.find((p) => p.label === e.target.value)
            if (!selected) return
            if (selected.value === null) {
              pronouns.onChange(null)
              pronouns.onCommit?.()
            } else if (selected.value === 'custom') {
              // Custom parts are committed as each one is left.
              pronouns.onChange(pronounValue || { subject: '', object: '', possessive: '' })
            } else {
              pronouns.onChange({ ...selected.value })
              pronouns.onCommit?.()
            }
          }}
          className="qt-select"
        >
          {PRONOUN_PRESETS.map((preset) => (
            <option key={preset.label} value={preset.label}>
              {preset.label}
            </option>
          ))}
        </select>
        {pronounValue && isCustom && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(['subject', 'object', 'possessive'] as const).map((part, i) => (
              <div key={part}>
                <label htmlFor={`${fieldId}-pronoun-${part}`} className="block text-xs qt-text-secondary mb-1">
                  {part[0].toUpperCase() + part.slice(1)}
                </label>
                <input
                  id={`${fieldId}-pronoun-${part}`}
                  type="text"
                  value={pronounValue[part]}
                  disabled={disabled}
                  onChange={(e) => pronouns.onChange({ ...pronounValue, [part]: e.target.value })}
                  onBlur={() => pronouns.onCommit?.()}
                  onKeyDown={commitOnEnter(pronouns)}
                  placeholder={['e.g., they', 'e.g., them', 'e.g., their'][i]}
                  className="qt-input"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Birthday */}
      <div>
        <label htmlFor={`${fieldId}-birthday`} className="block qt-text-label mb-1">
          Birthday
        </label>
        <p className="text-xs qt-text-secondary mb-2">
          A real date of birth. Set one and the character&apos;s age is reckoned from it — a year older every
          birthday, with no further fuss — and leads the identity others are given. Leave it empty and their
          age is whatever the prose says.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            id={`${fieldId}-birthday`}
            type="date"
            value={birthday.value ?? ''}
            max={today}
            disabled={disabled}
            onChange={(e) => birthday.onChange(e.target.value || null)}
            onBlur={() => birthday.onCommit?.()}
            className={`qt-input w-auto ${birthday.failed ? 'qt-border-destructive' : ''}`}
          />
          {birthday.value && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                birthday.onChange(null)
                birthday.onCommit?.()
              }}
              className="qt-button-secondary qt-button-sm"
            >
              Clear
            </button>
          )}
          {age !== null && (
            <span className="qt-text-small qt-text-secondary" aria-live="polite">
              {age} {age === 1 ? 'year' : 'years'} of age today
            </span>
          )}
        </div>
      </div>

      {kindSlot}
      {tagsSlot}
    </div>
  )
}
