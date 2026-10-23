'use client'

/**
 * The item editor's Pronoun Guidance field: one checkbox per standard pronoun
 * set from Aurora's picker. None ticked means the piece is offered to
 * everyone; ticking some offers it only to characters with those pronouns
 * when a list is pronoun-aware. It never stops anyone wearing it by name.
 *
 * @module components/wardrobe/wardrobe-item-editor/WardrobePronounGuidanceField
 */

import { STANDARD_PRONOUNS } from '@/lib/characters/pronoun-presets'
import { normalizePronounGuidance } from '@/lib/wardrobe/pronoun-guidance'
import type { PronounGuidance } from '@/lib/schemas/wardrobe.types'

interface WardrobePronounGuidanceFieldProps {
  value: PronounGuidance[]
  onChange: (next: PronounGuidance[]) => void
}

export function WardrobePronounGuidanceField({ value, onChange }: WardrobePronounGuidanceFieldProps) {
  const toggle = (subject: PronounGuidance, on: boolean) => {
    const next = on ? [...value, subject] : value.filter((s) => s !== subject)
    onChange(normalizePronounGuidance(next))
  }

  return (
    <fieldset>
      <legend className="qt-label mb-1">Pronoun Guidance</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {STANDARD_PRONOUNS.map(({ label, value: { subject } }) => (
          <label key={subject} className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={value.includes(subject)}
              onChange={(e) => toggle(subject, e.target.checked)}
              className="qt-checkbox"
            />
            {label}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs qt-text-small">
        For whom is this piece cut? Tick the pronouns of the characters it is meant for, and the
        wardrobe will tactfully keep it out of everyone else&apos;s offerings --- no gentleman need
        be handed a ball gown he never asked for. Leave every box empty and it is offered to all.
        Anyone may still wear it if they ask for it by name.
      </p>
    </fieldset>
  )
}
