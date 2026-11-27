'use client'

/**
 * The Salon's mention chips: absent characters (`'absent'`, name chips) and
 * Atlas entries of the chat's cast view (`'atlas'`, thing chips), each at its
 * first mention — a spoken line, or for the Atlas also the Host's scenario row.
 *
 * One read per chat and kind (`?action=absent-mentions` /
 * `?action=atlas-mentions`), shared through TanStack Query by every message
 * row, every collapsed announcement and the chat sidebar's "Concepts Named"
 * card. A row asks only for the mentions that first appear in it
 * ({@link useChatMentions}); the sidebar takes the whole list
 * ({@link useChatMentionList}). Realtime rides the `chats` topic (a new
 * message — the only thing that can name someone) and, for the Atlas, the
 * `atlas` topic (an edited entry), so the interval is only the offline fallback.
 *
 * @module hooks/useChatMentions
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'
import type { AbsentMentionChip, AtlasMentionChip } from '@/components/chat/MentionChip'
import type { AtlasMention } from '@/lib/schemas/atlas.types'

/** Cadence of the offline fallback poll, in ms. */
const FALLBACK_POLL_MS = 60_000

/** One absent character's first mention in the chat, as the server returns it. */
export type ChatAbsentMention = AbsentMentionChip & {
  messageId: string
  /** URL of the character's current portrait, if they have one. */
  avatarUrl?: string | null
}

export type MentionKind = 'absent' | 'atlas'

/** What the server lists for each kind. */
interface MentionRows {
  absent: ChatAbsentMention
  atlas: AtlasMention
}

/** The chip a message row draws for each kind. */
interface MentionChips {
  absent: AbsentMentionChip
  atlas: AtlasMentionChip
}

const SPECS: { [K in MentionKind]: { action: string; key: (chatId: string) => readonly unknown[]; toChip: (row: MentionRows[K]) => MentionChips[K] } } = {
  absent: {
    action: 'absent-mentions',
    key: queryKeys.chats.absentMentions,
    toChip: (row) => row,
  },
  atlas: {
    action: 'atlas-mentions',
    key: queryKeys.chats.atlasMentions,
    toChip: (row) => ({ kind: 'thing', entryId: row.entryId, text: row.text, card: row.card }),
  },
}

const NONE: never[] = []

/** Every mention of `kind` the chat makes, at its first mention, in message order. */
export function useChatMentionList<K extends MentionKind>(kind: K, chatId: string | undefined): MentionRows[K][] {
  const refetchInterval = useRealtimeRefetchInterval(FALLBACK_POLL_MS)
  const spec = SPECS[kind]
  const { data } = useQuery({
    queryKey: spec.key(chatId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<{ mentions: MentionRows[K][] }>(`/api/v1/chats/${chatId}?action=${spec.action}`, { signal }),
    enabled: !!chatId,
    refetchInterval,
    staleTime: 30_000,
  })
  return data?.mentions ?? NONE
}

/** The mentions of `kind` that first appear in `messageId`, as chips. */
export function useChatMentions<K extends MentionKind>(
  kind: K,
  chatId: string | undefined,
  messageId: string,
): MentionChips[K][] {
  const mentions = useChatMentionList(kind, chatId)
  const toChip = SPECS[kind].toChip as (row: MentionRows[K]) => MentionChips[K]
  return useMemo(() => {
    const mine = mentions.filter((m) => m.messageId === messageId).map(toChip)
    return mine.length > 0 ? mine : NONE
  }, [mentions, messageId, toChip])
}
