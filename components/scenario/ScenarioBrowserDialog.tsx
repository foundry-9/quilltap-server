'use client'

/**
 * The scenario browser — "Every scene on every shelf".
 *
 * Opened from the scenario dropdown's "Browse all scenarios…" entry, on both
 * the New Chat dialog and the Salon's in-chat control. Lists every scenario in
 * the instance (`GET /api/v1/scenarios?action=everywhere`), grouped by owner —
 * General, projects, groups, characters — searchable across every shelf, with
 * the highlighted scene's full body previewed (`?action=read`, one body at a
 * time, cached per ref).
 *
 * A pick that lies inside the chat's own hierarchy snaps to its native kind,
 * so the dropdown shows it under its usual heading; anything else becomes a
 * `store` selection labelled `Owner › Name`, which the dropdown shows under
 * "Elsewhere" and the server resolves by ref.
 *
 * Fetched on open with `staleTime: 0`; nothing polls.
 */

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { BaseModal } from '@/components/ui/BaseModal'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { withArchivedParam } from '@/components/scenarios/archived-query'
import type { ScenarioSelection } from './types'

export type ScenarioOwnerScope = 'general' | 'project' | 'group' | 'character'

/** One row of the instance-wide catalogue (no body). */
export interface BrowserScenario {
  path: string
  scenarioId?: string
  filename: string
  name: string
  description?: string
  isDefault: boolean
  archived: boolean
  excerpt: string
  updatedAt: string
}

/** One owner's shelf. */
export interface BrowserSource {
  scope: ScenarioOwnerScope
  id: string | null
  name: string
  mountPointId: string
  scenarios: BrowserScenario[]
  warnings: string[]
}

/** The owners the chat's picker already offers without browsing. */
export interface ScenarioHierarchy {
  projectId?: string | null
  groupIds?: string[]
  /** The single LLM character, when the room holds exactly one. */
  characterId?: string | null
}

export interface ScenarioBrowserDialogProps {
  isOpen: boolean
  onClose: () => void
  hierarchy: ScenarioHierarchy
  onPick: (selection: ScenarioSelection) => void
}

const SCOPE_SECTIONS: Array<{ scope: ScenarioOwnerScope; label: string }> = [
  { scope: 'general', label: 'General' },
  { scope: 'project', label: 'Projects' },
  { scope: 'group', label: 'Groups' },
  { scope: 'character', label: 'Characters' },
]

const sourceKey = (s: Pick<BrowserSource, 'scope' | 'id'>) => `${s.scope}:${s.id ?? ''}`
const rowKey = (mountPointId: string, path: string) => `${mountPointId}|${path}`

/** True when the chat's dropdown already offers this owner's shelf. */
export function isInHierarchy(source: Pick<BrowserSource, 'scope' | 'id'>, hierarchy: ScenarioHierarchy): boolean {
  switch (source.scope) {
    case 'general':
      return true
    case 'project':
      return !!source.id && source.id === hierarchy.projectId
    case 'group':
      return !!source.id && (hierarchy.groupIds ?? []).includes(source.id)
    case 'character':
      return !!source.id && source.id === hierarchy.characterId
    default:
      return false
  }
}

/**
 * Turn a browser pick into the selection the dropdown holds: the native kind
 * when the pick is in the chat's hierarchy, a `store` selection otherwise.
 */
export function pickToSelection(
  source: BrowserSource,
  scenario: BrowserScenario,
  hierarchy: ScenarioHierarchy,
): ScenarioSelection {
  if (isInHierarchy(source, hierarchy)) {
    if (source.scope === 'general') return { kind: 'general', path: scenario.path }
    if (source.scope === 'project') return { kind: 'project', path: scenario.path }
    if (source.scope === 'group' && source.id) return { kind: 'group', groupId: source.id, path: scenario.path }
    if (source.scope === 'character' && scenario.scenarioId) {
      return { kind: 'character', scenarioId: scenario.scenarioId }
    }
  }
  return {
    kind: 'store',
    mountPointId: source.mountPointId,
    path: scenario.path,
    label: `${source.name} › ${scenario.name}`,
  }
}

/** Case-insensitive match on name, description, excerpt and owner name. */
export function scenarioMatchesSearch(source: BrowserSource, scenario: BrowserScenario, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [scenario.name, scenario.description ?? '', scenario.excerpt, source.name].some((field) =>
    field.toLowerCase().includes(q),
  )
}

export function ScenarioBrowserDialog({ isOpen, onClose, hierarchy, onPick }: ScenarioBrowserDialogProps) {
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<ScenarioOwnerScope, boolean>>({
    general: false,
    project: false,
    group: false,
    character: false,
  })
  const [highlight, setHighlight] = useState<{ mountPointId: string; path: string } | null>(null)
  const resultsRef = useRef<HTMLUListElement>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.scenarios.everywhere(showArchived),
    queryFn: ({ signal }) =>
      apiFetch<{ sources: BrowserSource[] }>(
        withArchivedParam('/api/v1/scenarios?action=everywhere', showArchived),
        { signal },
      ),
    enabled: isOpen,
    staleTime: 0,
  })

  const sources = useMemo(() => data?.sources ?? [], [data])

  const results = useMemo(() => {
    const searching = search.trim().length > 0
    const rows: Array<{ source: BrowserSource; scenario: BrowserScenario }> = []
    for (const source of sources) {
      if (!searching && selectedSourceKey && sourceKey(source) !== selectedSourceKey) continue
      for (const scenario of source.scenarios) {
        if (scenarioMatchesSearch(source, scenario, search)) rows.push({ source, scenario })
      }
    }
    return rows
  }, [sources, search, selectedSourceKey])

  // Only a highlight that is actually listed counts; one filtered away by the
  // search reads as nothing highlighted.
  const highlighted = highlight
    ? results.find((r) => r.source.mountPointId === highlight.mountPointId && r.scenario.path === highlight.path) ?? null
    : null

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: queryKeys.scenarios.ref(highlight?.mountPointId ?? '', highlight?.path ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<{ scenario: { body: string } }>(
        `/api/v1/scenarios?action=read&mountPointId=${encodeURIComponent(highlight!.mountPointId)}&path=${encodeURIComponent(highlight!.path)}`,
        { signal },
      ),
    enabled: isOpen && highlighted !== null,
  })

  const showAllOwners = search.trim().length > 0 || selectedSourceKey === null

  const handleUse = () => {
    if (!highlighted) return
    onPick(pickToSelection(highlighted.source, highlighted.scenario, hierarchy))
    onClose()
  }

  const moveHighlight = (delta: number) => {
    if (results.length === 0) return
    const index = highlighted ? results.indexOf(highlighted) : -1
    const next = results[Math.min(results.length - 1, Math.max(0, index + delta))]
    setHighlight({ mountPointId: next.source.mountPointId, path: next.scenario.path })
    const el = resultsRef.current?.querySelector<HTMLElement>(
      `[data-row="${CSS.escape(rowKey(next.source.mountPointId, next.scenario.path))}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveHighlight(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveHighlight(-1)
    } else if (e.key === 'Enter' && highlighted) {
      e.preventDefault()
      handleUse()
    }
  }

  const footer = (
    <div className="flex gap-2 justify-end">
      <button type="button" onClick={onClose} className="qt-button-secondary">
        Cancel
      </button>
      <button type="button" onClick={handleUse} disabled={!highlighted} className="qt-button-primary">
        Use this scenario
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Every scene on every shelf"
      maxWidth="4xl"
      showCloseButton={true}
      footer={footer}
    >
      <div onKeyDown={handleKeyDown} className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search every shelf…"
            aria-label="Search scenarios"
            className="qt-input flex-1"
            autoFocus
          />
          <label className="flex items-center gap-2 qt-text-secondary text-sm">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="qt-checkbox"
            />
            Show archived
          </label>
        </div>

        {error ? (
          <p className="qt-text-destructive text-sm">The shelves could not be reached: {error.message}</p>
        ) : isLoading ? (
          <p className="qt-text-secondary text-sm">Dusting the shelves…</p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3 min-h-0">
            {/* Sources */}
            <nav aria-label="Scenario owners" className="sm:w-56 shrink-0 max-h-48 sm:max-h-[55vh] overflow-y-auto">
              <button
                type="button"
                onClick={() => setSelectedSourceKey(null)}
                className={`w-full text-left text-sm px-2 py-1 rounded ${selectedSourceKey === null ? 'qt-bg-surface-hover font-medium' : ''}`}
              >
                Every shelf
              </button>
              {SCOPE_SECTIONS.map(({ scope, label }) => {
                const owners = sources.filter((s) => s.scope === scope)
                if (owners.length === 0) return null
                return (
                  <div key={scope} className="mt-2">
                    <button
                      type="button"
                      onClick={() => setCollapsed((c) => ({ ...c, [scope]: !c[scope] }))}
                      aria-expanded={!collapsed[scope]}
                      className="w-full text-left text-xs uppercase tracking-wide qt-text-secondary px-2 py-1"
                    >
                      {collapsed[scope] ? '▸' : '▾'} {label}
                    </button>
                    {!collapsed[scope] && (
                      <ul>
                        {owners.map((owner) => {
                          const key = sourceKey(owner)
                          const empty = owner.scenarios.length === 0
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                onClick={() => setSelectedSourceKey(key)}
                                title={empty ? 'Nothing filed here yet.' : undefined}
                                className={`w-full text-left text-sm px-2 py-1 rounded flex items-center gap-1 ${selectedSourceKey === key ? 'qt-bg-surface-hover font-medium' : ''} ${empty ? 'qt-text-secondary opacity-60' : ''}`}
                              >
                                <span className="truncate flex-1">{owner.name}</span>
                                {isInHierarchy(owner, hierarchy) && (
                                  <span className="qt-badge qt-badge-outline text-xs">in this chat</span>
                                )}
                                <span className="qt-text-secondary text-xs">{owner.scenarios.length}</span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </nav>

            {/* Results + preview */}
            <div className="flex-1 min-w-0 flex flex-col gap-3">
              {results.length === 0 ? (
                <p className="qt-text-secondary text-sm px-2 py-4">
                  {search.trim()
                    ? 'Nothing on that shelf answers to the name.'
                    : 'Nothing filed here yet.'}
                </p>
              ) : (
                <ul
                  ref={resultsRef}
                  role="listbox"
                  aria-label="Scenarios"
                  className="max-h-60 sm:max-h-[30vh] overflow-y-auto border qt-border-default rounded-lg"
                >
                  {results.map(({ source, scenario }) => {
                    const isHighlighted =
                      highlighted?.source.mountPointId === source.mountPointId &&
                      highlighted.scenario.path === scenario.path
                    return (
                      <li
                        key={rowKey(source.mountPointId, scenario.path)}
                        data-row={rowKey(source.mountPointId, scenario.path)}
                        role="option"
                        aria-selected={isHighlighted}
                        onClick={() => setHighlight({ mountPointId: source.mountPointId, path: scenario.path })}
                        onDoubleClick={() => {
                          onPick(pickToSelection(source, scenario, hierarchy))
                          onClose()
                        }}
                        className={`px-3 py-2 cursor-pointer border-b qt-border-default last:border-b-0 ${isHighlighted ? 'qt-bg-surface-hover' : ''}`}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{scenario.name}</span>
                          {scenario.isDefault && <span className="qt-badge qt-badge-secondary text-xs">default</span>}
                          {scenario.archived && <span className="qt-badge qt-badge-warning text-xs">archived</span>}
                          {showAllOwners && (
                            <span className="qt-text-secondary text-xs ml-auto">{source.name}</span>
                          )}
                        </div>
                        {scenario.description && (
                          <div className="qt-text-secondary text-xs mt-0.5">{scenario.description}</div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {highlighted && (
                <div className="border qt-border-default rounded-lg qt-bg-muted/30 p-3 max-h-60 sm:max-h-[25vh] overflow-y-auto">
                  <div className="qt-text-secondary text-xs mb-2">
                    {highlighted.source.name} › {highlighted.scenario.name}
                  </div>
                  {previewLoading ? (
                    <p className="qt-text-secondary text-sm">{highlighted.scenario.excerpt}</p>
                  ) : (
                    <div className="prose prose-sm qt-prose-auto max-w-none">
                      <ReactMarkdown>{preview?.scenario.body ?? highlighted.scenario.excerpt}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </BaseModal>
  )
}
