/**
 * Regressions from the review of PR 94 (memory refactor Phase D):
 *
 *  - A fold slice whose calls the rate limit would all skip is deferred, not
 *    read: the cursor stays before it, so its messages are read later.
 *  - A backfill context (regenerate, queue-memories, import) has the rate
 *    limit off, and tells admission so its inserts do not count towards it.
 *  - `listExtractionTurns` keeps the greeting turn ahead of the first user
 *    message, as the live trigger extracts it.
 */

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({ executeCheapLLMTask: jest.fn() }))
jest.mock('@/lib/memory/admission', () => {
  const actual = jest.requireActual('@/lib/memory/admission')
  return { ...actual, admitCandidate: jest.fn(), linkBothWays: jest.fn(async () => []) }
})

import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { admitCandidate } from '@/lib/memory/admission'
import { runFoldPass, runTurnPasses } from '@/lib/memory/extraction'
import { listExtractionTurns } from '@/lib/services/chat-message/turn-transcript'
import type { MessageEvent } from '@/lib/schemas/types'
import { makeExtractionContext, seatMessage, type TestSeat } from '../../../../helpers/extraction-context'

const mockExecute = jest.mocked(executeCheapLLMTask)
const mockAdmit = jest.mocked(admitCandidate)

const AMY: TestSeat = { characterId: 'amy', name: 'Amy' }
const BOB: TestSeat = { characterId: 'bob', name: 'Bob' }
const LIMITS = { enabled: true, maxPerHour: 5, softStartFraction: 0.7, softFloor: 0.7 }

const MESSAGES = [
  seatMessage('m1', AMY, 'We sail at dawn.', '2026-07-14T09:00:00.000Z'),
  seatMessage('m2', BOB, 'I shall bring the charts.', '2026-07-14T09:01:00.000Z'),
]

beforeEach(() => {
  jest.clearAllMocks()
  mockExecute.mockImplementation(async (_s, _m, _u, parse) => ({
    success: true,
    result: parse(JSON.stringify([{ narrative: 'On July 14th they set sail.', summary: 'set sail', importance: 0.7 }])),
  }) as never)
  mockAdmit.mockImplementation(async () => ({
    action: { kind: 'insert' },
    memory: { id: 'new-1', relatedMemoryIds: [] },
    novelDetails: [],
    linkedIds: [],
    trace: { assessments: [], notes: [] },
  }) as never)
})

describe('fold slices and the rate limit', () => {
  it('defers a slice whose holders are all at the cap, leaving the cursor before it', async () => {
    const ctx = makeExtractionContext({
      seats: [AMY, BOB],
      messages: MESSAGES,
      limits: LIMITS,
      recentAdmissions: { amy: 5, bob: 5 },
    })
    const result = await runFoldPass(ctx, 'episode-fold', { windowMessages: MESSAGES })
    expect(result.skippedReason).toBe('rate-limited')
    expect(result.rateDeferred).toBe(true)
    expect(result.slicesDeferred).toBe(1)
    expect(mockExecute).not.toHaveBeenCalled()
    expect((await ctx.cursors.read('episode-fold')).afterMessageId).toBeNull()
  })

  it('still reads a slice when only some holders are at the cap', async () => {
    const ctx = makeExtractionContext({
      seats: [AMY, BOB],
      messages: MESSAGES,
      limits: LIMITS,
      recentAdmissions: { amy: 5, bob: 0 },
    })
    const result = await runFoldPass(ctx, 'episode-fold', { windowMessages: MESSAGES })
    expect(result.rateDeferred).toBe(false)
    expect(mockAdmit.mock.calls.map(c => c[0].subject.holderId)).toEqual(['bob'])
    expect((await ctx.cursors.read('episode-fold')).afterMessageId).toBe('m2')
  })
})

describe('a fold that throws mid-run', () => {
  it('keeps what earlier slices did and leaves the rest as deferred', async () => {
    const messages = Array.from({ length: 150 }, (_, i) =>
      seatMessage(`h${i + 1}`, i % 2 ? BOB : AMY, `line ${i + 1}`, new Date(Date.parse('2026-07-14T09:00:00.000Z') + i * 60000).toISOString()),
    )
    let call = 0
    mockExecute.mockImplementation(async (_s, _m, _u, parse) => {
      call++
      if (call === 3) throw new Error('provider exploded')
      return { success: true, result: parse('[]'), usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 } } as never
    })
    const ctx = makeExtractionContext({ seats: [AMY, BOB], messages })
    const result = await runFoldPass(ctx, 'episode-fold', { windowMessages: messages, maxSlices: 100 })
    expect(result.skippedReason).toBe('error')
    expect(result.cursorAdvancedTo).toBe('h120')
    expect(result.slices).toBe(2)
    expect(result.slicesDeferred).toBe(1)
    expect(result.usage.totalTokens).toBe(20)
    expect((await ctx.cursors.read('episode-fold')).afterMessageId).toBe('h120')
  })
})

describe('backfill', () => {
  it('turns the rate limit off and marks admissions as backfill', async () => {
    mockExecute.mockImplementation(async (_s, _m, _u, parse) => ({
      success: true,
      result: parse(JSON.stringify([{ content: 'I promised the charts.', summary: 'promised the charts', importance: 0.8 }])),
    }) as never)
    const ctx = makeExtractionContext({ seats: [BOB], limits: LIMITS, recentAdmissions: { bob: 50 }, backfill: true })
    // The helper builds a live limiter; a real backfill context builds a disabled one.
    const { createRateLimiter } = jest.requireActual('@/lib/memory/extraction/rate-limit')
    ctx.rateLimit = createRateLimiter({ ...LIMITS, enabled: false }, async () => 50)
    await runTurnPasses(ctx, {
      turnOpenerMessageId: null,
      userMessage: null,
      userCharacterPronouns: null,
      characterSlices: [{ characterId: 'bob', characterName: 'Bob', text: 'I promised the charts.', contributingMessageIds: ['b1'], lastMessageCreatedAt: '2026-07-14T09:00:00.000Z' }],
      latestAssistantMessageId: 'b1',
      turnTimestamp: '2026-07-14T09:00:00.000Z',
    })
    expect(mockAdmit).toHaveBeenCalledTimes(1)
    expect(mockAdmit.mock.calls[0][2]).toMatchObject({ backfill: true })
  })
})

describe('listExtractionTurns', () => {
  const msg = (id: string, role: 'USER' | 'ASSISTANT', extra: Partial<MessageEvent> = {}) =>
    ({ id, type: 'message', role, content: 'x', participantId: role === 'ASSISTANT' ? 'p-a' : 'p-u', ...extra }) as unknown as MessageEvent

  it('keeps the greeting turn ahead of the first user message', () => {
    expect(listExtractionTurns([msg('g', 'ASSISTANT'), msg('u1', 'USER'), msg('a1', 'ASSISTANT'), msg('u2', 'USER')], 'salon')).toEqual([
      { turnOpenerMessageId: null },
      { turnOpenerMessageId: 'u1' },
      { turnOpenerMessageId: 'u2' },
    ])
  })

  it('adds no greeting turn when the chat opens with the user, or the only early line is staff', () => {
    expect(listExtractionTurns([msg('u1', 'USER'), msg('a1', 'ASSISTANT')], 'salon')).toEqual([{ turnOpenerMessageId: 'u1' }])
    expect(listExtractionTurns([msg('h', 'ASSISTANT', { systemSender: 'host' }), msg('u1', 'USER')], 'salon')).toEqual([
      { turnOpenerMessageId: 'u1' },
    ])
  })

  it('is one greeting turn for a chat with no user message, and none for an empty chat', () => {
    expect(listExtractionTurns([msg('g', 'ASSISTANT')], 'salon')).toEqual([{ turnOpenerMessageId: null }])
    expect(listExtractionTurns([], 'salon')).toEqual([])
  })

  it('anchors each closing line in an autonomous room', () => {
    expect(listExtractionTurns([msg('a1', 'ASSISTANT'), msg('a2', 'ASSISTANT')], 'autonomous')).toEqual([
      { turnOpenerMessageId: null, extractionAnchorMessageId: 'a1' },
      { turnOpenerMessageId: null, extractionAnchorMessageId: 'a2' },
    ])
  })
})
