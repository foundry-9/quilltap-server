/**
 * Fold-window helpers shared by the two fold-grain extraction passes
 * (`fold-other-pass.ts`, `fold-episode-pass.ts`).
 *
 * Both passes read a stretch of conversation the fold (or a catch-up) hands
 * them, and both keep a per-chat watermark of the last message they covered.
 * Three rules are the same for both and live here so they cannot drift:
 *
 * - **Eligibility.** Only a spoken USER/ASSISTANT line from a seat, with text,
 *   is read. Staff whispers, tool rows and empty messages are not.
 * - **Watermark.** A window is cut to the messages strictly after the pass's
 *   watermark, ordered by the chat's own message order. A watermark that names
 *   a message no longer in the chat is treated as absent.
 * - **Slicing.** A window wider than the pass's prompt bound is processed in
 *   consecutive slices, oldest first, and the watermark advances only past a
 *   slice that was read (bugs 206, 207). Nothing is marked covered unread.
 *
 * @module memory/fold-window
 */

import type { MessageEvent } from '@/lib/schemas/types'

/** A message that carries conversation: a spoken USER/ASSISTANT line from a seat, not staff or tool output. */
export function isFoldEligibleMessage(m: MessageEvent): boolean {
  if (m.type !== 'message') return false
  if (m.role !== 'USER' && m.role !== 'ASSISTANT') return false
  if (m.systemSender) return false
  if (!m.participantId) return false
  return typeof m.content === 'string' && m.content.trim().length > 0
}

/**
 * Messages strictly after the watermark. A watermark that names a message no
 * longer in the chat (deleted) is treated as absent — better to re-read the
 * tail once than to go blind forever.
 */
export function messagesPastWatermark<T extends { id: string }>(
  allMessages: ReadonlyArray<T>,
  watermarkMessageId: string | null | undefined,
): T[] {
  if (!watermarkMessageId) return [...allMessages]
  const idx = allMessages.findIndex(m => m.id === watermarkMessageId)
  if (idx === -1) return [...allMessages]
  return allMessages.slice(idx + 1)
}

/**
 * Cut a window (any subset of the chat's messages) to what lies strictly after
 * the watermark, using `allMessages` (the chat's messages, chronological) for
 * order. Returns the window unchanged when there is no watermark or the
 * watermark names a message the chat no longer has.
 */
export function windowPastWatermark<T extends { id: string }>(
  window: ReadonlyArray<T>,
  allMessages: ReadonlyArray<{ id: string }>,
  watermarkMessageId: string | null | undefined,
): { window: T[]; applied: boolean } {
  if (!watermarkMessageId) return { window: [...window], applied: false }
  const watermarkIdx = allMessages.findIndex(m => m.id === watermarkMessageId)
  if (watermarkIdx === -1) return { window: [...window], applied: false }
  const order = new Map(allMessages.map((m, i) => [m.id, i]))
  return {
    window: window.filter(m => (order.get(m.id) ?? Infinity) > watermarkIdx),
    applied: true,
  }
}

/** One slice of a fold window, and the message the watermark may advance to once it is read. */
export interface FoldWindowSlice<T> {
  messages: T[]
  coverThroughMessageId: string | null
}

/**
 * Split eligible messages into consecutive slices of at most `maxPerSlice`,
 * oldest first. Every slice but the last covers through its own last message;
 * the last covers through `finalCoverThroughId` (the end of the untrimmed
 * window, which may be an ineligible row) when given. Messages between two
 * slices are ineligible by construction, so covering through a slice's last
 * eligible message skips nothing a pass would have read.
 */
export function sliceFoldWindow<T extends { id: string }>(
  eligible: ReadonlyArray<T>,
  maxPerSlice: number,
  finalCoverThroughId: string | null,
): Array<FoldWindowSlice<T>> {
  const size = Math.max(1, Math.floor(maxPerSlice))
  const slices: Array<FoldWindowSlice<T>> = []
  for (let start = 0; start < eligible.length; start += size) {
    const messages = eligible.slice(start, start + size)
    const isLast = start + size >= eligible.length
    slices.push({
      messages,
      coverThroughMessageId: isLast
        ? (finalCoverThroughId ?? messages[messages.length - 1]?.id ?? null)
        : (messages[messages.length - 1]?.id ?? null),
    })
  }
  return slices
}
