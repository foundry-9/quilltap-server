'use client'

/**
 * useProjectScenarios — fetch and mutate the project's `Scenarios/*.md`
 * files via `/api/v1/projects/[id]/scenarios/...`.
 *
 * Thin wrapper over the shared `useScenarioMutator` body; only the API base
 * path is project-specific. Implements the shared `ScenarioMutator` contract
 * so this hook and `useGeneralScenarios` stay interchangeable behind
 * `ScenariosManager` — the on-disk shape is identical across scopes, only the
 * mount point differs.
 *
 * @module app/prospero/[id]/hooks/useProjectScenarios
 */

import { useCallback } from 'react'
import { useScenarioMutator } from '@/components/scenarios/use-scenario-mutator'
import { queryKeys } from '@/lib/query/keys'
import type { ScenarioMutator } from '@/components/scenarios/types'

export function useProjectScenarios(projectId: string): ScenarioMutator {
  const listKey = useCallback(
    (includeArchived: boolean) => queryKeys.scenarios.project(projectId, includeArchived),
    [projectId],
  )
  return useScenarioMutator(`/api/v1/projects/${projectId}/scenarios`, listKey)
}
