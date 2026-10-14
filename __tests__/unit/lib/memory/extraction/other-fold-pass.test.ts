/**
 * The fold-grain OTHER pass (`runFoldPass(ctx, 'other-fold', …)`): respects
 * the mode, caps candidates per subject (budget-clamped, with the event slot),
 * admits through `admitCandidate`, advances the `other-fold` cursor; reads a
 * wide window in slices; reads past a slice an earlier fold lost to a timeout
 * (review finding 4); drains a long catch-up backlog over several jobs
 * (finding 7); and carries the context's route and project (bugs 213, 222).
 */

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({ executeCheapLLMTask: jest.fn() }))
jest.mock('@/lib/memory/admission', () => require('../../../../helpers/admission-mock').admissionModuleMock())
jest.mock('@/lib/logger', () => {
  const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { ...l, child: jest.fn(() => l) } }
})

import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { runFoldPass, runFoldCatchup, messagesPastCursor } from '@/lib/memory/extraction'
import type { MessageEvent } from '@/lib/schemas/types'
import { mockAdmitRow, admissionOutcome } from '../../../../helpers/admission-mock'
import { makeExtractionContext, seatMessage, type TestContextOptions, type TestSeat } from '../../../../helpers/extraction-context'

const mockExecute = jest.mocked(executeCheapLLMTask)

const AMY: TestSeat = { characterId: 'c-amy', name: 'Amy', participantId: 's-amy' }
const BEA: TestSeat = { characterId: 'c-bea', name: 'Bea', participantId: 's-bea' }

type AnyRecord = Record<string, unknown>
type Reply = { raw: string } | { timedOut: true }

const draft = (s: string, over: AnyRecord = {}) => ({ subjectIndex: 1, content: s, summary: s, importance: 0.6, ...over })
const fiveDrafts = () => JSON.stringify(['a', 'b', 'c', 'd', 'e'].map(s => draft(s)))

const msg = (id: string, seat: TestSeat, over: Partial<MessageEvent> = {}) =>
  seatMessage(id, seat, `say-${id}`, '2026-10-01T10:00:00.000Z', over)
const history = (n: number) => Array.from({ length: n }, (_, i) => msg(`h${i + 1}`, i % 2 === 0 ? AMY : BEA))

/** The message ids a call's prompt rendered, in order. */
function idsRead(callIndex: number): string[] {
  const messages = mockExecute.mock.calls[callIndex][1] as Array<{ content: string }>
  return [...messages.map(m => m.content).join('\n').matchAll(/say-(\w+)/g)].map(m => m[1])
}

/** A scripted model: `reply(callNumber)` (1-based) says what the call returns. */
function model(reply: (n: number) => Reply = () => ({ raw: fiveDrafts() })) {
  let n = 0
  mockExecute.mockImplementation(async (_sel, _messages, _user, parse) => {
    n++
    const r = reply(n)
    if ('timedOut' in r) return { success: false, timedOut: true, error: 'timeout' } as never
    return { success: true, result: (parse as (raw: string) => unknown)(r.raw) } as never
  })
}

function ctxFor(messages: MessageEvent[], over: TestContextOptions = {}) {
  return makeExtractionContext({
    seats: [AMY, BEA],
    messages,
    mode: { otherPass: 'hybrid', foldCandidatesPerSubject: 3 },
    // Three slots of output budget, so the base cap of 3 is the binding one.
    maxTokens: 24000,
    ...over,
  })
}

const rows = () => mockAdmitRow.mock.calls.map(c => c[0] as AnyRecord)

let allMessages: MessageEvent[]

beforeEach(() => {
  jest.clearAllMocks()
  allMessages = [msg('m1', AMY), msg('m2', BEA), msg('m3', AMY), msg('m4', BEA)]
  let id = 0
  mockAdmitRow.mockImplementation(async () => admissionOutcome('insert', { id: `mem-${++id}` }))
  model()
})

describe("runFoldPass('other-fold')", () => {
  it("does nothing in 'turn' mode", async () => {
    const ctx = ctxFor(allMessages, { mode: { otherPass: 'turn' } })
    const r = await runFoldPass(ctx, 'other-fold', { windowMessages: allMessages })
    expect(r.skippedReason).toBe('mode-turn')
    expect(mockExecute).not.toHaveBeenCalled()
    expect((await ctx.cursors.read('other-fold')).afterMessageId).toBeNull()
  })

  it('caps candidates per subject at foldCandidatesPerSubject, admits OTHER rows and advances the cursor', async () => {
    const ctx = ctxFor(allMessages)
    const r = await runFoldPass(ctx, 'other-fold', { windowMessages: allMessages })
    // 2 observers x 1 subject each x cap 3
    expect(mockExecute).toHaveBeenCalledTimes(2)
    expect(mockAdmitRow).toHaveBeenCalledTimes(6)
    expect(rows().map(r => [r.characterId, r.aboutCharacterId])).toEqual([
      ...Array(3).fill(['c-amy', 'c-bea']),
      ...Array(3).fill(['c-bea', 'c-amy']),
    ])
    expect(r.createdIds).toHaveLength(6)
    expect(r.cursorAdvancedTo).toBe('m4')
    expect((await ctx.cursors.read('other-fold')).afterMessageId).toBe('m4')
  })

  it('honours a smaller configured cap', async () => {
    await runFoldPass(ctxFor(allMessages, { mode: { otherPass: 'fold', foldCandidatesPerSubject: 1 } }), 'other-fold', {
      windowMessages: allMessages,
    })
    expect(mockAdmitRow).toHaveBeenCalledTimes(2)
  })

  it('clamps the cap by the output budget, like the turn cap', async () => {
    // ceil(8000 / 8000) = 1 slot, below the configured 3.
    await runFoldPass(ctxFor(allMessages, { maxTokens: 8000 }), 'other-fold', { windowMessages: allMessages })
    expect(mockAdmitRow).toHaveBeenCalledTimes(2)
  })

  it('honours the event slot for a dated episodic draft instead of truncating it', async () => {
    model(() => ({
      raw: JSON.stringify([
        draft('a'), draft('b'), draft('c'),
        draft('the pier', { kind: 'episodic', when: 'yesterday' }),
        draft('e'),
      ]),
    }))
    await runFoldPass(ctxFor(allMessages), 'other-fold', { windowMessages: allMessages })
    // cap 3 + 1 event slot, per observer
    expect(mockAdmitRow).toHaveBeenCalledTimes(8)
    expect(rows().filter(r => r.summary === 'the pier')).toHaveLength(2)
  })

  it('skips a window already behind the cursor', async () => {
    const ctx = ctxFor(allMessages, { cursors: { 'other-fold': 'm4' } })
    const r = await runFoldPass(ctx, 'other-fold', { windowMessages: allMessages })
    expect(r.skippedReason).toBe('behind-cursor')
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('does not advance the cursor when the slice is lost to a timeout', async () => {
    model(() => ({ timedOut: true }))
    const ctx = ctxFor(allMessages)
    const r = await runFoldPass(ctx, 'other-fold', { windowMessages: allMessages })
    expect(r.timedOut).toBe(2)
    expect(r.cursorAdvancedTo).toBeNull()
    expect((await ctx.cursors.read('other-fold')).afterMessageId).toBeNull()
  })

  it('never throws into the fold', async () => {
    const ctx = ctxFor(allMessages)
    ctx.cursors.read = async () => { throw new Error('db gone') }
    await expect(runFoldPass(ctx, 'other-fold', { windowMessages: allMessages })).resolves.toMatchObject({ skippedReason: 'error' })
  })

  it('cites each observer\'s last line in the stretch as the source message', async () => {
    await runFoldPass(ctxFor(allMessages), 'other-fold', { windowMessages: allMessages })
    expect(new Set(rows().map(r => r.sourceMessageId))).toEqual(new Set(['m3', 'm4']))
  })

  it('dates an undated draft at its source line, never after it (bug 238)', async () => {
    const at = (min: number) => `2026-10-01T10:0${min}:00.000Z`
    allMessages = [
      msg('m1', AMY, { createdAt: at(1) }),
      msg('m2', BEA, { createdAt: at(2) }),
      msg('m3', AMY, { createdAt: at(3) }),
      msg('m4', BEA, { createdAt: at(4) }),
    ]
    await runFoldPass(ctxFor(allMessages), 'other-fold', { windowMessages: allMessages })
    const amy = rows().filter(r => r.characterId === 'c-amy')
    expect(amy.length).toBeGreaterThan(0)
    for (const row of amy) {
      expect(row.sourceMessageId).toBe('m3')
      // Amy's last line is m3; the stretch ends at m4.
      expect(row.occurredAt).toBe(at(3))
    }
  })
})

describe("runFoldPass('other-fold') — wide windows are read in slices (bug 206)", () => {
  it('reads 150 eligible messages as three slices and advances the cursor past each', async () => {
    allMessages = history(150)
    const ctx = ctxFor(allMessages)
    const advance = jest.spyOn(ctx.cursors, 'advance')
    const r = await runFoldPass(ctx, 'other-fold', { windowMessages: allMessages })

    // 3 slices x 2 observers
    expect(mockExecute).toHaveBeenCalledTimes(6)
    expect(mockExecute.mock.calls.map((_, i) => idsRead(i).length)).toEqual([60, 60, 60, 60, 30, 30])
    expect(advance.mock.calls.map(c => c[1])).toEqual(['h60', 'h120', 'h150'])
    expect(r.slices).toBe(3)
    expect(r.cursorAdvancedTo).toBe('h150')
    // Every slice admitted candidates whose source message lies inside it.
    expect(new Set(rows().map(r => r.sourceMessageId))).toEqual(new Set(['h59', 'h60', 'h119', 'h120', 'h149', 'h150']))
  })

  it('covers the final slice through an explicit cover-through id', async () => {
    allMessages = history(70)
    const ctx = ctxFor(allMessages)
    const advance = jest.spyOn(ctx.cursors, 'advance')
    const r = await runFoldPass(ctx, 'other-fold', { windowMessages: allMessages, coverThroughMessageId: 'tail-record' })
    expect(advance.mock.calls.map(c => c[1])).toEqual(['h60', 'tail-record'])
    expect(r.cursorAdvancedTo).toBe('tail-record')
  })

  it('stops at a slice lost to a timeout, leaving the cursor at the last slice read', async () => {
    allMessages = history(150)
    model(n => (n === 3 ? { timedOut: true } : { raw: JSON.stringify([draft('a')]) }))
    const ctx = ctxFor(allMessages)
    const advance = jest.spyOn(ctx.cursors, 'advance')
    const r = await runFoldPass(ctx, 'other-fold', { windowMessages: allMessages })
    expect(r.timedOut).toBe(1)
    // Slice 2's other observer still ran; slice 3 was never read.
    expect(mockExecute).toHaveBeenCalledTimes(4)
    expect(advance.mock.calls.map(c => c[1])).toEqual(['h60'])
    expect(r.cursorAdvancedTo).toBe('h60')
  })

  it('reads at most FOLD_MAX_SLICES_PER_JOB slices and reports the rest deferred', async () => {
    allMessages = history(300)
    const r = await runFoldPass(ctxFor(allMessages), 'other-fold', { windowMessages: allMessages })
    expect(r.slices).toBe(4)
    expect(r.slicesDeferred).toBe(1)
    expect(r.cursorAdvancedTo).toBe('h240')
  })
})

describe('messagesPastCursor', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('returns everything without a cursor', () => expect(messagesPastCursor(list, null)).toHaveLength(3))
  it('returns only what follows the cursor', () => expect(messagesPastCursor(list, 'b')).toEqual([{ id: 'c' }]))
  it('treats a vanished cursor as absent', () => expect(messagesPastCursor(list, 'zzz')).toHaveLength(3))
})

describe("runFoldPass('other-fold') — route and project (bugs 213, 222)", () => {
  it('hands the cheap-LLM call the uncensored fallback and the project, and stamps the project on the rows', async () => {
    const ctx = ctxFor(allMessages, { projectId: 'proj-1', projectDescription: 'A gaslit mystery' })
    const fallback = { conciergePolicy: {}, availableProfiles: [], isDangerousChat: true }
    ;(ctx.route as AnyRecord).uncensoredFallback = fallback

    await runFoldPass(ctx, 'other-fold', { windowMessages: allMessages })

    const call = mockExecute.mock.calls[0]
    expect(call[7]).toBe(fallback)
    expect((call[1] as Array<{ content: string }>).map(m => m.content).join('\n')).toContain('A gaslit mystery')
    expect(rows()[0].projectId).toBe('proj-1')
  })
})

describe("runFoldPass('other-fold') — review findings 4, 7, 13", () => {
  it('#4: a slice lost to a timeout is read by the next fold even when that fold only covers newer turns', async () => {
    allMessages = history(250)
    model(n => (n === 3 ? { timedOut: true } : { raw: '[]' }))
    const ctx = ctxFor(allMessages)
    await runFoldPass(ctx, 'other-fold', { windowMessages: allMessages.slice(0, 240) })
    expect((await ctx.cursors.read('other-fold')).afterMessageId).toBe('h60')

    mockExecute.mockClear()
    model(() => ({ raw: '[]' }))
    const r = await runFoldPass(ctx, 'other-fold', { windowMessages: allMessages.slice(240) })

    expect(idsRead(0)[0]).toBe('h61')
    expect(r.cursorAdvancedTo).toBe('h250')
  })

  it('#7: a long catch-up backlog takes several jobs and the cursor advances monotonically', async () => {
    allMessages = history(600)
    model(() => ({ raw: '[]' }))
    const ctx = ctxFor(allMessages)
    const marks: string[] = []
    for (let job = 0; job < 4; job++) {
      mockExecute.mockClear()
      const r = await runFoldCatchup(ctx, 'other-fold', { ignoreIdle: true })
      // At most four slices (two observers each) per job.
      expect(mockExecute.mock.calls.length).toBeLessThanOrEqual(8)
      if (r.cursorAdvancedTo) marks.push(r.cursorAdvancedTo)
      if ((await ctx.cursors.read('other-fold')).afterMessageId === 'h600') break
    }
    expect(marks).toEqual(['h240', 'h480', 'h600'])
  })

  it('#13: reads the range past the cursor from the chat transcript, not only the window handed over', async () => {
    allMessages = history(10)
    const ctx = ctxFor(allMessages, { cursors: { 'other-fold': 'h4' } })
    await runFoldPass(ctx, 'other-fold', { windowMessages: allMessages.slice(6) })
    expect(idsRead(0)[0]).toBe('h5')
  })
})
