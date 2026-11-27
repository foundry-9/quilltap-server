'use client'

/**
 * useAutonomousRoomAction — the shared optimistic start/pause/stop/resume
 * mutation for autonomous rooms, used by both the page-toolbar badges and the
 * Settings → System management card.
 *
 * The server flips the run state synchronously (start/resume → running,
 * pause → paused, stop → stopped), so the cached run state is patched the
 * instant the button is clicked instead of waiting for the POST +
 * revalidation round-trip — which can lag when the server is busy running a
 * turn. onMutate applies the optimistic patch, onError rolls back, onSettled
 * revalidates — the TanStack equivalent of SWR's
 * mutate(post, { optimisticData, rollbackOnError, revalidate }).
 *
 * `run(chatId, verb)` is the click handler: it marks that room busy (so its
 * buttons disable) until the POST settles. A failure is logged under
 * `errorLabel` and otherwise silent — the rolled-back state is the signal.
 */

import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'

export type AutonomousRoomActionVerb = 'start' | 'pause' | 'stop' | 'resume'

type RunState = 'idle' | 'running' | 'paused' | 'stopped' | 'budgetExhausted' | 'error'

/** The slice of a cached room row the optimistic patch touches. */
interface CachedRoom {
  id: string
  runState: RunState | null
}

export function useAutonomousRoomAction(errorLabel: string) {
  const queryClient = useQueryClient()
  const [busyChatId, setBusyChatId] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: async ({ chatId, verb }: { chatId: string; verb: AutonomousRoomActionVerb }) => {
      try {
        await apiFetch(`/api/v1/chats/${chatId}/autonomous-room?action=${verb}`, { method: 'POST' })
      } catch (err) {
        throw new Error(apiErrorMessage(err, `Failed to ${verb}`))
      }
    },
    onMutate: async ({ chatId, verb }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.system.autonomousRooms })
      const previous = queryClient.getQueryData<{ rooms: CachedRoom[] }>(queryKeys.system.autonomousRooms)
      const optimisticState: RunState = verb === 'pause' ? 'paused' : verb === 'stop' ? 'stopped' : 'running'
      queryClient.setQueryData<{ rooms: CachedRoom[] }>(queryKeys.system.autonomousRooms, (cur) => ({
        rooms: (cur?.rooms ?? []).map((r) => (r.id === chatId ? { ...r, runState: optimisticState } : r)),
      }))
      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.system.autonomousRooms, context.previous)
      }
      console.error(errorLabel, err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.system.autonomousRooms })
    },
  })
  const { mutateAsync } = mutation

  const run = useCallback(
    async (chatId: string, verb: AutonomousRoomActionVerb): Promise<void> => {
      setBusyChatId(chatId)
      try {
        await mutateAsync({ chatId, verb })
      } catch {
        // Already logged in the mutation's onError handler.
      } finally {
        setBusyChatId(null)
      }
    },
    [mutateAsync],
  )

  return { run, busyChatId }
}
