'use client'

/**
 * useScenarioMutator — the shared body of the scenario hooks: fetch and
 * mutate `Scenarios/*.md` files under a caller-supplied API base path.
 *
 * Each list/create/update/rename/delete response includes the freshly listed
 * scenarios + any soft warnings (e.g. multiple `isDefault: true` files), so
 * a single round trip is enough to keep the UI in sync.
 *
 * `useProjectScenarios` and `useGeneralScenarios` are thin wrappers over this
 * — the on-disk shape is identical across scopes, only the mount point
 * differs — so both stay interchangeable behind `ScenariosManager` via the
 * shared `ScenarioMutator` contract.
 *
 * @module components/scenarios/use-scenario-mutator
 */

import { useCallback, useState } from 'react'
import { hashKey, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { withArchivedParam } from '@/components/scenarios/archived-query'
import type { Scenario, ScenarioMutator } from '@/components/scenarios/types'

interface ListResponse {
  mountPointId?: string | null
  scenarios: Scenario[]
  warnings?: string[]
}

interface MutateResponse {
  scenarios: Scenario[]
  warnings: string[]
}

const NO_SCENARIOS: Scenario[] = []
const NO_WARNINGS: string[] = []

function encodePathSegment(p: string): string {
  // Strip the Scenarios/ prefix if present and the .md extension; the API
  // accepts the bare filename for ergonomic URLs.
  const stripped = p.replace(/^Scenarios\//, '').replace(/\.md$/i, '')
  return encodeURIComponent(stripped)
}

/**
 * @param basePath The scope's collection route.
 * @param listKey  The scope's list key, when the pickers read the same list
 *   under one (`queryKeys.scenarios.general` / `project`); otherwise the list
 *   is cached under `queryKeys.scenarios.store(basePath)`.
 */
export function useScenarioMutator(
  basePath: string,
  listKey?: (includeArchived: boolean) => QueryKey,
): ScenarioMutator {
  const queryClient = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)

  const collectionUrl = withArchivedParam(basePath, showArchived)
  const key: QueryKey = listKey ? listKey(showArchived) : queryKeys.scenarios.store(basePath, showArchived)

  // The server decides what is visible, so "Show archived" is a different
  // list (a different key), not a filter.
  // `collectionUrl` is basePath + showArchived, which the key (the caller's or
  // the store default) already encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => apiFetch<ListResponse>(collectionUrl, { signal }),
  })
  const scenarios = query.data?.scenarios ?? NO_SCENARIOS
  const warnings = query.data?.warnings ?? NO_WARNINGS
  // A re-read keeps the current list on screen; only the first read shows the
  // loading state, so a `silent` refresh and a plain one look the same.
  const loading = query.isPending
  const error = query.error ? apiErrorMessage(query.error, 'Failed to load scenarios') : null

  const itemUrl = useCallback(
    (scenarioPath: string, query = '') =>
      withArchivedParam(
        `${basePath}/${encodePathSegment(scenarioPath)}${query}`,
        showArchived,
      ),
    [basePath, showArchived],
  )

  const { refetch } = query
  const refresh = useCallback<ScenarioMutator['refresh']>(async () => {
    await refetch()
  }, [refetch])

  // Every write answers with the freshly listed scenarios: that answer is this
  // list, and every other scenario list (the pickers' tiers, the other
  // archived view) is re-read, since the same files may be in them.
  const ownHash = hashKey(key)
  const applyMutateResponse = useCallback((data: MutateResponse) => {
    queryClient.setQueryData<ListResponse>(key, (prev) => ({
      ...prev,
      scenarios: data.scenarios || [],
      warnings: data.warnings || [],
    }))
    void queryClient.invalidateQueries({
      queryKey: queryKeys.scenarios.all,
      predicate: (q) => q.queryHash !== ownHash,
    })
    // `key` is rebuilt each render from the values `ownHash` encodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ownHash is the identity of key
  }, [queryClient, ownHash])

  const createScenario = useCallback<ScenarioMutator['createScenario']>(
    async (input) => {
      try {
        const res = await fetch(collectionUrl, {
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
    [collectionUrl, applyMutateResponse],
  )

  const updateScenario = useCallback<ScenarioMutator['updateScenario']>(
    async (scenarioPath, input) => {
      try {
        const res = await fetch(itemUrl(scenarioPath), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
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
    [itemUrl, applyMutateResponse],
  )

  const renameScenario = useCallback<ScenarioMutator['renameScenario']>(
    async (scenarioPath, newFilename) => {
      try {
        const res = await fetch(itemUrl(scenarioPath, '?action=rename'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newFilename }),
        })
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
    [itemUrl, applyMutateResponse],
  )

  const deleteScenario = useCallback<ScenarioMutator['deleteScenario']>(
    async (scenarioPath) => {
      try {
        const res = await fetch(itemUrl(scenarioPath), { method: 'DELETE' })
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
    [itemUrl, applyMutateResponse],
  )

  const setDefaultScenario = useCallback<ScenarioMutator['setDefaultScenario']>(
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

  const setScenarioArchived = useCallback<ScenarioMutator['setScenarioArchived']>(
    async (scenarioPath, archived) => {
      const current = scenarios.find(s => s.path === scenarioPath)
      if (!current) {
        return { ok: false, error: 'Scenario not found in current list' }
      }
      return updateScenario(scenarioPath, {
        name: current.name,
        ...(current.description !== undefined && { description: current.description }),
        // An archived scenario can never be the default; drop the claim on the
        // way in rather than leaving a dead `isDefault: true` in the file.
        isDefault: archived ? false : current.isDefault,
        archived,
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
    showArchived,
    setShowArchived,
    refresh,
    createScenario,
    updateScenario,
    renameScenario,
    deleteScenario,
    setDefaultScenario,
    setScenarioArchived,
  }
}
