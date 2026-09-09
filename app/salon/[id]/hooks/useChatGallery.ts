'use client'

/**
 * useChatGallery — the client's one view of every image in a conversation.
 *
 * One query answers two questions: the grid the Gallery modal draws, and the
 * `Gallery (N)` count beside the button that opens it. They were two answers
 * once, and the count read an API action that did not exist, so the button
 * gated on it never appeared at all (bug 129). One read, one number.
 *
 * Realtime rides the existing `chats` topic — the story-background and avatar
 * jobs already publish `{topic:'chats', id: chatId}` when they finish, and
 * `queryKeys.chats.gallery(id)` sits on that row of `lib/realtime/topic-map.ts`.
 * The interval below is only the offline fallback, gated by
 * `useRealtimeRefetchInterval` so it stops the moment the socket is up.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'
import type { ChatGalleryEntry, ChatGallerySource } from '@/lib/photos/chat-gallery'

export type { ChatGalleryEntry, ChatGallerySource }

export interface ChatGalleryResponse {
  entries: ChatGalleryEntry[]
  counts: Record<ChatGallerySource, number>
  total: number
}

const EMPTY_COUNTS: Record<ChatGallerySource, number> = {
  'story-background': 0,
  avatar: 0,
  portrait: 0,
  generated: 0,
  attachment: 0,
  kept: 0,
  inline: 0,
}

/** Cadence of the offline fallback poll, in ms. */
const FALLBACK_POLL_MS = 60_000

/**
 * Read the chat's gallery.
 *
 * @param chatId The conversation. A falsy id disables the query.
 * @param options.enabled Defer the read (e.g. until the modal is opened).
 */
export function useChatGallery(
  chatId: string | null | undefined,
  options: { enabled?: boolean } = {},
) {
  const queryClient = useQueryClient()
  const enabled = !!chatId && (options.enabled ?? true)
  const key = queryKeys.chats.gallery(chatId ?? '')
  const refetchInterval = useRealtimeRefetchInterval(FALLBACK_POLL_MS)

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      apiFetch<ChatGalleryResponse>(`/api/v1/chats/${chatId}?action=gallery`, { signal }),
    enabled,
    refetchInterval,
  })

  const invalidate = useCallback(() => {
    if (!chatId) return
    void queryClient.invalidateQueries({ queryKey: queryKeys.chats.gallery(chatId) })
  }, [queryClient, chatId])

  return {
    entries: query.data?.entries ?? [],
    counts: query.data?.counts ?? EMPTY_COUNTS,
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    /** Re-read after something this client did put a new image in the chat. */
    invalidate,
  }
}
