'use client'

/**
 * The Dossier's template toolbar: `Name → {{char}}`, `Partner → {{user}}` and
 * the two reverses, each with its count. They rewrite every templatable field
 * — the prose, every scenario and system prompt, the physical description —
 * through the shared transform (`applyTemplateTransform`) and its fan-out
 * (`applyCharacterFieldUpdates`), so they live beside the fields they rewrite.
 *
 * Pending drafts are flushed first, so the transform runs over what is on
 * screen; the page reloads and remounts the editors afterwards.
 *
 * @module app/aurora/[id]/cards/TemplateTools
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import {
  applyTemplateTransform,
  collectTemplateFields,
  countTemplateLiterals,
  countTemplateReplacements,
  replaceTemplateWithName,
  replaceWithTemplate,
} from '@/components/characters/TemplateHighlighter'
import { applyCharacterFieldUpdates } from '@/components/characters/apply-character-field-updates'
import { ReverseUserDialog } from '../components/ReverseUserDialog'
import { useCharacterPage } from '../CharacterPageContext'
import type { CharacterResponse } from '../hooks/useCharacter'

type Busy = 'char' | 'user' | 'restore-char' | 'restore-user' | null

export function TemplateTools() {
  const { characterId, character, autosave, readOnly, reload, defaultPartnerName, userControlledCharacters } =
    useCharacterPage()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<Busy>(null)
  const [showReverseUser, setShowReverseUser] = useState(false)

  const descriptors = collectTemplateFields(character)
  const fields = Object.fromEntries(descriptors.map((d) => [d.key, d.value]))
  const counts = countTemplateReplacements(fields, character.name, defaultPartnerName)
  const literals = countTemplateLiterals(descriptors.map((d) => d.value))
  const otherUserControlled = userControlledCharacters.filter((c) => c.id !== characterId)

  const run = async (kind: Exclude<Busy, null>, transform: (text: string) => string, successMessage: string) => {
    setBusy(kind)
    try {
      await autosave.flush()
      const latest =
        queryClient.getQueryData<CharacterResponse>(queryKeys.characters.detail(characterId))?.character ?? character
      const { mainUpdates, changedSystemPrompts, changedScenarios } = applyTemplateTransform(latest, transform)
      if (Object.keys(mainUpdates).length === 0 && changedSystemPrompts.length === 0 && changedScenarios.length === 0) {
        showSuccessToast('No replacements needed')
        return
      }
      const result = await autosave.run(
        () =>
          applyCharacterFieldUpdates(characterId, {
            mainUpdates,
            promptUpdates: changedSystemPrompts,
            scenarioUpdates: changedScenarios,
          }),
        'The replacement could not be saved.',
      )
      await reload()
      if (result && result.errors.length > 0) showErrorToast(result.errors.join(' '))
      else if (result) showSuccessToast(successMessage)
    } finally {
      setBusy(null)
    }
  }

  const buttonClass =
    'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 qt-label qt-shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50'
  const charClass = `${buttonClass} qt-border-primary/40 qt-bg-primary/10 qt-text hover:qt-bg-primary/15`
  const userClass = `${buttonClass} qt-border-success/40 qt-bg-success/10 qt-text hover:qt-bg-success/20`
  const disabled = readOnly || busy !== null

  const nothingToDo =
    counts.charCount === 0 &&
    !(defaultPartnerName && counts.userCount > 0) &&
    literals.charCount === 0 &&
    !(literals.userCount > 0 && otherUserControlled.length > 0)

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Template tools">
      <span className="qt-text-small qt-text-secondary mr-1">Template tools:</span>
      {nothingToDo && (
        <span className="qt-text-small qt-text-secondary">
          nothing to swap — no names or <code>{'{{char}}'}</code> / <code>{'{{user}}'}</code> tokens in the prose.
        </span>
      )}
      {counts.charCount > 0 && (
        <button
          type="button"
          disabled={disabled}
          className={charClass}
          title={`Replace ${counts.charCount} occurrences of "${character.name}" with {{char}}`}
          onClick={() =>
            run('char', (t) => replaceWithTemplate(t, character.name, '{{char}}'), 'Replaced the character name with {{char}}')
          }
        >
          <Icon name="refresh" className="w-4 h-4" />
          <span className="hidden sm:inline">{character.name}</span> →{' '}
          <code className="rounded qt-bg-primary/20 px-1 text-xs">{'{{char}}'}</code>
          <span className="text-xs">({counts.charCount})</span>
        </button>
      )}
      {defaultPartnerName && counts.userCount > 0 && (
        <button
          type="button"
          disabled={disabled}
          className={userClass}
          title={`Replace ${counts.userCount} occurrences of "${defaultPartnerName}" with {{user}}`}
          onClick={() =>
            run(
              'user',
              (t) => replaceWithTemplate(t, defaultPartnerName, '{{user}}'),
              'Replaced the partner name with {{user}}',
            )
          }
        >
          <Icon name="refresh" className="w-4 h-4" />
          <span className="hidden sm:inline">{defaultPartnerName}</span> →{' '}
          <code className="rounded qt-bg-success/20 px-1 text-xs">{'{{user}}'}</code>
          <span className="text-xs">({counts.userCount})</span>
        </button>
      )}
      {literals.charCount > 0 && (
        <button
          type="button"
          disabled={disabled}
          className={charClass}
          title={`Replace ${literals.charCount} occurrences of {{char}} with "${character.name}"`}
          onClick={() =>
            run(
              'restore-char',
              (t) => replaceTemplateWithName(t, 'char', character.name),
              `Restored {{char}} to ${character.name}`,
            )
          }
        >
          <Icon name="refresh" className="w-4 h-4" />
          <code className="rounded qt-bg-primary/20 px-1 text-xs">{'{{char}}'}</code> →{' '}
          <span className="hidden sm:inline">{character.name}</span>
          <span className="text-xs">({literals.charCount})</span>
        </button>
      )}
      {literals.userCount > 0 && otherUserControlled.length > 0 && (
        <button
          type="button"
          disabled={disabled}
          className={userClass}
          title={`Replace ${literals.userCount} occurrences of {{user}} with a user-controlled character's name`}
          onClick={() => setShowReverseUser(true)}
        >
          <Icon name="refresh" className="w-4 h-4" />
          <code className="rounded qt-bg-success/20 px-1 text-xs">{'{{user}}'}</code> →{' '}
          <span className="hidden sm:inline">name…</span>
          <span className="text-xs">({literals.userCount})</span>
        </button>
      )}
      {showReverseUser && (
        <ReverseUserDialog
          characters={otherUserControlled}
          onClose={() => setShowReverseUser(false)}
          onConfirm={(name) => {
            setShowReverseUser(false)
            void run('restore-user', (t) => replaceTemplateWithName(t, 'user', name), `Restored {{user}} to ${name}`)
          }}
        />
      )}
    </div>
  )
}
