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
 *
 * Surfaces soft warnings (e.g. multiple files marked default) above the list.
 *
 * @module components/scenarios/ScenariosManager
 */

import { useCallback, useState } from 'react'
import { showConfirmation, showPrompt } from '@/lib/alert'
import { ScenarioEditorModal } from './ScenarioEditorModal'
import { ScenarioRow } from './ScenarioRow'
import type { Scenario, ScenarioMutator } from './types'

interface ScenariosManagerProps {
  mutator: ScenarioMutator
  /** Used in default-tag label and the editor modal's checkbox copy. e.g. "project" or "general". */
  scopeLabel: string
  /** Empty-state copy. Defaults to a generic message. */
  emptyMessage?: string
}

export function ScenariosManager({
  mutator,
  scopeLabel,
  emptyMessage = "No scenarios yet. Create one and it'll be offered when starting new chats.",
}: ScenariosManagerProps) {
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

  return (
    <div className="space-y-3 @container">
      {warnings.length > 0 && (
        <div className="qt-bg-warning/10 qt-border qt-border-warning rounded p-3 text-sm space-y-1" role="alert">
          {warnings.map((w, i) => (
            <p key={i} className="qt-text-warning">{w}</p>
          ))}
        </div>
      )}

      {actionError && (
        <div className="qt-bg-destructive/10 qt-border qt-border-destructive rounded p-3 text-sm qt-text-destructive" role="alert">
          {actionError}
        </div>
      )}

      {error && (
        <div className="qt-bg-destructive/10 qt-border qt-border-destructive rounded p-3 text-sm qt-text-destructive" role="alert">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={openCreate} className="qt-button qt-button-primary qt-button-sm">
          + New scenario
        </button>
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
    </div>
  )
}
