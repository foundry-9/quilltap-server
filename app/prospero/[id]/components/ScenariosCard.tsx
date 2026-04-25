'use client'

/**
 * Scenarios Card
 *
 * Lists every project scenario with controls for create / edit / rename /
 * delete / set-default. Surfaces soft warnings (e.g. multiple files marked
 * default) at the top of the card.
 *
 * Reads from `/api/v1/projects/[id]/scenarios/...` via `useProjectScenarios`.
 *
 * @module app/prospero/[id]/components/ScenariosCard
 */

import { useCallback, useState } from 'react'
import { ChevronIcon } from '@/components/ui/ChevronIcon'
import { showConfirmation } from '@/lib/alert'
import { ScenarioEditorModal } from './ScenarioEditorModal'
import { useProjectScenarios, type ProjectScenario } from '../hooks'

interface ScenariosCardProps {
  projectId: string
  expanded: boolean
  onToggle: () => void
}

function ScenariosIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  )
}

export function ScenariosCard({ projectId, expanded, onToggle }: ScenariosCardProps) {
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
  } = useProjectScenarios(projectId)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingScenario, setEditingScenario] = useState<ProjectScenario | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const openCreate = useCallback(() => {
    setEditingScenario(null)
    setEditorOpen(true)
  }, [])

  const openEdit = useCallback((scenario: ProjectScenario) => {
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

  async function handleDelete(scenario: ProjectScenario) {
    const confirmed = await showConfirmation(
      `Delete scenario "${scenario.name}"? This cannot be undone.`,
    )
    if (!confirmed) return
    setActionError(null)
    const result = await deleteScenario(scenario.path)
    if (!result.ok) setActionError(result.error)
  }

  async function handleRename(scenario: ProjectScenario) {
    const next = prompt(`Rename scenario "${scenario.filename}" to:`, scenario.filename)
    if (!next || next.trim() === scenario.filename) return
    setActionError(null)
    const result = await renameScenario(scenario.path, next.trim())
    if (!result.ok) setActionError(result.error)
  }

  async function handleSetDefault(scenario: ProjectScenario) {
    if (scenario.isDefault) return
    setActionError(null)
    const result = await setDefaultScenario(scenario.path)
    if (!result.ok) setActionError(result.error)
  }

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <ScenariosIcon className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Scenarios ({scenarios.length})</h3>
            <p className="qt-text-small qt-text-secondary">
              Reusable starting scenes for new chats in this project
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {/* Content */}
      {expanded && (
        <div className="border-t qt-border-default p-4 space-y-3">
          {/* Soft warnings banner */}
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

          {/* New scenario button */}
          <div className="flex justify-end">
            <button onClick={openCreate} className="qt-button qt-button-primary qt-button-sm">
              + New scenario
            </button>
          </div>

          {/* List */}
          {loading ? (
            <p className="qt-text-secondary text-sm">Loading scenarios…</p>
          ) : scenarios.length === 0 ? (
            <p className="qt-text-secondary text-sm">
              No scenarios yet. Create one and it&apos;ll be offered when starting new chats in this project.
            </p>
          ) : (
            <ul className="divide-y qt-border-default">
              {scenarios.map((scenario) => (
                <li
                  key={scenario.path}
                  className="py-3 flex items-start gap-3"
                >
                  <input
                    type="radio"
                    checked={scenario.isDefault}
                    onChange={() => handleSetDefault(scenario)}
                    className="qt-radio mt-1"
                    title={scenario.isDefault ? 'Project default' : 'Set as project default'}
                    aria-label={`Set ${scenario.name} as project default`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h4 className="text-sm font-medium text-foreground truncate">
                        {scenario.name}
                      </h4>
                      <span className="qt-text-xs qt-text-secondary truncate">
                        {scenario.filename}.md
                      </span>
                      {scenario.isDefault && (
                        <span className="qt-badge qt-badge-primary qt-text-xs">Default</span>
                      )}
                    </div>
                    {scenario.description && (
                      <p className="qt-text-small qt-text-secondary mt-1">{scenario.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(scenario)}
                      className="qt-button qt-button-ghost qt-button-sm"
                      title="Edit scenario"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleRename(scenario)}
                      className="qt-button qt-button-ghost qt-button-sm"
                      title="Rename file"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => handleDelete(scenario)}
                      className="qt-button qt-button-ghost qt-button-sm qt-text-destructive"
                      title="Delete scenario"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ScenarioEditorModal
        isOpen={editorOpen}
        scenario={editingScenario}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
      />
    </div>
  )
}
