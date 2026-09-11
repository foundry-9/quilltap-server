/**
 * Transcript reconciliation — the merge that replaced "replace the array".
 *
 * Once the Salon's transcript became a subscribed read, a refetch stopped being
 * something that happens twice a turn at moments the client chose, and became
 * something that can land at any instant: mid-stream, mid-swipe, while the
 * operator is reading history. These pins hold the three properties that make
 * that safe — the read is the authority, the operator's swipe selection
 * survives it, and an unchanged read changes nothing at all.
 *
 * Design of record: docs/developer/features/complete/salon-realtime-transcript.md
 */

import {
  isProvisionalMessage,
  reconcileTranscript,
} from '@/app/salon/[id]/hooks/transcript-reconcile'
import type { SwipeState } from '@/app/salon/[id]/hooks/useChatData'
import type { Message } from '@/app/salon/[id]/types'

const T0 = '2026-09-11T12:49:25.818Z'
const T1 = '2026-09-11T12:49:25.859Z'
const T2 = '2026-09-11T12:49:59.812Z'

function row(overrides: Partial<Message> & { id: string }): Message {
  return {
    role: 'ASSISTANT',
    content: 'hello',
    createdAt: T0,
    ...overrides,
  } as Message
}

/** Reconcile against an empty display — the mount case. */
function fresh(rows: Message[]) {
  return reconcileTranscript(rows, [], {})
}

describe('reconcileTranscript — the authoritative read', () => {
  it('drops SYSTEM rows, which are prompt plumbing and never bubbles', () => {
    const { messages } = fresh([
      row({ id: 'sys', role: 'SYSTEM', content: 'you are…' }),
      row({ id: 'a', role: 'USER', content: 'hi' }),
    ])
    expect(messages.map((m) => m.id)).toEqual(['a'])
  })

  it('orders by createdAt, breaking ties on the server’s own order', () => {
    // The incident chat has message pairs 41 ms and 5 ms apart, and a batch
    // written in one call shares a timestamp outright. Without the tiebreak the
    // client is free to disagree with the read it just performed.
    const rows = [
      row({ id: 'first', createdAt: T1 }),
      row({ id: 'second', createdAt: T1 }),
      row({ id: 'earlier', createdAt: T0 }),
    ]
    expect(fresh(rows).messages.map((m) => m.id)).toEqual(['earlier', 'first', 'second'])
  })

  it('returns the very same array when nothing changed, so nothing re-renders', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', createdAt: T1 })]
    const first = fresh(rows)
    const second = reconcileTranscript(rows.map((r) => ({ ...r })), first.messages, first.swipeStates)
    expect(second.messages).toBe(first.messages)
  })

  it('reuses the previous object for a row that did not change', () => {
    const first = fresh([row({ id: 'a' }), row({ id: 'b', createdAt: T1 })])
    const second = reconcileTranscript(
      [row({ id: 'a' }), row({ id: 'b', createdAt: T1, content: 'edited' })],
      first.messages,
      first.swipeStates,
    )
    expect(second.messages[0]).toBe(first.messages[0])
    expect(second.messages[1]).not.toBe(first.messages[1])
    expect(second.messages[1].content).toBe('edited')
  })

  it('takes a row that changed from the read, not from the display', () => {
    const first = fresh([row({ id: 'a', content: 'typo' })])
    const second = reconcileTranscript(
      [row({ id: 'a', content: 'fixed' })],
      first.messages,
      first.swipeStates,
    )
    expect(second.messages[0].content).toBe('fixed')
  })

  it('surfaces a row the display has never seen — the incident in one line', () => {
    // Abigail's reply persisted at 12:49:59.812Z and never appeared in the tab,
    // because nothing existed to tell the tab to look again.
    const first = fresh([row({ id: 'user', role: 'USER', content: 'go on', createdAt: T0 })])
    const second = reconcileTranscript(
      [
        row({ id: 'user', role: 'USER', content: 'go on', createdAt: T0 }),
        row({ id: 'abigail', content: 'As you like.', createdAt: T2 }),
      ],
      first.messages,
      first.swipeStates,
    )
    expect(second.messages.map((m) => m.id)).toEqual(['user', 'abigail'])
  })

  it('removes a row the read no longer carries (a swept whisper)', () => {
    const first = fresh([row({ id: 'a' }), row({ id: 'whisper', createdAt: T1 })])
    const second = reconcileTranscript([row({ id: 'a' })], first.messages, first.swipeStates)
    expect(second.messages.map((m) => m.id)).toEqual(['a'])
  })
})

describe('reconcileTranscript — swipe selection', () => {
  const variants = [
    row({ id: 'v0', swipeGroupId: 'g', swipeIndex: 0, content: 'first take' }),
    row({ id: 'v1', swipeGroupId: 'g', swipeIndex: 1, content: 'second take' }),
  ]

  it('defaults a group to its newest variant', () => {
    const { messages, swipeStates } = fresh(variants)
    expect(messages.map((m) => m.id)).toEqual(['v1'])
    expect(swipeStates.g).toMatchObject({ current: 1, total: 2 })
  })

  it('carries the operator’s selection across a refetch', () => {
    const first = fresh(variants)
    // The operator swipes back to the original.
    const swiped: Record<string, SwipeState> = {
      g: { ...first.swipeStates.g, current: 0 },
    }
    const second = reconcileTranscript(variants, [variants[0]], swiped)
    expect(second.messages.map((m) => m.id)).toEqual(['v0'])
    expect(second.swipeStates.g.current).toBe(0)
  })

  it('keeps the selection on the same variant when a regenerate appends another', () => {
    const first = fresh(variants)
    const swiped: Record<string, SwipeState> = { g: { ...first.swipeStates.g, current: 0 } }
    const grown = [...variants, row({ id: 'v2', swipeGroupId: 'g', swipeIndex: 2, content: 'third take' })]
    const second = reconcileTranscript(grown, [variants[0]], swiped)
    expect(second.messages.map((m) => m.id)).toEqual(['v0'])
    expect(second.swipeStates.g).toMatchObject({ current: 0, total: 3 })
  })

  it('falls back to the newest variant when the selected one is gone', () => {
    const first = fresh(variants)
    const swiped: Record<string, SwipeState> = { g: { ...first.swipeStates.g, current: 0 } }
    const second = reconcileTranscript([variants[1]], [variants[0]], swiped)
    expect(second.messages.map((m) => m.id)).toEqual(['v1'])
    expect(second.swipeStates.g.current).toBe(0) // sole survivor, index 0 of 1
    expect(second.swipeStates.g.total).toBe(1)
  })
})

describe('reconcileTranscript — provisional bubbles', () => {
  const provisional = row({
    id: 'temp-user-1757594965818',
    role: 'USER',
    content: 'Tell me about the orchard.',
    createdAt: T0,
  })

  it('recognises a provisional id', () => {
    expect(isProvisionalMessage(provisional)).toBe(true)
    expect(isProvisionalMessage(row({ id: 'abigail' }))).toBe(false)
  })

  it('keeps the bubble while the read has not caught up', () => {
    const { messages } = reconcileTranscript([], [provisional], {})
    expect(messages.map((m) => m.id)).toEqual([provisional.id])
  })

  it('drops the bubble the moment the read carries the same line', () => {
    const persisted = row({
      id: 'real-user',
      role: 'USER',
      content: 'Tell me about the orchard.',
      createdAt: T1,
    })
    const { messages } = reconcileTranscript([persisted], [provisional], {})
    expect(messages.map((m) => m.id)).toEqual(['real-user'])
  })

  it('drops a bubble whose persisted row reads differently — an attachment send', () => {
    // The bubble shows "[Attached: plan.png]"; the server stores the bare prose,
    // or "Please look at the attached file(s)." when there was no prose at all.
    const bubble = row({
      id: 'temp-user-2',
      role: 'USER',
      content: '[Attached: plan.png]',
      createdAt: T0,
    })
    const persisted = row({
      id: 'real-user',
      role: 'USER',
      content: 'Please look at the attached file(s).',
      createdAt: T1,
    })
    const { messages } = reconcileTranscript([persisted], [bubble], {})
    expect(messages.map((m) => m.id)).toEqual(['real-user'])
  })

  it('does not let one persisted row absorb two bubbles', () => {
    const twice = [
      row({ id: 'temp-user-a', role: 'USER', content: 'again', createdAt: T0 }),
      row({ id: 'temp-user-b', role: 'USER', content: 'again', createdAt: T1 }),
    ]
    const persisted = row({ id: 'real-a', role: 'USER', content: 'again', createdAt: T1 })
    const { messages } = reconcileTranscript([persisted], twice, {})
    expect(messages.map((m) => m.id)).toEqual(['real-a', 'temp-user-b'])
  })

  it('does not match a bubble against a row the display already had', () => {
    const older = row({ id: 'old-user', role: 'USER', content: 'earlier line', createdAt: T0 })
    const bubble = row({ id: 'temp-user-c', role: 'USER', content: 'new line', createdAt: T1 })
    const { messages } = reconcileTranscript([older], [older, bubble], {})
    expect(messages.map((m) => m.id)).toEqual(['old-user', 'temp-user-c'])
  })

  it('renders the bubble last — it is always the newest thing in the room', () => {
    const existing = row({ id: 'abigail', createdAt: T2 })
    const { messages } = reconcileTranscript([existing], [existing, provisional], {})
    expect(messages.map((m) => m.id)).toEqual(['abigail', provisional.id])
  })
})
