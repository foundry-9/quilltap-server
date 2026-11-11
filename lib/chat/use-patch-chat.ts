'use client'

/**
 * `usePatchChat(chatId)` — the component-side way to write a chat row.
 *
 * Wraps {@link putChatUpdate} (`patch-chat.ts`) in one mutation: on success
 * it toasts (when given a line) and runs `onSaved`; on failure it toasts the
 * server's sentence and resolves `false` so the caller can roll its control
 * back. Either way it refreshes every cached read of the chat — the detail,
 * the chat lists (a title or project shows there) and the project the
 * wardrobe folds in (a move changes the project tier).
 *
 * The Salon keeps the open chat in its own state (spec 6), so there is no
 * cached detail to edit optimistically here; callers that show a pending
 * value hold it themselves and roll it back on `false`.
 *
 * @module lib/chat/use-patch-chat
 */

import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { putChatUpdate, type ChatPatch, type ChatUpdateRequest } from './patch-chat'

export interface PatchChatMessages {
  /** Toast on success; omit for a silent save. */
  success?: string
  /** Toast fallback when the server gives no sentence of its own. */
  failure: string
}

export interface UsePatchChatResult {
  /** Write `{ chat: updates }`. Resolves `true` on success. */
  patch: (updates: ChatPatch, messages: PatchChatMessages) => Promise<boolean>
  /** Write a whole update request (top-level fields). Resolves `true` on success. */
  update: (request: ChatUpdateRequest, messages: PatchChatMessages) => Promise<boolean>
  /** Whether a write touching `field` (top-level or under `chat`) is in flight. */
  isSaving: (field: string) => boolean
}

function touches(request: ChatUpdateRequest | undefined, field: string): boolean {
  if (!request) return false
  if (field in request) return true
  return !!request.chat && field in request.chat
}

export function usePatchChat(chatId: string, options?: { onSaved?: () => void }): UsePatchChatResult {
  const queryClient = useQueryClient()
  const onSaved = options?.onSaved

  const mutation = useMutation({
    mutationFn: (request: ChatUpdateRequest) => putChatUpdate(chatId, request),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.detail(chatId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.lists })
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.project(chatId) })
    },
  })
  const { mutateAsync, isPending, variables } = mutation

  const update = useCallback(
    async (request: ChatUpdateRequest, messages: PatchChatMessages): Promise<boolean> => {
      try {
        await mutateAsync(request)
        if (messages.success) showSuccessToast(messages.success)
        onSaved?.()
        return true
      } catch (error) {
        const message = apiErrorMessage(error, messages.failure)
        console.error('[usePatchChat] chat update failed', {
          chatId,
          fields: Object.keys(request.chat ?? request),
          error: message,
        })
        showErrorToast(message)
        return false
      }
    },
    [mutateAsync, onSaved, chatId],
  )

  const patch = useCallback(
    (updates: ChatPatch, messages: PatchChatMessages) => update({ chat: updates }, messages),
    [update],
  )

  const isSaving = useCallback(
    (field: string) => isPending && touches(variables, field),
    [isPending, variables],
  )

  return { patch, update, isSaving }
}
