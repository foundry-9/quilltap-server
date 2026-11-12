'use client'

/**
 * The Salon's thing chips: Atlas entries of the chat's cast view, at their
 * first mention (a spoken line or the Host's scenario row).
 *
 * One read per chat (`?action=atlas-mentions`), shared through TanStack Query
 * by every message row, every collapsed announcement and the chat sidebar's
 * "Things named" card. A row asks only for the mentions that first appear in
 * it; the sidebar takes the whole list. Realtime rides the `chats` topic (a
 * new message) and the `atlas` topic (an edited entry), so the interval is
 * only the offline fallback.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'
import type { AtlasMentionChip } from '@/components/chat/MentionChip'
import type { AtlasMention } from '@/lib/schemas/atlas.types'

/** Cadence of the offline fallback poll, in ms. */
const FALLBACK_POLL_MS = 60_000

const NONE: AtlasMentionChip[] = []
const NO_MENTIONS: AtlasMention[] = []

/** Every Atlas entry the chat names, at its first mention, in message order. */
export function useChatAtlasMentions(chatId: string | undefined): AtlasMention[] {
  const refetchInterval = useRealtimeRefetchInterval(FALLBACK_POLL_MS)
  const { data } = useQuery({
    queryKey: queryKeys.chats.atlasMentions(chatId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<{ mentions: AtlasMention[] }>(`/api/v1/chats/${chatId}?action=atlas-mentions`, { signal }),
    enabled: !!chatId,
    refetchInterval,
    staleTime: 30_000,
  })
  return data?.mentions ?? NO_MENTIONS
}

/** The Atlas mentions that first appear in `messageId`. */
export function useAtlasMentions(chatId: string | undefined, messageId: string): AtlasMentionChip[] {
  const mentions = useChatAtlasMentions(chatId)
  return useMemo(() => {
    const mine: AtlasMentionChip[] = mentions
      .filter(m => m.messageId === messageId)
      .map(m => ({ kind: 'thing' as const, entryId: m.entryId, text: m.text, card: m.card }))
    return mine.length > 0 ? mine : NONE
  }, [mentions, messageId])
}
