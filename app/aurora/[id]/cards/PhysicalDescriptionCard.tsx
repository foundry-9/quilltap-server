'use client'

/**
 * The physical description: one record per character — a name and usage
 * context, the Humanoid flag, the head-and-shoulders avatar prompt, the four
 * prompt variants and a full freeform description. Stored in the vault as
 * `physical-description.md` + `physical-prompts.json`.
 *
 * Every text field autosaves like the Dossier (keys
 * `physicalDescription.<field>`; the record is sent whole, merged over the
 * stored one, because its schema requires a name). Humanoid saves on change —
 * it is the one flag here that recompiles the character's seats server-side.
 * *Clear* is the one explicit action: it removes the record, behind a confirm.
 *
 * @module app/aurora/[id]/cards/PhysicalDescriptionCard
 */

import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { MarkdownField } from '@/components/characters/fields/MarkdownField'
import { PROMPT_FIELD_HINTS, type PromptFieldHint } from '@/components/prompt-fields/field-hints'
import { PromptFieldLabel } from '@/components/prompt-fields/PromptFieldLabel'
import { charCountClass } from '@/lib/utils/char-count'
import { showSuccessToast } from '@/lib/toast'
import { SectionCard } from '../components/SectionCard'
import { useMarkdownBinding, useTextBinding } from '../components/autosave-bindings'
import { useCharacterPage } from '../CharacterPageContext'
import {
  DEFAULT_PHYSICAL_DESCRIPTION_NAME,
  PHYSICAL_KEY_PREFIX,
  mergePhysicalDescription,
} from '../hooks/useCharacterAutosave'
import type { CharacterResponse } from '../hooks/useCharacter'

interface PromptVariant {
  field: 'headAndShouldersPrompt' | 'shortPrompt' | 'mediumPrompt' | 'longPrompt' | 'completePrompt' | 'fullDescription'
  label: string
  helper: string
  max?: number
  minHeight: string
}

const VARIANTS: PromptVariant[] = [
  {
    field: 'headAndShouldersPrompt',
    label: 'Head & Shoulders',
    helper: 'Used for avatar generation — describe only the head, face, hair, expression and neckline; nothing below the shoulders.',
    max: 500,
    minHeight: '4rem',
  },
  { field: 'shortPrompt', label: 'Short Prompt', helper: 'Brief description for small prompts.', max: 350, minHeight: '4rem' },
  { field: 'mediumPrompt', label: 'Medium Prompt', helper: 'More detailed description.', max: 500, minHeight: '6rem' },
  { field: 'longPrompt', label: 'Long Prompt', helper: 'Extended description with more detail.', max: 750, minHeight: '8rem' },
  {
    field: 'completePrompt',
    label: 'Complete Prompt',
    helper: 'Full detailed description for maximum context.',
    max: 1000,
    minHeight: '10rem',
  },
  {
    field: 'fullDescription',
    label: 'Full Description',
    helper: 'Complete freeform description. Use it to write the shorter prompts above.',
    minHeight: '10rem',
  },
]

function VariantField({ variant, humanoid }: { variant: PromptVariant; humanoid: boolean }) {
  const { character, autosave, readOnly, externalToken } = useCharacterPage()
  const binding = useMarkdownBinding(
    autosave.engine,
    `${PHYSICAL_KEY_PREFIX}${variant.field}`,
    character.physicalDescription?.[variant.field],
    externalToken,
  )
  const helper =
    variant.field === 'headAndShouldersPrompt' && !humanoid
      ? 'Not used for a non-humanoid character — its avatar is drawn from the Medium prompt, whole form in frame.'
      : variant.helper
  const hint: PromptFieldHint = { label: variant.label, helper }
  return (
    <div>
      {variant.max !== undefined && (
        <div className="flex justify-end">
          <span className={`text-xs ${charCountClass(binding.value.length, variant.max)}`}>
            {binding.value.length}/{variant.max}
          </span>
        </div>
      )}
      <MarkdownField
        binding={binding}
        hint={hint}
        namespace={`CharacterPage.physical.${variant.field}`}
        minHeight={variant.minHeight}
        disabled={readOnly}
        placeholder={helper}
      />
    </div>
  )
}

export function PhysicalDescriptionCard() {
  const { characterId, character, autosave, readOnly, reload } = useCharacterPage()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const pd = character.physicalDescription ?? null
  const humanoid = pd?.humanoid !== false
  const name = useTextBinding(autosave.engine, `${PHYSICAL_KEY_PREFIX}name`, pd?.name)
  const usage = useTextBinding(autosave.engine, `${PHYSICAL_KEY_PREFIX}usageContext`, pd?.usageContext)
  const [confirmClear, setConfirmClear] = useState(false)

  const setHumanoid = async (next: boolean) => {
    // Send what is typed first, so the whole-record write below carries it.
    await autosave.flush()
    // Read the row after the flush: the render's copy predates it.
    const latest =
      queryClient.getQueryData<CharacterResponse>(queryKeys.characters.detail(characterId))?.character ?? character
    await autosave.saveNow(
      { physicalDescription: mergePhysicalDescription(latest.physicalDescription ?? null, { humanoid: next }) },
      'The Humanoid setting could not be saved.',
    )
  }

  const clear = async () => {
    setConfirmClear(false)
    await autosave.flush()
    const ok = await autosave.saveNow({ physicalDescription: null }, 'The physical description could not be cleared.')
    if (ok) {
      showSuccessToast('Physical description cleared')
      await reload()
    }
  }

  return (
    <SectionCard
      title="Physical description"
      anchor="physical-description"
      description={
        <>
          How they look, for the image pipelines: a head-and-shoulders avatar prompt, four lengths of prompt and a
          full description. Kept in the vault as <code>physical-description.md</code> and{' '}
          <code>physical-prompts.json</code>.
        </>
      }
      actions={
        pd ? (
          confirmClear ? (
            <span className="flex items-center gap-2">
              <span className="qt-text-small">Remove it entirely?</span>
              <button type="button" onClick={() => void clear()} className="qt-button-destructive qt-button-sm">
                Remove
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} className="qt-button-secondary qt-button-sm">
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setConfirmClear(true)}
              className="qt-button-secondary qt-button-sm"
            >
              Clear
            </button>
          )
        ) : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${fieldId}-name`} className="qt-label mb-1 block">
            Name
          </label>
          <input
            id={`${fieldId}-name`}
            type="text"
            value={name.value}
            disabled={readOnly}
            onChange={(e) => name.onChange(e.target.value)}
            onBlur={() => name.onCommit?.()}
            placeholder={DEFAULT_PHYSICAL_DESCRIPTION_NAME}
            className={`qt-input ${name.failed ? 'qt-border-destructive' : ''}`}
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor={`${fieldId}-usage`} className="qt-label">
              Usage context
            </label>
            <span className={`text-xs ${charCountClass(usage.value.length, 200)}`}>{usage.value.length}/200</span>
          </div>
          <input
            id={`${fieldId}-usage`}
            type="text"
            maxLength={200}
            value={usage.value}
            disabled={readOnly}
            onChange={(e) => usage.onChange(e.target.value)}
            onBlur={() => usage.onCommit?.()}
            placeholder="e.g., at work in a professional capacity, relaxing at the pool"
            className={`qt-input ${usage.failed ? 'qt-border-destructive' : ''}`}
          />
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <label htmlFor={`${fieldId}-humanoid`} className="block qt-text-label">
            Humanoid
          </label>
          <p className="text-xs qt-text-secondary mt-1">
            Untick for a character with no head, shoulders or body to speak of &mdash; a cluster of interlocking
            spheres, a drifting lattice of light. The Lantern and Aurora will then paint the whole of its form and never
            so much as hint at a face, a neck or a pair of shoulders, and the character is reminded it has none.
          </p>
        </div>
        <input
          id={`${fieldId}-humanoid`}
          type="checkbox"
          checked={humanoid}
          disabled={readOnly}
          onChange={(e) => void setHumanoid(e.target.checked)}
          className="h-5 w-5 qt-accent-primary"
        />
      </div>

      {/* The form-of-address note, said once for every prompt below. */}
      <PromptFieldLabel hint={PROMPT_FIELD_HINTS.physicalDescription} />

      <div className="space-y-5">
        {VARIANTS.map((variant) => (
          <VariantField key={variant.field} variant={variant} humanoid={humanoid} />
        ))}
      </div>
    </SectionCard>
  )
}
