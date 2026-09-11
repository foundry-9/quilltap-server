/**
 * Transcript reconciliation — folding an authoritative read into what the tab
 * is already showing.
 *
 * Before the Salon's transcript became a subscribed read, `fetchChat` ran twice
 * in the life of a conversation turn and simply replaced the array: whatever
 * came back from the server *was* the display, swipe selection reset to the
 * newest variant, and any optimistic bubble vanished because the whole array
 * did. That is no longer safe. A realtime `{topic:'chats', id}` hint can land
 * at any moment — mid-stream, mid-swipe, while the operator is reading history
 * — so a read has to be merged rather than swapped in.
 *
 * Three properties this module exists to hold:
 *
 *   1. **The read is the authority.** Persisted rows win. A provisional bubble
 *      is dropped the instant the read carries a row for the same turn.
 *   2. **The operator's swipe selection survives.** Selection is remembered by
 *      the *id* of the chosen variant, not its index, so a regenerate that
 *      appends a variant (or a delete that removes one) doesn't yank the view
 *      onto a different reply.
 *   3. **Unchanged rows keep their object identity.** A refetch that changes
 *      nothing returns the very array it was given, so React bails out of the
 *      render and the virtualizer never remeasures — which is what keeps the
 *      scroll position still under a hint storm.
 *
 * Pure and synchronous: no fetching, no React. See
 * `docs/developer/features/complete/salon-realtime-transcript.md`.
 *
 * @module app/salon/[id]/hooks/transcript-reconcile
 */

import type { Message } from '../types'
import type { SwipeState } from './useChatData'

/**
 * Id prefix marking a bubble the client invented for a turn still in flight —
 * the optimistic user line and its pending tool rows. The server never mints
 * one, which is what makes the prefix a reliable seam.
 */
export const PROVISIONAL_ID_PREFIX = 'temp-'

/** Whether a message is a client-side provisional bubble rather than a stored row. */
export function isProvisionalMessage(message: Message): boolean {
  return message.id.startsWith(PROVISIONAL_ID_PREFIX)
}

export interface ReconciledTranscript {
  /** What to render: authoritative rows plus any provisional bubble not yet covered. */
  messages: Message[]
  /** Swipe groups, with the operator's selection carried across. */
  swipeStates: Record<string, SwipeState>
}

/**
 * Are these two rows the same row, field for field?
 *
 * Used only to decide whether the previous object can be reused, so a false
 * negative costs a re-render and a false positive would show stale text. JSON
 * comparison is the conservative choice: it notices every field the renderer
 * reads, including ones added later that a hand-written comparison would miss.
 */
function sameRow(a: Message, b: Message): boolean {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Order the display rows the way the server does.
 *
 * `createdAt` first, then the row's position in the server's own response as
 * the tiebreak. Near-simultaneous staff messages genuinely tie — the incident
 * chat has pairs 41 ms and 5 ms apart, and a batch written in one call shares a
 * timestamp outright — so without the second key the client would be free to
 * disagree with the read it just performed, and to disagree differently on the
 * next one.
 */
function sortForDisplay(messages: Message[], serverOrder: Map<string, number>): Message[] {
  return [...messages].sort((a, b) => {
    const byTime = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    if (byTime !== 0) return byTime
    return (serverOrder.get(a.id) ?? 0) - (serverOrder.get(b.id) ?? 0)
  })
}

/**
 * Collapse swipe groups, preserving the operator's current selection.
 *
 * A group defaults to its newest variant (highest `swipeIndex`) — regenerate
 * appends, so the fresh reply is what you see and the original stays one swipe
 * away. But once the operator has swiped, that choice is theirs: it is carried
 * across by the selected message's id, and only falls back to "newest" when
 * that variant is gone.
 */
function collapseSwipeGroups(
  rows: Message[],
  previousSwipeStates: Record<string, SwipeState>,
): { display: Message[]; swipeStates: Record<string, SwipeState> } {
  const groups: Record<string, Message[]> = {}
  const display: Message[] = []

  for (const message of rows) {
    if (message.swipeGroupId) {
      ;(groups[message.swipeGroupId] ??= []).push(message)
    } else {
      display.push(message)
    }
  }

  const swipeStates: Record<string, SwipeState> = {}
  for (const [groupId, variants] of Object.entries(groups)) {
    const sorted = [...variants].sort((a, b) => (a.swipeIndex || 0) - (b.swipeIndex || 0))
    const previous = previousSwipeStates[groupId]
    const previouslySelectedId =
      previous && previous.current >= 0 && previous.current < previous.messages.length
        ? previous.messages[previous.current].id
        : null
    const carried = previouslySelectedId
      ? sorted.findIndex((m) => m.id === previouslySelectedId)
      : -1
    const current = carried >= 0 ? carried : sorted.length - 1

    display.push(sorted[current])
    swipeStates[groupId] = { current, total: sorted.length, messages: sorted }
  }

  return { display, swipeStates }
}

/**
 * How far a provisional bubble's clock may run ahead of the row that answers
 * it. The bubble is stamped in the browser and the row on the server — the same
 * machine in a self-hosted instance, but not necessarily the same millisecond,
 * and a slow POST widens the gap the other way.
 */
const PROVISIONAL_CLOCK_SLACK_MS = 60_000

/**
 * Which provisional bubbles the authoritative read has not yet caught up with.
 *
 * The server mints the real id, so there is nothing to match on directly. Two
 * passes, strongest signal first:
 *
 *   1. **Same role, same text.** Exact for a pending tool row and for a plain
 *      typed line.
 *   2. **Same role, newly arrived, not older than the bubble.** The fallback
 *      the first pass needs, because an optimistic user bubble does *not*
 *      always read the same as its persisted row: a send with attachments shows
 *      `[Attached: …]` and stores the bare prose, and a send that is nothing but
 *      attachments stores "Please look at the attached file(s)." A USER row that
 *      was not in the previous display and is no older than the bubble is the
 *      send we just made.
 *
 * Each authoritative row absorbs at most one bubble, so sending the same line
 * twice in a row doesn't silently swallow the second one, and running the exact
 * pass to completion first keeps two tabs sending at once from stealing each
 * other's match.
 */
function survivingProvisionals(previous: Message[], authoritative: Message[]): Message[] {
  const provisionals = previous.filter(isProvisionalMessage)
  if (provisionals.length === 0) return []

  const previousIds = new Set(previous.map((m) => m.id))
  const claimed = new Set<string>()
  const matched = new Set<Message>()

  const claim = (bubble: Message, predicate: (row: Message) => boolean): void => {
    const row = authoritative.find((candidate) => !claimed.has(candidate.id) && predicate(candidate))
    if (!row) return
    claimed.add(row.id)
    matched.add(bubble)
  }

  for (const bubble of provisionals) {
    claim(bubble, (row) => row.role === bubble.role && row.content.trim() === bubble.content.trim())
  }

  for (const bubble of provisionals) {
    if (matched.has(bubble)) continue
    const bubbleTime = new Date(bubble.createdAt).getTime()
    claim(bubble, (row) =>
      row.role === bubble.role &&
      !previousIds.has(row.id) &&
      new Date(row.createdAt).getTime() >= bubbleTime - PROVISIONAL_CLOCK_SLACK_MS)
  }

  return provisionals.filter((bubble) => !matched.has(bubble))
}

/**
 * Fold an authoritative transcript read into what the tab is showing.
 *
 * @param rows The transcript exactly as the server returned it, in server order.
 * @param previous The array currently on screen — authoritative rows from the
 *   last read plus any provisional bubbles added since.
 * @param previousSwipeStates The swipe groups as the operator last left them.
 * @returns The array to render and the swipe groups to go with it. When nothing
 *   changed, `messages` is the very `previous` array that came in.
 */
export function reconcileTranscript(
  rows: Message[],
  previous: Message[],
  previousSwipeStates: Record<string, SwipeState>,
): ReconciledTranscript {
  // SYSTEM rows are prompt plumbing, never bubbles.
  const visible = rows.filter((m) => m.role !== 'SYSTEM')
  const serverOrder = new Map(visible.map((m, i) => [m.id, i] as const))

  const { display, swipeStates } = collapseSwipeGroups(visible, previousSwipeStates)
  const authoritative = sortForDisplay(display, serverOrder)

  // Reuse the previous object for any row that hasn't actually changed, so the
  // virtualizer keeps its measurements and React skips the subtree.
  const byId = new Map(previous.map((m) => [m.id, m] as const))
  let identical = authoritative.length === previous.length
  const merged = authoritative.map((row, index) => {
    const before = byId.get(row.id)
    const reusable = before && sameRow(before, row)
    if (!reusable || previous[index]?.id !== row.id) identical = false
    return reusable ? before : row
  })

  // A provisional bubble the read hasn't caught up with stays on screen, at the
  // end — it is always the newest thing in the room.
  const stillPending = survivingProvisionals(previous, authoritative)
  if (stillPending.length > 0) identical = false

  return {
    messages: identical ? previous : [...merged, ...stillPending],
    swipeStates,
  }
}
