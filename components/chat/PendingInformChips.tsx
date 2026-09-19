'use client'

/**
 * PendingInformChips — the notes still waiting in the wings.
 *
 * One chip per pending Inform batch, sitting in the composer just above the
 * form: *Informing Alice, Bob before their next turn*, with a × that cancels
 * the batch and a hover title carrying the passage's first line.
 *
 * Realtime rides the existing `chats` topic. Posting an inform inserts the Host
 * record, consuming one rides the assistant-message insert, and the cancel
 * handler publishes `chats` explicitly — so `queryKeys.chats.informs(id)` on
 * that row of `lib/realtime/topic-map.ts` is the whole refresh story. The
 * interval below is only the offline fallback, gated by
 * `useRealtimeRefetchInterval` so it stops the moment the socket is up.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

/** Cadence of the offline fallback poll, in ms. */
const FALLBACK_POLL_MS = 60_000

export interface PendingInformBatch {
  batchId: string
  contentMarkdown: string
  createdAt: string
  recordMessageId: string | null
  /** CHAT PARTICIPANT ids still awaiting delivery. */
  pendingParticipantIds: string[]
}

export interface PendingInformsResponse {
  batches: PendingInformBatch[]
}

interface PendingInformChipsProps {
  chatId: string
  /** Seat display names, keyed by chat participant id. */
  participantNames: Record<string, string>
}

/** The first non-blank line of the passage, for the chip's hover title. */
function firstLine(markdown: string): string {
  const line = markdown.split('\n').find((l) => l.trim().length > 0)
  return (line ?? '').trim()
}

export function PendingInformChips({ chatId, participantNames }: Readonly<PendingInformChipsProps>) {
  const queryClient = useQueryClient()
  const refetchInterval = useRealtimeRefetchInterval(FALLBACK_POLL_MS)

  const { data } = useQuery({
    queryKey: queryKeys.chats.informs(chatId),
    queryFn: ({ signal }) =>
      apiFetch<PendingInformsResponse>(`/api/v1/chats/${chatId}?action=informs`, { signal }),
    enabled: Boolean(chatId),
    refetchInterval,
  })

  const cancel = useMutation({
    mutationFn: (batchId: string) =>
      apiFetch<{ removed: number; recordDeleted: boolean }>(
        `/api/v1/chats/${chatId}?action=cancel-inform`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId }),
        },
      ),
    onSuccess: () => {
      showSuccessToast('The note has been withdrawn')
    },
    onError: (error) => {
      showErrorToast(apiErrorMessage(error, 'Failed to withdraw the inform'))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.informs(chatId) })
    },
  })

  const batches = data?.batches ?? []
  if (batches.length === 0) return null

  return (
    <div className="qt-chat-attachment-list mb-2">
      {batches.map((batch) => {
        const names = batch.pendingParticipantIds
          .map((id) => participantNames[id])
          .filter((name): name is string => Boolean(name))
        // A batch whose seats have all left the chat has nothing left to name.
        if (names.length === 0) return null
        const label = `Informing ${names.join(', ')} before their next turn`
        return (
          <div
            key={batch.batchId}
            className="qt-chat-tool-result-chip"
            title={firstLine(batch.contentMarkdown)}
          >
            <Icon name="info" className="qt-chat-attachment-chip-icon qt-chat-attachment-chip-icon-info" />
            <span className="text-foreground max-w-[280px] truncate">{label}</span>
            <button
              type="button"
              onClick={() => cancel.mutate(batch.batchId)}
              disabled={cancel.isPending}
              className="qt-chat-attachment-chip-remove"
              title="Withdraw this inform"
              aria-label={`Withdraw the inform for ${names.join(', ')}`}
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default PendingInformChips
