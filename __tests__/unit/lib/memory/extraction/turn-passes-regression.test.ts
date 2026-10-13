/**
 * Regression tests for the turn-grain extraction passes (`runTurnPasses`,
 * `lib/memory/extraction/turn.ts`) — the successor of the retired per-turn
 * memory processor.
 *
 * Covers the two-pass shape:
 *   - SELF pass (`self-turn`): one call per slice, aboutCharacterId = self
 *   - OTHER pass (`other-turn`): one MULTI-SUBJECT call per observer, covering
 *     every other speaker + the user-controlled character (if any). Each
 *     answer item carries a 1-based `subjectIndex`, which routes the memory's
 *     aboutCharacterId. The user is NOT special-cased.
 *
 * Also exercises:
 *   - Multiple extracted candidates → multiple memory writes, token usage summed
 *   - the row's createdAt is the source message's own time
 *   - Rate-limit skip and throttle modes
 *   - near-duplicate absorption / embedding failure add no IDs
 */

import { beforeEach, describe, expect, it } from '@jest/globals'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): Record<string, unknown> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({ executeCheapLLMTask: jest.fn() }))
jest.mock('@/lib/memory/admission', () => require('../../../../helpers/admission-mock').admissionModuleMock())
// Wrap the OTHER prompt builder so a test can read the subjects each observer's call covers.
jest.mock('@/lib/memory/extraction/prompts/other', () => {
  const actual = jest.requireActual('@/lib/memory/extraction/prompts/other')
  return { ...actual, buildOtherTurnMessages: jest.fn(actual.buildOtherTurnMessages) }
})

import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { buildOtherTurnMessages } from '@/lib/memory/extraction/prompts/other'
import { runTurnPasses } from '@/lib/memory/extraction/turn'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import { makeExtractionContext, type TestContextOptions, type TestSeat } from '../../../../helpers/extraction-context'
import { mockAdmitRow as admitRow, admissionOutcome } from '../../../../helpers/admission-mock'

const mockExecute = jest.mocked(executeCheapLLMTask)
const mockBuildOther = jest.mocked(buildOtherTurnMessages)

type Draft = { content: string; summary: string; keywords?: string[]; importance?: number }
type Usage = { promptTokens: number; completionTokens: number; totalTokens: number }

const AVERY: TestSeat = { characterId: 'char-1', name: 'Avery' }
const BEATRICE: TestSeat = { characterId: 'char-2', name: 'Beatrice' }
const BOB: TestSeat = { characterId: 'user-char-1', name: 'Bob', isUser: true }

const TURN_TIME = '2026-04-01T12:34:56.000Z'

/** The model's scripted answers, by holder (SELF) and by observer → subject (OTHER). */
interface Script {
  self?: Record<string, Draft[]>
  other?: Record<string, Record<string, Draft[]>>
  selfUsage?: Usage
  otherUsage?: Usage
}

/** The subject ids the OTHER call for `observerName` covers, in prompt order. */
function subjectsFor(observerName: string): Array<{ id: string; isUser?: boolean }> {
  const call = mockBuildOther.mock.calls.find(c => c[0].observer.name === observerName)
  return call ? (call[0].subjects as Array<{ id: string; isUser?: boolean }>) : []
}

function nameOf(characterId: string): string {
  return [AVERY, BEATRICE, BOB].find(s => s.characterId === characterId)?.name ?? characterId
}

function scriptModel(script: Script): void {
  mockExecute.mockImplementation(async (_sel, _msgs, _user, parse, taskType, _chat, _x, _fb, _max, characterId) => {
    const holderId = characterId as string
    let raw: string
    let usage: Usage | undefined
    if (taskType === 'memory-extraction-self') {
      raw = JSON.stringify(script.self?.[holderId] ?? [])
      usage = script.selfUsage
    } else {
      const subjects = subjectsFor(nameOf(holderId))
      const bySubject = script.other?.[holderId] ?? {}
      raw = JSON.stringify(
        subjects.flatMap((s, i) => (bySubject[s.id] ?? []).map(d => ({ ...d, subjectIndex: i + 1 }))),
      )
      usage = script.otherUsage
    }
    return { success: true, result: parse(raw), ...(usage ? { usage } : {}) } as never
  })
}

function makeTranscript(extra: {
  userMessage?: string | null
  withUser?: boolean
  characterSlices?: Array<{ seat: TestSeat; text: string; isUserControlled?: boolean }>
} = {}): TurnTranscript {
  const slices = extra.characterSlices ?? [{ seat: AVERY, text: "I'll remember the compass." }]
  const withUser = extra.withUser !== false
  return {
    turnOpenerMessageId: 'opener-1',
    userMessage: 'userMessage' in extra ? extra.userMessage ?? null : "I keep my grandmother's compass in my satchel.",
    userCharacterId: withUser ? BOB.characterId : undefined,
    userCharacterName: withUser ? BOB.name : undefined,
    userCharacterPronouns: null,
    characterSlices: slices.map(s => ({
      characterId: s.seat.characterId,
      characterName: s.seat.name,
      characterPronouns: null,
      text: s.text,
      contributingMessageIds: [`assistant-${s.seat.characterId}`],
      lastMessageCreatedAt: TURN_TIME,
      ...(s.isUserControlled ? { isUserControlled: true } : {}),
    })),
    latestAssistantMessageId: `assistant-${slices[0].seat.characterId}`,
    turnTimestamp: TURN_TIME,
  }
}

function makeCtx(seats: TestSeat[], opts: TestContextOptions = {}) {
  return makeExtractionContext({ seats, userId: 'user-1', chatId: 'chat-1', mode: { otherPass: 'turn' }, ...opts })
}

const LIMITS = { enabled: true, maxPerHour: 20, softStartFraction: 0.7, softFloor: 0.7 }

describe('runTurnPasses regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    admitRow.mockReset()
    admitRow.mockResolvedValue(admissionOutcome('insert', { id: 'mem-default' }))
    scriptModel({})
  })

  it('aggregates token usage and writes one memory per candidate', async () => {
    scriptModel({
      self: { 'char-1': [{ content: 'Avery is steady', summary: 'steady', keywords: [], importance: 0.6 }] },
      other: {
        'char-1': {
          'user-char-1': [
            { content: 'compass fact', summary: 'compass', keywords: ['compass'], importance: 0.8 },
            { content: 'storm fear', summary: 'storms', keywords: ['storms'], importance: 0.7 },
          ],
        },
      },
      selfUsage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 },
      otherUsage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
    })
    admitRow
      .mockResolvedValueOnce(admissionOutcome('insert', { id: 'mem-1' }))
      .mockResolvedValueOnce(admissionOutcome('insert-linked', { id: 'mem-2' }, { linkTo: ['mem-1'] }))
      .mockResolvedValueOnce(admissionOutcome('reinforce', { id: 'mem-3', reinforcementCount: 2 }))

    const result = await runTurnPasses(makeCtx([AVERY, BOB]), makeTranscript())

    // SELF pass admits 1 candidate, OTHER pass (Avery → Bob) admits 2.
    expect(admitRow).toHaveBeenCalledTimes(3)
    expect(result.timedOut).toBe(0)
    expect(result.createdIds).toEqual(['mem-1', 'mem-2'])
    expect(result.reinforcedIds).toEqual(['mem-3'])
    expect(result.usage).toEqual({ promptTokens: 21, completionTokens: 7, totalTokens: 28 })
  })

  it("writes the source message's own time as the row's createdAt", async () => {
    scriptModel({ self: { 'char-1': [{ content: 'Avery is steady', summary: 'steady', importance: 0.7 }] } })

    await runTurnPasses(makeCtx([AVERY, BOB]), makeTranscript())

    expect(admitRow).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMessageTimestamp: TURN_TIME, sourceMessageId: 'assistant-char-1' }),
      { userId: 'user-1' },
    )
  })

  it('stamps the chat projectId onto every derived memory write', async () => {
    scriptModel({ self: { 'char-1': [{ content: 'Avery is steady', summary: 'steady', importance: 0.7 }] } })

    await runTurnPasses(makeCtx([AVERY, BOB], { projectId: 'proj-9' }), makeTranscript())

    expect(admitRow).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-9' }), { userId: 'user-1' })
  })

  it('writes projectId: null when the chat has no project', async () => {
    scriptModel({ self: { 'char-1': [{ content: 'Avery is steady', summary: 'steady', importance: 0.7 }] } })

    await runTurnPasses(makeCtx([AVERY, BOB]), makeTranscript())

    expect(admitRow).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }), { userId: 'user-1' })
  })

  it('a near-duplicate absorption keeps the result clean', async () => {
    scriptModel({ self: { 'char-1': [{ content: 'fact', summary: 'fact', importance: 0.7 }] } })
    admitRow.mockResolvedValueOnce(admissionOutcome('absorb', { id: 'mem-existing', reinforcementCount: 5 }))

    const result = await runTurnPasses(makeCtx([AVERY, BOB]), makeTranscript())

    expect(admitRow).toHaveBeenCalledTimes(1)
    expect(result.createdIds).toEqual([])
    expect(result.reinforcedIds).toEqual([])
    expect(result.debugLogs.join('\n')).toContain('SKIPPED near-duplicate')
  })

  it('an embedding failure keeps the result clean and surfaces the reason in debug logs', async () => {
    scriptModel({ self: { 'char-1': [{ content: 'fact', summary: 'fact', importance: 0.7 }] } })
    admitRow.mockResolvedValueOnce(admissionOutcome('reject', null))

    const result = await runTurnPasses(makeCtx([AVERY, BOB]), makeTranscript())

    expect(result.createdIds).toEqual([])
    expect(result.debugLogs.join('\n')).toContain('embedding generation failed')
  })

  it('rate limit: skips a character entirely when its recent count >= maxPerHour', async () => {
    scriptModel({ self: { 'char-1': [{ content: 'fact', summary: 'fact', importance: 0.7 }] } })

    const result = await runTurnPasses(
      makeCtx([AVERY, BOB], { limits: LIMITS, recentAdmissions: { 'char-1': 25 } }),
      makeTranscript(),
    )

    // Avery is the only holder of both calls, so neither is made.
    expect(mockExecute).not.toHaveBeenCalled()
    expect(admitRow).not.toHaveBeenCalled()
    expect(result.debugLogs.join('\n')).toContain('rate limit reached')
  })

  it('rate limit: in the soft band, drops candidates below the floor', async () => {
    scriptModel({
      other: {
        'char-1': {
          'user-char-1': [
            { content: 'high', summary: 'high', importance: 0.8 },
            { content: 'low', summary: 'low', importance: 0.5 },
          ],
        },
      },
    })

    const result = await runTurnPasses(
      makeCtx([AVERY, BOB], { limits: LIMITS, recentAdmissions: { 'char-1': 15 } }),
      makeTranscript(),
    )

    const logs = result.debugLogs.join('\n')
    expect(logs).toContain('Throttle dropped')
    expect(logs).toContain('floor 0.7')
    expect(admitRow).toHaveBeenCalledTimes(1)
    expect(admitRow).toHaveBeenCalledWith(expect.objectContaining({ summary: 'high' }), { userId: 'user-1' })
  })

  it('omits the user from OTHER subjects when no user-controlled character is attached', async () => {
    scriptModel({
      self: { 'char-1': [{ content: 'Avery feels protective.', summary: 'Avery is protective', importance: 0.6 }] },
    })

    await runTurnPasses(makeCtx([AVERY]), makeTranscript({ withUser: false }))

    // No other characters and no user — the OTHER pass makes zero calls.
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockExecute.mock.calls[0][4]).toBe('memory-extraction-self')
    expect(admitRow).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-1', aboutCharacterId: null }),
      { userId: 'user-1' },
    )
  })

  it('OTHER pass writes aboutCharacterId = userCharacterId when the subject is the user', async () => {
    scriptModel({
      other: {
        'char-1': { 'user-char-1': [{ content: 'User likes jazz.', summary: 'jazz', keywords: ['jazz'], importance: 0.6 }] },
      },
    })

    await runTurnPasses(makeCtx([AVERY, BOB]), makeTranscript())

    // 1 character + 1 user subject = 1 multi-subject OTHER call from char-1 covering [user-char-1].
    const otherCalls = mockExecute.mock.calls.filter(c => c[4] === 'memory-extraction-other')
    expect(otherCalls).toHaveLength(1)
    expect(otherCalls[0]).toEqual([
      expect.anything(), // selection
      expect.any(Array), // messages
      'user-1', // userId
      expect.any(Function), // parse
      'memory-extraction-other', // taskType
      'chat-1', // chatId
      undefined,
      undefined, // uncensoredFallback (none on the test route)
      16000, // the route's maxTokens
      'char-1', // observer, for the LLM log
    ])
    expect(subjectsFor('Avery')).toEqual([expect.objectContaining({ id: 'user-char-1', isUser: true })])
    expect(mockBuildOther).toHaveBeenCalledWith(expect.objectContaining({
      inAutonomousRoom: false,
      orienting: { projectDescription: null, chatContextSummary: null },
      clock: expect.objectContaining({ timelineMode: 'realtime' }),
    }))
    expect(admitRow).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-1', aboutCharacterId: 'user-char-1' }),
      { userId: 'user-1' },
    )
  })

  it('OTHER pass fires once per observer covering all subjects (N=2 chars + user → 2 calls, 4 writes)', async () => {
    const one = (s: string): Draft[] => [{ content: s, summary: s, importance: 0.6 }]
    scriptModel({
      other: {
        'char-1': { 'char-2': one('about-char-2'), 'user-char-1': one('about-user') },
        'char-2': { 'char-1': one('about-char-1'), 'user-char-1': one('about-user') },
      },
    })

    await runTurnPasses(
      makeCtx([AVERY, BEATRICE, BOB]),
      makeTranscript({
        characterSlices: [
          { seat: AVERY, text: 'Avery speaks.' },
          { seat: BEATRICE, text: 'Beatrice replies.' },
        ],
      }),
    )

    // One multi-subject call per observer (2 observers → 2 calls), each routing to 2 subjects.
    expect(mockExecute.mock.calls.filter(c => c[4] === 'memory-extraction-other')).toHaveLength(2)
    expect(admitRow).toHaveBeenCalledTimes(4)
    for (const [holder, about] of [
      ['char-1', 'char-2'],
      ['char-2', 'char-1'],
      ['char-1', 'user-char-1'],
      ['char-2', 'user-char-1'],
    ]) {
      expect(admitRow).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: holder, aboutCharacterId: about }),
        { userId: 'user-1' },
      )
    }
  })

  // ── User-controlled character as a memory HOLDER ────────────────────────────
  // When a human drives a character, that character's opener arrives as a slice
  // flagged isUserControlled. It must form its own SELF memories and OTHER
  // observations, without being duplicated as a subject or becoming its own
  // OTHER subject.
  describe('user-controlled holder', () => {
    function userHolderTranscript(): TurnTranscript {
      // Bob is driven by the human (slice flagged isUserControlled); Avery is
      // a normal AI character. Both are slices this turn.
      return makeTranscript({
        userMessage: 'I keep my compass.',
        characterSlices: [
          { seat: BOB, text: 'I keep my compass.', isUserControlled: true },
          { seat: AVERY, text: 'Avery nods.' },
        ],
      })
    }

    beforeEach(() => {
      // SELF answers only for the user-controlled holder; OTHER answers one
      // candidate about every subject the observer is paired with.
      const obs = (from: string, about: string): Draft[] => [{ content: `${from} about ${about}`, summary: 'obs', importance: 0.6 }]
      scriptModel({
        self: { 'user-char-1': [{ content: 'I committed to leaving at dawn.', summary: 'committed to leave', importance: 0.7 }] },
        other: {
          'user-char-1': { 'char-1': obs('user-char-1', 'char-1'), 'user-char-1': obs('user-char-1', 'user-char-1') },
          'char-1': { 'user-char-1': obs('char-1', 'user-char-1') },
        },
      })
    })

    it('forms SELF memories attributed to the user-controlled character (about itself)', async () => {
      await runTurnPasses(makeCtx([BOB, AVERY]), userHolderTranscript())

      const selfHolders = mockExecute.mock.calls.filter(c => c[4] === 'memory-extraction-self').map(c => c[9])
      expect(selfHolders).toEqual(['user-char-1', 'char-1'])
      expect(admitRow).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: 'user-char-1', aboutCharacterId: null, summary: 'committed to leave' }),
        { userId: 'user-1' },
      )
    })

    it('forms OTHER memories the user character holds about the other present characters', async () => {
      await runTurnPasses(makeCtx([BOB, AVERY]), userHolderTranscript())

      // Bob (user-controlled) observes Avery.
      expect(admitRow).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: 'user-char-1', aboutCharacterId: 'char-1' }),
        { userId: 'user-1' },
      )
      // Avery still observes Bob.
      expect(admitRow).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: 'char-1', aboutCharacterId: 'user-char-1' }),
        { userId: 'user-1' },
      )
    })

    it('never makes the user character its own OTHER subject', async () => {
      await runTurnPasses(makeCtx([BOB, AVERY]), userHolderTranscript())

      expect(subjectsFor('Bob').map(s => s.id)).toEqual(['char-1'])
      expect(admitRow).not.toHaveBeenCalledWith(
        expect.objectContaining({ characterId: 'user-char-1', aboutCharacterId: 'user-char-1' }),
        expect.anything(),
      )
    })

    it('de-dupes the user subject: exactly one user entry, tagged isUser', async () => {
      await runTurnPasses(makeCtx([BOB, AVERY]), userHolderTranscript())

      const userEntries = subjectsFor('Avery').filter(s => s.id === 'user-char-1')
      expect(userEntries).toHaveLength(1)
      expect(userEntries[0].isUser).toBe(true)
    })

    it('rate-limits the user-controlled holder on its own per-character cap', async () => {
      // Bob is over the cap; Avery is fresh. The cap is keyed on character ID,
      // so the user-controlled character is gated exactly like an AI one.
      const result = await runTurnPasses(
        makeCtx([BOB, AVERY], { limits: LIMITS, recentAdmissions: { 'user-char-1': 25 } }),
        userHolderTranscript(),
      )

      // Bob (over cap) makes no calls of his own and gains no memories…
      const holders = mockExecute.mock.calls.map(c => c[9])
      expect(holders).not.toContain('user-char-1')
      expect(holders).toContain('char-1')
      expect(admitRow).not.toHaveBeenCalledWith(expect.objectContaining({ characterId: 'user-char-1' }), expect.anything())
      expect(result.debugLogs.join('\n')).toContain('SKIPPED extraction for Bob')
      // …but the limit only stops the holder: Avery still forms memories about him.
      expect(subjectsFor('Avery').map(s => s.id)).toContain('user-char-1')
      expect(admitRow).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: 'char-1', aboutCharacterId: 'user-char-1' }),
        { userId: 'user-1' },
      )
    })
  })
})
