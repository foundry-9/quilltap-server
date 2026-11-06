'use client'

/**
 * Scenarios, in the same shape as Subprompts: a list of rows (title, archived
 * badge, default star, pencil, bin), with *Add scenario* and the pencil opening
 * one modal (title + Markdown body). Each row writes through the per-scenario
 * route (`/api/v1/characters/[id]/scenarios`) — never by round-tripping the
 * whole array through the character PUT, whose scenario schema has no
 * `archived` key. The star is the one control for the default scenario.
 *
 * @module app/aurora/[id]/cards/ScenariosCard
 */

import { useId, useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { PROMPT_FIELD_HINTS } from '@/components/prompt-fields/field-hints'
import { placeholderFromHint } from '@/components/characters/fields/MarkdownField'
import { showSuccessToast } from '@/lib/toast'
import { SectionCard } from '../components/SectionCard'
import { useCharacterPage } from '../CharacterPageContext'
import type { CharacterScenario } from '../types'

async function scenarioRequest(
  characterId: string,
  method: 'POST' | 'PUT' | 'DELETE',
  scenarioId?: string,
  body?: Record<string, unknown>,
): Promise<void> {
  const qs = scenarioId ? `?scenarioId=${encodeURIComponent(scenarioId)}` : ''
  const res = await fetch(`/api/v1/characters/${characterId}/scenarios${qs}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || 'The scenario could not be saved.')
  }
}

function ScenarioEditorModal({
  editing,
  onClose,
  onSave,
}: {
  /** The scenario being edited, or `'new'`. */
  editing: CharacterScenario | 'new'
  onClose: () => void
  onSave: (title: string, content: string) => Promise<boolean>
}) {
  const titleId = useId()
  const [title, setTitle] = useState(editing === 'new' ? '' : editing.title)
  const [content, setContent] = useState(editing === 'new' ? '' : editing.content)
  const [saving, setSaving] = useState(false)
  const canSave = title.trim().length > 0 && content.trim().length > 0 && !saving

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={editing === 'new' ? 'Add scenario' : `Edit scenario: ${editing.title}`}
      maxWidth="2xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="qt-button-secondary">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            className="qt-button-primary"
            onClick={async () => {
              setSaving(true)
              const ok = await onSave(title.trim(), content)
              setSaving(false)
              if (ok) onClose()
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor={titleId} className="block qt-text-label mb-2">
            Title
          </label>
          <input
            id={titleId}
            type="text"
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="qt-input"
            placeholder="e.g., The Midnight Train"
          />
        </div>
        <div>
          <span className="block qt-text-label mb-1">{PROMPT_FIELD_HINTS.scenario.label}</span>
          <p className="text-xs qt-text-secondary mb-2">{PROMPT_FIELD_HINTS.scenario.helper}</p>
          <MarkdownLexicalEditor
            value={content}
            onChange={setContent}
            namespace="CharacterPage.scenario"
            ariaLabel="Scenario content"
            minHeight="10rem"
            placeholder={placeholderFromHint(PROMPT_FIELD_HINTS.scenario)}
          />
        </div>
      </div>
    </BaseModal>
  )
}

export function ScenariosCard() {
  const { characterId, character, autosave, readOnly, reload } = useCharacterPage()
  const scenarios = character.scenarios ?? []
  const [editing, setEditing] = useState<CharacterScenario | 'new' | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const save = async (title: string, content: string): Promise<boolean> => {
    const target = editing
    const ok = await autosave.run(async () => {
      if (target === 'new') await scenarioRequest(characterId, 'POST', undefined, { title, content })
      else if (target) await scenarioRequest(characterId, 'PUT', target.id, { title, content })
      return true
    }, 'The scenario could not be saved.')
    if (ok) await reload()
    return ok === true
  }

  const toggleArchived = async (scenario: CharacterScenario) => {
    const ok = await autosave.run(
      () => scenarioRequest(characterId, 'PUT', scenario.id, { archived: !scenario.archived }).then(() => true),
      'The scenario could not be updated.',
    )
    if (ok) await reload()
  }

  const remove = async (scenario: CharacterScenario) => {
    setDeleteConfirm(null)
    const ok = await autosave.run(
      () => scenarioRequest(characterId, 'DELETE', scenario.id).then(() => true),
      'The scenario could not be deleted.',
    )
    if (ok) {
      showSuccessToast('Scenario deleted')
      await reload()
    }
  }

  const setDefault = (scenarioId: string | null) =>
    void autosave.saveNow({ defaultScenarioId: scenarioId }, 'The default scenario could not be saved.')

  return (
    <SectionCard
      title="Scenarios"
      anchor="scenarios"
      description={
        <>
          Named settings for a conversation — the stage, never the actor. One is chosen when a chat begins; the
          starred one is chosen for you. Archiving hides a scenario from the chat pickers without deleting it. Kept in
          the vault&rsquo;s <code>Scenarios/</code> folder.
        </>
      }
      actions={
        <button type="button" disabled={readOnly} onClick={() => setEditing('new')} className="qt-button-primary">
          + Add Scenario
        </button>
      }
    >
      {scenarios.length === 0 ? (
        <p className="qt-text-small qt-text-secondary">
          No scenarios yet. Written as: <em>{PROMPT_FIELD_HINTS.scenario.example}</em>
        </p>
      ) : (
        <ul className="space-y-3">
          {scenarios.map((scenario) => {
            const isDefault = character.defaultScenarioId === scenario.id
            return (
              <li key={scenario.id} className="rounded-lg border qt-border-default p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="qt-text-primary truncate">{scenario.title}</h3>
                      {isDefault && <span className="qt-badge-primary">Default</span>}
                      {scenario.archived && <span className="qt-badge-secondary">Archived</span>}
                    </div>
                    <p className="qt-text-small line-clamp-2">
                      {scenario.content.length > 160 ? `${scenario.content.slice(0, 160)}…` : scenario.content}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => setDefault(isDefault ? null : scenario.id)}
                      className={`qt-button-icon qt-button-ghost ${isDefault ? 'qt-text-favorite' : 'hover:text-primary'}`}
                      aria-pressed={isDefault}
                      aria-label={isDefault ? `Stop using ${scenario.title} by default` : `Use ${scenario.title} by default`}
                      title={isDefault ? 'The default scenario — click to clear' : 'Set as the default scenario'}
                    >
                      <Icon name="star" className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => void toggleArchived(scenario)}
                      className="qt-button-ghost qt-button-sm"
                      title={scenario.archived ? 'Restore to the chat pickers' : 'Hide from the chat pickers'}
                    >
                      {scenario.archived ? 'Restore' : 'Archive'}
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => setEditing(scenario)}
                      className="qt-button-icon qt-button-ghost"
                      aria-label={`Edit scenario ${scenario.title}`}
                    >
                      <Icon name="pencil" className="w-4 h-4" />
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => setDeleteConfirm(deleteConfirm === scenario.id ? null : scenario.id)}
                        className="qt-button-icon qt-button-ghost hover:qt-text-destructive"
                        aria-label={`Delete scenario ${scenario.title}`}
                      >
                        <Icon name="trash" className="w-4 h-4" />
                      </button>
                      {deleteConfirm === scenario.id && (
                        <div className="absolute right-0 top-full z-10 mt-1 min-w-[220px] rounded-lg border qt-border-default qt-bg-card p-3 qt-shadow-lg">
                          <p className="text-sm text-foreground mb-2">
                            Delete this scenario? Chats already begun keep their scene.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void remove(scenario)}
                              className="qt-button-destructive qt-button-sm flex-1"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm(null)}
                              className="qt-button-secondary qt-button-sm flex-1"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {editing && <ScenarioEditorModal editing={editing} onClose={() => setEditing(null)} onSave={save} />}
    </SectionCard>
  )
}
