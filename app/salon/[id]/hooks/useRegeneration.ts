'use client'

/**
 * Regeneration — the live re-roll of a line that has already been spoken.
 *
 * A regeneration used to be a silent blocking POST: the operator pressed the
 * refresh icon, nothing whatever changed on screen, and some seconds later the
 * transcript quietly held a different line. There was no way to tell a slow
 * model from a dead one, and nothing stopped a second press — or a fresh
 * message typed into the composer — from landing on top of a turn already in
 * flight.
 *
 * So a regeneration now narrates itself, in the same three places a first-time
 * turn does:
 *
 *   1. the composer is shut for the duration (see `isRegenerating`),
 *   2. the line being replaced dims and wears a "Regenerating..." plate, which
 *      gives way to the new prose the instant the first token lands,
 *   3. the status strip above the composer carries the stage, updated as the
 *      server reports it — exactly as it does the first time round.
 *
 * The transport is the swipe endpoint's `stream=1` variant. `content` events
 * are deltas (append); `reasoning` is cumulative (replace) — the same contract
 * the send path uses, deliberately, so the two read alike.
 *
 * @module app/salon/[id]/hooks/useRegeneration
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { parseSSEData, type ResponseStatus } from './useSSEStreaming'

/** What the message row needs to render a line that is being re-rolled. */
export interface RegenerationState {
  /** The message whose place the new line will take. */
  messageId: string
  /**
   * `preparing` while the server is still gathering context and waiting on the
   * model — the plate is up and the old line shows through, dimmed. `streaming`
   * from the first token on, when `content` is worth reading and replaces it.
   */
  stage: 'preparing' | 'streaming'
  /** The new line so far. */
  content: string
  /** Live cumulative reasoning. DISPLAY ONLY, and only if the chat shows it. */
  reasoning: string
}

export interface RegenerationController {
  /** The in-flight regeneration, or null when none is running. */
  regeneration: RegenerationState | null
  /** The stage line for the strip above the composer. */
  regenerationStatus: ResponseStatus | null
  /** Whether a regeneration holds the floor (shuts the composer). */
  isRegenerating: boolean
  /** Start one. A no-op while another is already running. */
  regenerate: (
    messageId: string,
    fetchChat: () => Promise<void>,
    /**
     * Put the freshly-made variant on screen once the refetch lands. Without
     * it the operator would watch a line arrive and then be shown a different
     * one, because reconciliation carries their previous swipe selection.
     */
    selectSwipeVariant?: (messageId: string) => void,
  ) => Promise<void>
}

export function useRegeneration(): RegenerationController {
  const [regeneration, setRegeneration] = useState<RegenerationState | null>(null)
  const [regenerationStatus, setRegenerationStatus] = useState<ResponseStatus | null>(null)

  // One at a time. Read through a ref as well as state so a second press in the
  // same tick — before React has re-rendered the disabled button — still loses.
  const inFlightRef = useRef(false)

  // Tokens can arrive faster than React can paint them. Buffer in a ref and
  // flush at most once per frame, the same treatment the send path's stream
  // gets (an uncoalesced burst has tripped React's update-depth limit there).
  const contentBufferRef = useRef('')
  const contentRafRef = useRef<number | null>(null)

  const cancelPendingFlush = useCallback(() => {
    if (contentRafRef.current !== null) {
      cancelAnimationFrame(contentRafRef.current)
      contentRafRef.current = null
    }
  }, [])

  useEffect(() => cancelPendingFlush, [cancelPendingFlush])

  const scheduleContent = useCallback((content: string) => {
    contentBufferRef.current = content
    if (contentRafRef.current !== null) return
    contentRafRef.current = requestAnimationFrame(() => {
      contentRafRef.current = null
      setRegeneration(prev =>
        prev ? { ...prev, stage: 'streaming', content: contentBufferRef.current } : prev
      )
    })
  }, [])

  const regenerate = useCallback(async (
    messageId: string,
    fetchChat: () => Promise<void>,
    selectSwipeVariant?: (messageId: string) => void,
  ) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    cancelPendingFlush()
    contentBufferRef.current = ''
    setRegeneration({ messageId, stage: 'preparing', content: '', reasoning: '' })
    setRegenerationStatus({ stage: 'regenerating', message: 'Regenerating...' })

    try {
      const res = await fetch(`/api/v1/messages/${messageId}?action=swipe&stream=1`, {
        method: 'POST',
      })

      if (!res.ok) {
        // The stream never opened, so the body is an ordinary JSON error.
        const info = await res.json().catch(() => null)
        throw new Error(info?.error || 'Failed to generate alternative response')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('Failed to generate alternative response')

      const decoder = new TextDecoder()
      let buffered = ''
      let fullContent = ''
      let streamError: string | null = null
      let newSwipeId: string | null = null

      // SSE frames can be split across network chunks; keep the tail until it
      // is terminated rather than dropping a half-arrived line.
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffered += decoder.decode(value, { stream: true })
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = parseSSEData(line.slice(6))
          if (!data) continue

          if (data.status) {
            setRegenerationStatus(data.status)
          }
          if (data.content) {
            fullContent += data.content
            scheduleContent(fullContent)
          }
          if (typeof data.reasoning === 'string') {
            const reasoning = data.reasoning
            setRegeneration(prev => (prev ? { ...prev, reasoning } : prev))
          }
          if (data.error) {
            streamError = data.details ? `${data.error}: ${data.details}` : data.error
          }
          if (data.done) {
            // Show the finished line rather than whatever the last frame left,
            // so the hand-off to the persisted swipe is not a visible twitch.
            cancelPendingFlush()
            const posted = (data as { message?: { id?: string; content?: string } }).message
            newSwipeId = posted?.id ?? null
            const finalContent = posted?.content
            setRegeneration(prev =>
              prev
                ? { ...prev, stage: 'streaming', content: finalContent ?? fullContent }
                : prev
            )
          }
        }
      }

      if (streamError) throw new Error(streamError)

      // Hold the live text in place until the authoritative transcript is in
      // hand; clearing first would flash the line we just replaced.
      await fetchChat()
      if (newSwipeId) selectSwipeVariant?.(newSwipeId)
      notifyQueueChange()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to generate alternative response')
    } finally {
      cancelPendingFlush()
      contentBufferRef.current = ''
      inFlightRef.current = false
      setRegeneration(null)
      setRegenerationStatus(null)
    }
  }, [cancelPendingFlush, scheduleContent])

  return {
    regeneration,
    regenerationStatus,
    isRegenerating: regeneration !== null,
    regenerate,
  }
}
