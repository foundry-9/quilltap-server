'use client'

/**
 * The draft of a tool-settings dialog: the two disabled lists (tools and
 * groups) a chat or project stores, held in `useDraft` so a refetch that hands
 * in new arrays with the same values never overwrites unsaved toggles, and
 * discarded with `reset()` when the dialog is dismissed.
 *
 * @module components/tools/tool-settings/useToolSettingsDraft
 */

import { useCallback, useMemo } from 'react'
import { useDraft } from '@/lib/hooks/use-draft'

/** A list as a stable, comparable value (order and duplicates do not matter). */
function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort()
}

export interface ToolSettingsDraft {
  disabledTools: Set<string>
  disabledGroups: Set<string>
  setDisabledTools: (next: Set<string>) => void
  setDisabledGroups: (next: Set<string>) => void
  /** Either list differs from the stored value */
  dirty: boolean
  /** Discard the unsaved toggles and take the stored lists again */
  reset: () => void
}

export function useToolSettingsDraft(
  storedDisabledTools: string[],
  storedDisabledGroups: string[],
): ToolSettingsDraft {
  const serverTools = useMemo(() => sortedUnique(storedDisabledTools), [storedDisabledTools])
  const serverGroups = useMemo(() => sortedUnique(storedDisabledGroups), [storedDisabledGroups])
  const [draftTools, setDraftTools, toolsDraft] = useDraft(serverTools)
  const [draftGroups, setDraftGroups, groupsDraft] = useDraft(serverGroups)

  const disabledTools = useMemo(() => new Set(draftTools), [draftTools])
  const disabledGroups = useMemo(() => new Set(draftGroups), [draftGroups])
  const setDisabledTools = useCallback((next: Set<string>) => setDraftTools(sortedUnique(next)), [setDraftTools])
  const setDisabledGroups = useCallback((next: Set<string>) => setDraftGroups(sortedUnique(next)), [setDraftGroups])

  const resetTools = toolsDraft.reset
  const resetGroups = groupsDraft.reset
  const reset = useCallback(() => {
    resetTools()
    resetGroups()
  }, [resetTools, resetGroups])

  return {
    disabledTools,
    disabledGroups,
    setDisabledTools,
    setDisabledGroups,
    dirty: toolsDraft.dirty || groupsDraft.dirty,
    reset,
  }
}
