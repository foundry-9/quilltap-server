'use client'

/**
 * ScenariosManager — scope-agnostic CRUD body for a `Scenarios/` folder.
 *
 * Both the project ScenariosCard (per-project Scenarios/) and the top-level
 * `/scenarios` page (instance-wide Quilltap General Scenarios/) render this
 * component, parameterised by:
 *
 *   - the `ScenarioMutator` returned from the scope-specific hook
 *     (`useProjectScenarios` vs `useGeneralScenarios`)
 *   - `scopeLabel` — used in placeholders and the "(scope default)" tag
 *   - `emptyMessage` — shown when the list is empty
 *   - `shelf` — which shelf this is, for the Host's Scenario Builder button:
 *     the builder reads that shelf's stores, and its Save offers every home
 *     with this one preselected
 *
 * Surfaces soft warnings (e.g. multiple files marked default) above the list.
 *
 * "Show archived" flips the mutator's fetch, not a client-side filter: the
 * server decides what's hidden, so the list can never disagree with the API.
 *
 * @module components/scenarios/ScenariosManager
 */

import { useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import { showConfirmation, showPrompt } from '@/lib/alert'
import { STAFF_AVATARS } from '@/lib/chat/staff-display-names'
import { useImagesHidden } from '@/components/quick-hide/images-hidden-context'
import type { SaveScenarioTargetKey } from '@/components/scenario-builder/ScenarioBuilderDialog'
import { ScenarioEditorModal } from './ScenarioEditorModal'
import { ScenarioRow } from './ScenarioRow'
import type { Scenario, ScenarioMutator } from './types'

// Loaded on demand: the builder stays out of this surface's bundle until the Host is asked.
const ScenarioBuilderDialog = dynamic(
  () => import('@/components/scenario-builder/ScenarioBuilderDialog').then((m) => m.ScenarioBuilderDialog),
  { ssr: false },
)

/** Which scenarios shelf a manager is showing — General, one project's, or one group's. */
export type ScenarioShelf =
  | { kind: 'general' }
  | { kind: 'project'; projectId: string; projectName?: string | null }
  | { kind: 'group'; groupId: string }

function shelfSaveTarget(shelf: ScenarioShelf): SaveScenarioTargetKey {
  switch (shelf.kind) {
    case 'general':
      return 'general'
    case 'project':
      return `project:${shelf.projectId}`
    case 'group':
      return `group:${shelf.groupId}`
  }
}

interface ScenariosManagerProps {
  mutator: ScenarioMutator
  /** Used in default-tag label and the editor modal's checkbox copy. e.g. "project" or "general". */
  scopeLabel: string
  /** Empty-state copy. Defaults to a generic message. */
  emptyMessage?: string
  /** The shelf being managed; offers the Host's Scenario Builder when set. */
  shelf?: ScenarioShelf
}

export function ScenariosManager({
  mutator,
  scopeLabel,
  emptyMessage = "No scenarios yet. Create one and it'll be offered when starting new chats.",
  shelf,
}: ScenariosManagerProps) {
  const imagesHidden = useImagesHidden()
  const [builderOpen, setBuilderOpen] = useState(false)
  const {
    scenarios,
    warnings,
    loading,
    error,
    createScenario,
    updateScenario,
    renameScenario,
    deleteScenario,
    setDefaultScenario,
    setScenarioArchived,
    showArchived,
    setShowArchived,
    refresh,
  } = mutator

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const openCreate = useCallback(() => {
    setEditingScenario(null)
    setEditorOpen(true)
  }, [])

  const openEdit = useCallback((scenario: Scenario) => {
    setEditingScenario(scenario)
    setEditorOpen(true)
  }, [])

  const handleSave = useCallback<
    React.ComponentProps<typeof ScenarioEditorModal>['onSave']
  >(
    async (input) => {
      setActionError(null)
      if (editingScenario) {
        return updateScenario(editingScenario.path, {
          name: input.name,
          ...(input.description !== undefined && { description: input.description }),
          isDefault: input.isDefault,
          body: input.body,
        })
      }
      if (!input.filename) {
        return { ok: false, error: 'Filename is required for new scenarios.' }
      }
      const result = await createScenario({
        filename: input.filename,
        name: input.name,
        ...(input.description !== undefined && { description: input.description }),
        isDefault: input.isDefault,
        body: input.body,
      })
      if (result.ok) return { ok: true }
      return { ok: false, error: result.error }
    },
    [editingScenario, createScenario, updateScenario],
  )

  async function handleDelete(scenario: Scenario) {
    const confirmed = await showConfirmation(
      `Delete scenario "${scenario.name}"? This cannot be undone.`,
    )
    if (!confirmed) return
    setActionError(null)
    const result = await deleteScenario(scenario.path)
    if (!result.ok) setActionError(result.error)
  }

  async function handleRename(scenario: Scenario) {
    const next = await showPrompt(`Rename scenario "${scenario.filename}" to:`, scenario.filename)
    if (next === undefined) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === scenario.filename) return
    setActionError(null)
    const result = await renameScenario(scenario.path, trimmed)
    if (!result.ok) setActionError(result.error)
  }

  async function handleSetDefault(scenario: Scenario) {
    if (scenario.isDefault) return
    setActionError(null)
    const result = await setDefaultScenario(scenario.path)
    if (!result.ok) setActionError(result.error)
  }

  async function handleToggleArchived(scenario: Scenario) {
    setActionError(null)
    const result = await setScenarioArchived(scenario.path, !scenario.archived)
    if (!result.ok) setActionError(result.error)
  }

  return (
    <div className="space-y-3 @container">
      {warnings.length > 0 && (
        <div className="qt-alert-warning space-y-1" role="alert">
          {warnings.map((w, i) => (
            <p key={i} className="qt-text-warning">{w}</p>
          ))}
        </div>
      )}

      {actionError && (
        <div className="qt-alert-error" role="alert">
          {actionError}
        </div>
      )}

      {error && (
        <div className="qt-alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 qt-text-small">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="qt-checkbox"
          />
          Show archived
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          {shelf && (
            <button
              type="button"
              onClick={() => setBuilderOpen(true)}
              className="qt-button qt-button-secondary qt-button-sm inline-flex items-center gap-1.5"
            >
              {!imagesHidden && (
                <img
                  src={STAFF_AVATARS.host ?? '/images/avatars/host-avatar.webp'}
                  alt=""
                  className="h-4 w-4 rounded-full"
                />
              )}
              Ask the Host to set the scene
            </button>
          )}
          <button onClick={openCreate} className="qt-button qt-button-primary qt-button-sm">
            + New scenario
          </button>
        </div>
      </div>

      {loading ? (
        <p className="qt-text-secondary text-sm">Loading scenarios…</p>
      ) : scenarios.length === 0 ? (
        <p className="qt-text-secondary text-sm">{emptyMessage}</p>
      ) : (
        <ul className="divide-y qt-border-default">
          {scenarios.map((scenario) => (
            <ScenarioRow
              key={scenario.path}
              scenario={scenario}
              scopeLabel={scopeLabel}
              onSetDefault={handleSetDefault}
              onEdit={openEdit}
              onRename={handleRename}
              onDelete={handleDelete}
              onToggleArchived={handleToggleArchived}
            />
          ))}
        </ul>
      )}

      <ScenarioEditorModal
        isOpen={editorOpen}
        scenario={editingScenario}
        defaultScopeLabel={scopeLabel}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
      />

      {shelf && builderOpen && (
        <ScenarioBuilderDialog
          isOpen={builderOpen}
          onClose={() => setBuilderOpen(false)}
          cast={[]}
          projectId={shelf.kind === 'project' ? shelf.projectId : null}
          projectName={shelf.kind === 'project' ? shelf.projectName : null}
          groupIds={shelf.kind === 'group' ? [shelf.groupId] : undefined}
          saveTargets="everywhere"
          defaultSaveTarget={shelfSaveTarget(shelf)}
          // Wherever it was filed, this shelf may have gained a row.
          onSaved={() => void refresh({ silent: true })}
        />
      )}
    </div>
  )
}
