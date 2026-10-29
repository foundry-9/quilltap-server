'use client'

/**
 * Immediate runs for the composer's `/` commands — a tool that declares no
 * parameters has nothing to complete, so picking it runs it at once through the
 * same routes the dialogs use. A private run is never reachable from here; the
 * dialog is the place for that.
 *
 * @module components/chat/useSlashCommandRunner
 */

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { SlashCustomToolRef } from './lexical/slash-commands/context'

export interface SlashCommandRunnerOptions {
  chatId: string
  /** The character a built-in runs as — Run Tool's default, the first active character seat. */
  defaultCharacterId: string | null
  /** Called after a successful run so the Salon can refetch the chat. */
  onRan?: () => void
}

export function useSlashCommandRunner({ chatId, defaultCharacterId, onRan }: SlashCommandRunnerOptions) {
  const queryClient = useQueryClient()

  const runBuiltInNow = useCallback(
    async (toolId: string) => {
      try {
        const res = await fetch(`/api/v1/chats/${chatId}?action=run-tool`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolName: toolId,
            arguments: {},
            characterId: defaultCharacterId || undefined,
            private: false,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.success) {
          showErrorToast(data.error || data.message || `${toolId} could not be run`)
          return
        }
        showSuccessToast(`Prospero has run ${toolId}.`)
        onRan?.()
      } catch (err) {
        showErrorToast(err instanceof Error ? err.message : `${toolId} could not be run`)
      }
    },
    [chatId, defaultCharacterId, onRan],
  )

  const runCustomNow = useCallback(
    async (tool: SlashCustomToolRef) => {
      try {
        await apiFetch(`/api/v1/chats/${chatId}/custom-tools?action=run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // `private` omitted: the definition's own default visibility decides.
          body: JSON.stringify({ tool: tool.name, parameters: null, asCharacterId: tool.asCharacterId }),
        })
        showSuccessToast(`Pascal has settled ${tool.name}.`)
        queryClient.invalidateQueries({ queryKey: queryKeys.chats.detail(chatId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.customTools.byChat(chatId) })
        onRan?.()
      } catch (err) {
        showErrorToast(apiErrorMessage(err, `${tool.name} could not be run`))
      }
    },
    [chatId, onRan, queryClient],
  )

  return { runBuiltInNow, runCustomNow }
}
