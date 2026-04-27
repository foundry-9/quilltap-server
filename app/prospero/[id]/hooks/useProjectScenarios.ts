'use client'

/**
 * useProjectScenarios — fetch and mutate the project's `Scenarios/*.md`
 * files via `/api/v1/projects/[id]/scenarios/...`.
 *
 * Each list/create/update/rename/delete response includes the freshly listed
 * scenarios + any soft warnings (e.g. multiple `isDefault: true` files), so
 * a single round trip is enough to keep the UI in sync.
 *
 * @module app/prospero/[id]/hooks/useProjectScenarios
 */

import { useCallback, useEffect, useState } from 'react'

export interface ProjectScenario {
  path: string
  filename: string
  name: string
  description?: string
  isDefault: boolean
  rawIsDefault: boolean
  body: string
  lastModified: string
  createdAt: string
  updatedAt: string
}

interface ListResponse {
  mountPointId: string
  scenarios: ProjectScenario[]
  warnings: string[]
}

interface MutateResponse {
  scenarios: ProjectScenario[]
  warnings: string[]
}

export interface UseProjectScenariosReturn {
  scenarios: ProjectScenario[]
  warnings: string[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  createScenario: (input: {
    filename: string
    name?: string
    description?: string
    isDefault?: boolean
    body: string
  }) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  updateScenario: (
    scenarioPath: string,
    input: {
      name?: string
      description?: string
      isDefault?: boolean
      body: string
    },
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  renameScenario: (
    scenarioPath: string,
    newFilename: string,
  ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  deleteScenario: (scenarioPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
  setDefaultScenario: (scenarioPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

function encodePathSegment(p: string): string {
  // Strip the Scenarios/ prefix if present and the .md extension; the API
  // accepts the bare filename for ergonomic URLs.
  const stripped = p.replace(/^Scenarios\//, '').replace(/\.md$/i, '')
  return encodeURIComponent(stripped)
}

export function useProjectScenarios(projectId: string): UseProjectScenariosReturn {
  const [scenarios, setScenarios] = useState<ProjectScenario[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/scenarios`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Failed to load scenarios (${res.status})`)
      }
      const data = (await res.json()) as ListResponse
      setScenarios(data.scenarios || [])
      setWarnings(data.warnings || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount; setState lands inside async refresh()
    void refresh()
  }, [refresh])

  const applyMutateResponse = useCallback((data: MutateResponse) => {
    setScenarios(data.scenarios || [])
    setWarnings(data.warnings || [])
  }, [])

  const createScenario = useCallback<UseProjectScenariosReturn['createScenario']>(
    async (input) => {
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/scenarios`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to create (${res.status})` }
        }
        applyMutateResponse(body as MutateResponse)
        return { ok: true, path: body.path as string }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [projectId, applyMutateResponse],
  )

  const updateScenario = useCallback<UseProjectScenariosReturn['updateScenario']>(
    async (scenarioPath, input) => {
      try {
        const res = await fetch(
          `/api/v1/projects/${projectId}/scenarios/${encodePathSegment(scenarioPath)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          },
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to update (${res.status})` }
        }
        applyMutateResponse(body as MutateResponse)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [projectId, applyMutateResponse],
  )

  const renameScenario = useCallback<UseProjectScenariosReturn['renameScenario']>(
    async (scenarioPath, newFilename) => {
      try {
        const res = await fetch(
          `/api/v1/projects/${projectId}/scenarios/${encodePathSegment(scenarioPath)}?action=rename`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newFilename }),
          },
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to rename (${res.status})` }
        }
        applyMutateResponse(body as MutateResponse)
        return { ok: true, path: body.path as string }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [projectId, applyMutateResponse],
  )

  const deleteScenario = useCallback<UseProjectScenariosReturn['deleteScenario']>(
    async (scenarioPath) => {
      try {
        const res = await fetch(
          `/api/v1/projects/${projectId}/scenarios/${encodePathSegment(scenarioPath)}`,
          { method: 'DELETE' },
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to delete (${res.status})` }
        }
        applyMutateResponse(body as MutateResponse)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [projectId, applyMutateResponse],
  )

  const setDefaultScenario = useCallback<UseProjectScenariosReturn['setDefaultScenario']>(
    async (scenarioPath) => {
      // "Set default" = PUT with the existing fields and `isDefault: true`.
      // Find the current scenario state in our local list to preserve other fields.
      const current = scenarios.find(s => s.path === scenarioPath)
      if (!current) {
        return { ok: false, error: 'Scenario not found in current list' }
      }
      return updateScenario(scenarioPath, {
        name: current.name,
        ...(current.description !== undefined && { description: current.description }),
        isDefault: true,
        body: current.body,
      })
    },
    [scenarios, updateScenario],
  )

  return {
    scenarios,
    warnings,
    loading,
    error,
    refresh,
    createScenario,
    updateScenario,
    renameScenario,
    deleteScenario,
    setDefaultScenario,
  }
}
