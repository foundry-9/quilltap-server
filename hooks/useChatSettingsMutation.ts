'use client'

/**
 * The one writer of the chat-settings row (`PUT /api/v1/settings/chat`).
 *
 * Every settings card, the Avatar Display provider and the setup wizard write
 * through here. A save:
 *
 *   1. applies the patch to the cached row at once (optimistic), so every
 *      reader of `queryKeys.settings.chat` — the cards, the composer, the
 *      message renderer — shows it without waiting;
 *   2. on success, writes the server's row into the cache (no refetch);
 *   3. on failure, rolls the cached row back, re-reads it, and toasts the
 *      server's sentence — a failed save is never console-only.
 *
 * Nested objects are sent whole: callers merge their change into the current
 * nested value (`readChatSettings`) before saving, because the route replaces
 * a nested key rather than deep-merging it.
 *
 * Lives in top-level `hooks/` beside `useChatSettingsQuery` so non-settings
 * bundles can use it without pulling in the settings UI.
 *
 * @module hooks/useChatSettingsMutation
 */

import { useCallback } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast } from '@/lib/toast'
import type { ChatSettings } from '@/components/settings/chat-settings/types'

/** A partial settings write: top-level keys, each sent whole. */
export type ChatSettingsPatch = Partial<ChatSettings>

/** The plain request, for non-React callers (the setup wizard). Throws `ApiFetchError`. */
export function putChatSettings(patch: ChatSettingsPatch, signal?: AbortSignal): Promise<ChatSettings> {
  return apiFetch<ChatSettings>('/api/v1/settings/chat', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    signal,
  })
}

/** The cached row as of now — read at call time, so a merge sees earlier optimistic writes. */
export function readChatSettings(queryClient: QueryClient): ChatSettings | undefined {
  return queryClient.getQueryData<ChatSettings>(queryKeys.settings.chat)
}

interface SaveOptions {
  /** The toast's fallback when the server gives no sentence of its own. */
  failure?: string
}

interface Variables {
  patch: ChatSettingsPatch
  failure: string
}

const DEFAULT_FAILURE = 'The settings could not be saved'

export function useChatSettingsMutation(options?: { onSaved?: (settings: ChatSettings) => void }) {
  const queryClient = useQueryClient()
  const onSaved = options?.onSaved

  const mutation = useMutation({
    mutationFn: ({ patch }: Variables) => putChatSettings(patch),
    onMutate: async ({ patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings.chat })
      const previous = readChatSettings(queryClient)
      if (previous) {
        queryClient.setQueryData<ChatSettings>(queryKeys.settings.chat, { ...previous, ...patch })
      }
      return { previous }
    },
    onError: (error, { patch, failure }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.settings.chat, context.previous)
      }
      // Another save may have landed meanwhile; the server's row is the truth.
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.chat })
      const message = apiErrorMessage(error, failure)
      console.error('[useChatSettingsMutation] settings save failed', { keys: Object.keys(patch), error: message })
      showErrorToast(message)
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings.chat, settings)
      onSaved?.(settings)
    },
  })

  const { mutateAsync } = mutation

  /** Save `patch`. Resolves `true` on success; a failure is already toasted and rolled back. */
  const save = useCallback(
    async (patch: ChatSettingsPatch, saveOptions?: SaveOptions): Promise<boolean> => {
      try {
        await mutateAsync({ patch, failure: saveOptions?.failure ?? DEFAULT_FAILURE })
        return true
      } catch {
        return false
      }
    },
    [mutateAsync],
  )

  return { save, saving: mutation.isPending, error: mutation.error }
}
