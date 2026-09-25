'use client'

/**
 * "Try uncensored" on pictures — the generate_image redraw and the Lantern's
 * backdrop. (The text retry rides the regeneration transport instead; see
 * `useRegeneration`'s `url` option.)
 *
 * Both are one POST to `?action=retry-image-uncensored`. A 409 is the Concierge
 * declining — Locked, or nobody to send it to — and is said in words; the
 * picture itself arrives through the ordinary refetch, the backdrop through the
 * ordinary background poll.
 *
 * @module app/salon/[id]/hooks/useConciergeRetry
 */

import { useCallback, useMemo, useRef } from 'react'
import { showErrorToast, showInfoToast, showSuccessToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { describeRetryRefusal } from '../concierge-retry'

export interface ConciergeRetryController {
  retryPicture: (toolMessageId: string) => Promise<void>
  retryBackground: () => Promise<void>
}

async function postRetry(chatId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`/api/v1/chats/${chatId}?action=retry-image-uncensored`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function errorFrom(res: Response, fallback: string): Promise<string> {
  const info = await res.json().catch(() => null)
  const refusal = res.status === 409 ? describeRetryRefusal(info?.error) : null
  return refusal || info?.error || fallback
}

export function useConciergeRetry(
  chatId: string,
  fetchChat: () => Promise<void>,
  startBackgroundPolling: () => void,
): ConciergeRetryController {
  // One redraw per picture at a time; a second press while it paints is lost.
  const inFlight = useRef(new Set<string>())

  const retryPicture = useCallback(async (toolMessageId: string) => {
    if (inFlight.current.has(toolMessageId)) return
    inFlight.current.add(toolMessageId)
    showInfoToast('The Concierge has taken the commission across the street…')
    try {
      const res = await postRetry(chatId, { toolMessageId })
      if (!res.ok) {
        throw new Error(await errorFrom(res, 'The uncensored desk could not produce the picture'))
      }
      await fetchChat()
      showSuccessToast('The uncensored desk has delivered the picture')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'The uncensored desk could not produce the picture')
    } finally {
      inFlight.current.delete(toolMessageId)
    }
  }, [chatId, fetchChat])

  const retryBackground = useCallback(async () => {
    try {
      const res = await postRetry(chatId, { kind: 'background' })
      if (!res.ok) {
        throw new Error(await errorFrom(res, 'Failed to queue the backdrop'))
      }
      showSuccessToast('Backdrop commissioned from the uncensored desk')
      notifyQueueChange()
      startBackgroundPolling()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to queue the backdrop')
    }
  }, [chatId, startBackgroundPolling])

  // Stable identity: the Salon memoises its retry handlers on this, and every
  // transcript row compares those handlers by identity.
  return useMemo(() => ({ retryPicture, retryBackground }), [retryPicture, retryBackground])
}
