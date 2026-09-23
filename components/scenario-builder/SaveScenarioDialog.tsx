'use client'

/**
 * Save as scenario… — files the Host's scene in one of the four scenario homes:
 * Quilltap General, the project, a cast member's group, or one cast
 * character's own scenarios. Posts to that tier's existing create endpoint; no
 * new storage. A filename collision comes back as a 400 and keeps the dialog
 * open so the user can rename.
 */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import BaseModal from '@/components/ui/BaseModal'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showSuccessToast } from '@/lib/toast'

export interface ScenarioBuilderCastMember {
  id: string
  name: string
}

/** Where a scene was filed — enough for a surface to select it in its picker. */
export type SavedScenarioTarget =
  | { kind: 'general'; path: string }
  | { kind: 'project'; projectId: string; path: string }
  | { kind: 'group'; groupId: string; path: string }
  | { kind: 'character'; characterId: string; scenarioId: string; title: string; content: string }

interface SaveScenarioDialogProps {
  isOpen: boolean
  onClose: () => void
  /** The scene body to file. */
  body: string
  defaultName: string
  projectId?: string | null
  projectName?: string | null
  /** The cast — their groups and their own scenario lists are offered. */
  cast: ScenarioBuilderCastMember[]
  onSaved: (target: SavedScenarioTarget) => void
}

interface GroupRow {
  id: string
  name: string
}

export function SaveScenarioDialog({
  isOpen,
  onClose,
  body,
  defaultName,
  projectId,
  projectName,
  cast,
  onSaved,
}: SaveScenarioDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState('general')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const castKey = useMemo(() => cast.map((c) => c.id).sort().join(','), [cast])

  const { data: groupData } = useQuery({
    queryKey: queryKeys.groups.byCharacters(castKey),
    queryFn: ({ signal }) =>
      apiFetch<{ groups: GroupRow[] }>(
        `/api/v1/groups?characterIds=${encodeURIComponent(castKey)}`,
        { signal },
      ),
    enabled: isOpen && castKey.length > 0,
  })
  const groups = groupData?.groups ?? []

  const handleSave = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('A scenario wants a name before it can be filed.')
      return
    }
    setSaving(true)
    setError(null)

    const fileBody = {
      filename: trimmedName,
      name: trimmedName,
      ...(description.trim() && { description: description.trim() }),
      body,
    }

    try {
      let url: string
      let payload: Record<string, unknown>
      if (target === 'general') {
        url = '/api/v1/scenarios'
        payload = fileBody
      } else if (target === 'project' && projectId) {
        url = `/api/v1/projects/${projectId}/scenarios`
        payload = fileBody
      } else if (target.startsWith('group:')) {
        url = `/api/v1/groups/${target.slice('group:'.length)}/scenarios`
        payload = fileBody
      } else if (target.startsWith('character:')) {
        url = `/api/v1/characters/${target.slice('character:'.length)}/scenarios`
        payload = { title: trimmedName, content: body }
      } else {
        setError('Choose where the scenario should live.')
        return
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        path?: string
        scenario?: { id?: string }
      }
      if (!res.ok) {
        setError(data.error || `The scenario could not be filed (HTTP ${res.status}).`)
        return
      }

      let saved: SavedScenarioTarget | null = null
      if (target === 'general' && data.path) {
        saved = { kind: 'general', path: data.path }
      } else if (target === 'project' && projectId && data.path) {
        saved = { kind: 'project', projectId, path: data.path }
      } else if (target.startsWith('group:') && data.path) {
        saved = { kind: 'group', groupId: target.slice('group:'.length), path: data.path }
      } else if (target.startsWith('character:') && data.scenario?.id) {
        saved = {
          kind: 'character',
          characterId: target.slice('character:'.length),
          scenarioId: data.scenario.id,
          title: trimmedName,
          content: body,
        }
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.all })
      showSuccessToast(`“${trimmedName}” has been filed among the scenarios.`)
      if (saved) onSaved(saved)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The scenario could not be filed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={saving ? () => {} : onClose}
      title="File this scene as a scenario"
      maxWidth="md"
      closeOnClickOutside={false}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="qt-button-secondary">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="qt-button-primary">
            {saving ? 'Filing…' : 'Save'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="save-scenario-name" className="qt-label mb-1 block">
            Name
          </label>
          <input
            id="save-scenario-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            disabled={saving}
            className="qt-input"
          />
        </div>
        <div>
          <label htmlFor="save-scenario-description" className="qt-label mb-1 block">
            Description (optional)
          </label>
          <input
            id="save-scenario-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            disabled={saving || target.startsWith('character:')}
            className="qt-input"
          />
          {target.startsWith('character:') && (
            <p className="mt-1 text-xs qt-text-muted">
              A character&rsquo;s own scenarios keep a title and a body only.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="save-scenario-target" className="qt-label mb-1 block">
            Where it lives
          </label>
          <select
            id="save-scenario-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={saving}
            className="qt-select"
          >
            <option value="general">Quilltap General</option>
            {projectId && <option value="project">Project: {projectName || 'this project'}</option>}
            {groups.map((g) => (
              <option key={g.id} value={`group:${g.id}`}>
                Group: {g.name}
              </option>
            ))}
            {cast.map((c) => (
              <option key={c.id} value={`character:${c.id}`}>
                {c.name}&rsquo;s scenarios
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p role="alert" className="text-sm qt-text-danger">
            {error}
          </p>
        )}
      </div>
    </BaseModal>
  )
}
