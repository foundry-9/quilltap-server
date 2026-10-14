/**
 * Cursor advance equals covered window (memory refactor §3.7; bugs 206, 207).
 *
 * Across a 150-message chat read in 60-message slices, each fold-grain pass
 * reads three slices of 60 / 60 / 30, the cursor advances only past a slice
 * once it has been read (so every slice starts right after the cursor), and it
 * ends on the chat's last message. A slice lost to a timeout leaves the cursor
 * at the end of the slice before it.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({ executeCheapLLMTask: jest.fn() }))
jest.mock('@/lib/memory/admission', () => require('../../../../helpers/admission-mock').admissionModuleMock())
jest.mock('@/lib/logger', () => {
  const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { ...l, child: jest.fn(() => l) } }
})

import { getRepositories } from '@/lib/repositories/factory'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { runFoldPass, FOLD_MAX_WINDOW_MESSAGES } from '@/lib/memory/extraction'
import type { ExtractionContext } from '@/lib/memory/extraction'
import type { MessageEvent } from '@/lib/schemas/types'
import { mockAdmitRow, admissionOutcome } from '../../../../helpers/admission-mock'
import { makeExtractionContext, seatMessage, type TestSeat } from '../../../../helpers/extraction-context'

const mockExecute = jest.mocked(executeCheapLLMTask)

const AMY: TestSeat = { characterId: 'c-amy', name: 'Amy', participantId: 's-amy' }
const BEA: TestSeat = { characterId: 'c-bea', name: 'Bea', participantId: 's-bea' }

const ALL: MessageEvent[] = Array.from({ length: 150 }, (_, i) =>
  seatMessage(`h${i + 1}`, i % 2 === 0 ? AMY : BEA, `say-h${i + 1}`, new Date(Date.UTC(2026, 6, 20, 9, i)).toISOString()),
)

interface Read {
  ids: string[]
  cursorAtCall: string | null
}

/** Every call's rendered ids and the cursor at the moment it was made; `timeOut(ids)` decides a timeout. */
function model(ctx: ExtractionContext, pass: 'other-fold' | 'episode-fold', timeOut: (ids: string[]) => boolean = () => false) {
  const reads: Read[] = []
  mockExecute.mockImplementation(async (_sel, messages, _user, parse) => {
    const text = (messages as Array<{ content: string }>).map(m => m.content).join('\n')
    const ids = [...text.matchAll(/say-(\w+)/g)].map(m => m[1])
    reads.push({ ids, cursorAtCall: (await ctx.cursors.read(pass)).afterMessageId })
    if (timeOut(ids)) return { success: false, timedOut: true, error: 'timeout' } as never
    return { success: true, result: (parse as (raw: string) => unknown)('[]') } as never
  })
  return reads
}

/** The distinct slices read (an OTHER slice is read once per observer). */
function slicesOf(reads: Read[]): Read[] {
  const seen = new Map<string, Read>()
  for (const r of reads) {
    const key = r.ids.join(',')
    if (!seen.has(key)) seen.set(key, r)
  }
  return [...seen.values()]
}

const ctxFor = () =>
  makeExtractionContext({ seats: [AMY, BEA], messages: ALL, mode: { otherPass: 'hybrid' } })

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRepositories as jest.Mock).mockReturnValue({
    memories: { findByCharacterAndSourceMessageIds: jest.fn(async () => []), addRelatedMemoryIds: jest.fn(async () => []) },
  })
  mockAdmitRow.mockResolvedValue(admissionOutcome('insert', { id: 'mem-1', relatedMemoryIds: [] }))
})

describe.each(['other-fold', 'episode-fold'] as const)('%s: cursor advance equals covered window', pass => {
  it('reads a 150-message chat in 60/60/30 slices and advances the cursor only past each slice read', async () => {
    expect(FOLD_MAX_WINDOW_MESSAGES).toBe(60)
    const ctx = ctxFor()
    const advance = jest.spyOn(ctx.cursors, 'advance')
    const reads = model(ctx, pass)

    const result = await runFoldPass(ctx, pass, { windowMessages: ALL, maxSlices: 100 })

    const slices = slicesOf(reads)
    expect(slices.map(s => s.ids.length)).toEqual([60, 60, 30])
    // Together the slices are the whole chat, in order, each message once.
    expect(slices.flatMap(s => s.ids)).toEqual(ALL.map(m => m.id))
    // Each slice was read with the cursor sitting just before it.
    expect(slices.map(s => s.cursorAtCall)).toEqual([null, 'h60', 'h120'])
    expect(advance.mock.calls.map(c => c[1])).toEqual(['h60', 'h120', 'h150'])

    expect(result).toMatchObject({ slices: 3, slicesDeferred: 0, timedOut: 0, cursorAdvancedTo: 'h150' })
    expect((await ctx.cursors.read(pass)).afterMessageId).toBe('h150')
  })

  it('a timeout on slice 2 leaves the cursor at the end of slice 1', async () => {
    const ctx = ctxFor()
    const advance = jest.spyOn(ctx.cursors, 'advance')
    const reads = model(ctx, pass, ids => ids[0] === 'h61')

    const result = await runFoldPass(ctx, pass, { windowMessages: ALL, maxSlices: 100 })

    // Slice 3 is never read.
    expect(slicesOf(reads).map(s => s.ids[0])).toEqual(['h1', 'h61'])
    expect(advance.mock.calls.map(c => c[1])).toEqual(['h60'])
    expect(result.timedOut).toBeGreaterThan(0)
    expect(result.slices).toBe(2)
    expect(result.cursorAdvancedTo).toBe('h60')
    expect((await ctx.cursors.read(pass)).afterMessageId).toBe('h60')

    // The next run picks up at slice 2, not past it.
    mockExecute.mockClear()
    const again = model(ctx, pass)
    const next = await runFoldPass(ctx, pass, { windowMessages: ALL, maxSlices: 100 })
    expect(slicesOf(again).map(s => [s.ids[0], s.ids.length])).toEqual([['h61', 60], ['h121', 30]])
    expect(next.cursorAdvancedTo).toBe('h150')
  })
})
