'use client'

/**
 * The Salon's name chips for absent characters.
 *
 * One read per chat (`?action=absent-mentions`), shared by every message row
 * through TanStack Query; each row asks only for the mentions that first
 * appear in it. Realtime rides the `chats` topic (a new message is the only
 * thing that can name someone), so the interval is only the offline fallback.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'
import type { AbsentMentionChip } from '@/components/chat/MentionChip'

/** Cadence of the offline fallback poll, in ms. */
const FALLBACK_POLL_MS = 60_000

interface AbsentMentionsResponse {
  mentions: Array<AbsentMentionChip & { messageId: string }>
}

const NONE: AbsentMentionChip[] = []

/** The absent-character mentions that first appear in `messageId`. */
export function useAbsentMentions(chatId: string | undefined, messageId: string): AbsentMentionChip[] {
  const refetchInterval = useRealtimeRefetchInterval(FALLBACK_POLL_MS)
  const { data } = useQuery({
    queryKey: queryKeys.chats.absentMentions(chatId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<AbsentMentionsResponse>(`/api/v1/chats/${chatId}?action=absent-mentions`, { signal }),
    enabled: !!chatId,
    refetchInterval,
    staleTime: 30_000,
  })
  return useMemo(() => {
    const mine = data?.mentions.filter(m => m.messageId === messageId) ?? []
    return mine.length > 0 ? mine : NONE
  }, [data, messageId])
}
