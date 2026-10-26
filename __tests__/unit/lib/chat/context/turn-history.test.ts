/**
 * Tests for the turn's history selection and the request's head.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})

import { assembleLeadingMessages, packTurnHistory, turnHistoryRows, type HistoryCast } from '@/lib/chat/context/turn-history'
import { SUMMARY_CONTENT_PREFIX } from '@/lib/services/librarian-notifications/writer'
import type { Character, ChatParticipantBase } from '@/lib/schemas/types'

const timestamp = '2026-10-01T12:00:00.000Z'

const seat = (id: string, characterId: string, controlledBy: 'llm' | 'user'): ChatParticipantBase => ({
  id,
  type: 'CHARACTER',
  characterId,
  controlledBy,
  status: 'active',
  hasHistoryAccess: true,
  displayOrder: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
} as unknown as ChatParticipantBase)

const friday = { id: 'char-friday', name: 'Friday' } as Character
const charlie = { id: 'char-charlie', name: 'Charlie' } as Character
const fridaySeat = seat('p-friday', friday.id, 'llm')
const charlieSeat = seat('p-charlie', charlie.id, 'user')

const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']
const existingMessages = ids.map((id, i) => ({ role: i % 2 === 0 ? 'USER' : 'ASSISTANT', content: `line ${id}`, id }))

const cast: HistoryCast = {
  respondingParticipant: fridaySeat,
  allParticipants: [fridaySeat, charlieSeat],
  participantCharacters: new Map([[friday.id, friday], [charlie.id, charlie]]),
  messagesWithParticipants: existingMessages.map((m, i) => ({
    ...m,
    participantId: i % 2 === 0 ? charlieSeat.id : fridaySeat.id,
    createdAt: timestamp,
  })),
}

const base = {
  existingMessages,
  windowStart: 0,
  summaryAnchorIds: [] as string[],
}

const pack = { provider: 'OPENAI' as const, recentMessagesBudget: 100_000, totalLimit: 128_000, warnings: [] as string[] }

describe('turnHistoryRows', () => {
  it('keeps the whole history when nothing is summarised', () => {
    expect(turnHistoryRows(base).map(m => m.id)).toEqual(ids)
    expect(turnHistoryRows({ ...base, cast }).map(m => m.id)).toEqual(ids)
  })

  it('cuts a single-character history to the compression window', () => {
    expect(turnHistoryRows({ ...base, windowStart: 4 }).map(m => m.id)).toEqual(['m5', 'm6'])
  })

  // Bug 264: in a multi-character chat the compression window was computed
  // and then ignored, so the rows the summary covered rode verbatim beside it.
  it('cuts a multi-character history to the same window', () => {
    const rows = turnHistoryRows({ ...base, cast, windowStart: 4 })
    expect(rows.map(m => m.id)).toEqual(['m5', 'm6'])
    // Still attributed from the responder's seat.
    expect(rows.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(rows[0].name).toBe('Charlie')
  })

  it('places the window by index when the rows carry no ids', () => {
    const noIds = existingMessages.map(({ id: _id, ...m }) => m)
    const anonymousCast = { ...cast, messagesWithParticipants: cast.messagesWithParticipants.map(({ id: _id, ...m }) => m) }
    const rows = turnHistoryRows({ ...base, existingMessages: noIds, cast: anonymousCast, windowStart: 4 })
    expect(rows.map(m => m.content)).toEqual(['line m5', 'line m6'])
  })

  it('drops rows the running summary absorbed', () => {
    expect(turnHistoryRows({ ...base, cast, summaryAnchorIds: ['m1', 'm2'] }).map(m => m.id))
      .toEqual(['m3', 'm4', 'm5', 'm6'])
  })
})

describe('packTurnHistory', () => {
  it('sends every row when they fit', () => {
    const history = packTurnHistory(turnHistoryRows(base), { ...pack, remainingTokens: 100_000 })
    expect(history.truncated).toBe(false)
    expect(history.messages.map(m => m.id)).toEqual(ids)
  })

  it('packs newest-first into the smaller of what is left and the history budget', () => {
    const rows = turnHistoryRows(base)
    const history = packTurnHistory(rows, { ...pack, remainingTokens: 20 })
    expect(history.truncated).toBe(true)
    expect(history.messages.length).toBeLessThan(ids.length)
    // Always a suffix of the rows — what the scene note's reservation relies on.
    expect(history.messages.map(m => m.id)).toEqual(ids.slice(ids.length - history.messages.length))
  })
})

describe('assembleLeadingMessages', () => {
  const history = [
    { role: 'USER', content: `${SUMMARY_CONTENT_PREFIX} earlier`, id: 's1' },
    { role: 'USER', content: `${SUMMARY_CONTENT_PREFIX} later`, id: 's2' },
    { role: 'ASSISTANT', content: 'Indeed.', id: 'a1' },
  ]

  it('lays out the persona prompt, the identity reminder, then history', () => {
    const messages = assembleLeadingMessages({ systemPrompt: 'You are Friday.', characterName: 'Friday', compressedHistoryBlock: null, history })
    expect(messages.map(m => m.role)).toEqual(['system', 'system', 'user', 'user', 'assistant'])
    expect(messages[0].content).toBe('You are Friday.')
    expect(messages[1].content).toContain('## Identity Reminder')
    expect(messages[4].metadata).toEqual({ messageId: 'a1' })
  })

  it('adds the compressed summary as system block 3 only when in force', () => {
    const messages = assembleLeadingMessages({ systemPrompt: 'P', characterName: 'Friday', compressedHistoryBlock: 'SUMMARY', history: [] })
    expect(messages.map(m => m.content)).toEqual(['P', expect.stringContaining('Identity Reminder'), 'SUMMARY'])
  })

  it('puts the cache breakpoint on the first Librarian summary only', () => {
    const messages = assembleLeadingMessages({ systemPrompt: 'P', characterName: 'Friday', compressedHistoryBlock: null, history })
    expect(messages.map(m => m.cacheControl)).toEqual([undefined, undefined, { type: 'ephemeral' }, undefined, undefined])
  })
})
