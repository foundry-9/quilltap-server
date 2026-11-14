'use client'

/**
 * The Salon's name chips for absent characters.
 *
 * One read per chat (`?action=absent-mentions`), shared through TanStack Query
 * by every message row, every collapsed announcement and the chat sidebar's
 * "Concepts Named" card. A row asks only for the mentions that first appear in
 * it; the sidebar takes the whole list. Realtime rides the `chats` topic (a
 * new message is the only thing that can name someone), so the interval is
 * only the offline fallback.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'
import type { AbsentMentionChip } from '@/components/chat/MentionChip'

/** Cadence of the offline fallback poll, in ms. */
const FALLBACK_POLL_MS = 60_000

/** One absent character's first mention in the chat, as the server returns it. */
export type ChatAbsentMention = AbsentMentionChip & {
  messageId: string
  /** URL of the character's current portrait, if they have one. */
  avatarUrl?: string | null
}

interface AbsentMentionsResponse {
  mentions: ChatAbsentMention[]
}

const NONE: AbsentMentionChip[] = []
const NO_MENTIONS: ChatAbsentMention[] = []

/** Every absent character the chat names, at their first mention, in message order. */
export function useChatAbsentMentions(chatId: string | undefined): ChatAbsentMention[] {
  const refetchInterval = useRealtimeRefetchInterval(FALLBACK_POLL_MS)
  const { data } = useQuery({
    queryKey: queryKeys.chats.absentMentions(chatId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<AbsentMentionsResponse>(`/api/v1/chats/${chatId}?action=absent-mentions`, { signal }),
    enabled: !!chatId,
    refetchInterval,
    staleTime: 30_000,
  })
  return data?.mentions ?? NO_MENTIONS
}

/** The absent-character mentions that first appear in `messageId`. */
export function useAbsentMentions(chatId: string | undefined, messageId: string): AbsentMentionChip[] {
  const mentions = useChatAbsentMentions(chatId)
  return useMemo(() => {
    const mine = mentions.filter(m => m.messageId === messageId)
    return mine.length > 0 ? mine : NONE
  }, [mentions, messageId])
}
