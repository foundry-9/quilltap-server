/**
 * The pass runner's invariants (memory refactor Phase D, §3.7 and §5):
 *
 *  - Dry run equals live (invariant 10): given the same model output, the
 *    candidate list and the admission decisions are identical; only the writes
 *    differ (the dry run asks admission to decide only).
 *  - The rate limit is a live counter: inserts that land during the unit of
 *    work count against the holder at once.
 *  - Caps are one rule per pass, and the event slot the prompt promises is
 *    honoured at fold grain too.
 */

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({ executeCheapLLMTask: jest.fn() }))
jest.mock('@/lib/memory/admission', () => {
  const actual = jest.requireActual('@/lib/memory/admission')
  return { ...actual, admitCandidate: jest.fn(), linkBothWays: jest.fn(async () => []) }
})

import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { admitCandidate, type AdmissionOutcome } from '@/lib/memory/admission'
import { runTurnPasses, runFoldPass, toExtractedCandidate } from '@/lib/memory/extraction'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import { makeExtractionContext, seatMessage, type TestSeat } from '../../../../helpers/extraction-context'

const mockExecute = jest.mocked(executeCheapLLMTask)
const mockAdmit = jest.mocked(admitCandidate)

const AMY: TestSeat = { characterId: 'amy', name: 'Amy' }
const BOB: TestSeat = { characterId: 'bob', name: 'Bob' }
const CHARLIE: TestSeat = { characterId: 'charlie', name: 'Charlie', isUser: true }

function transcript(): TurnTranscript {
  return {
    turnOpenerMessageId: 'u1',
    userMessage: 'Shall we sail tomorrow?',
    userCharacterId: 'charlie',
    userCharacterName: 'Charlie',
    userCharacterPronouns: null,
    characterSlices: [
      { characterId: 'amy', characterName: 'Amy', text: 'I will bring the sextant.', contributingMessageIds: ['a1'], lastMessageCreatedAt: '2026-07-14T10:00:00.000Z' },
      { characterId: 'bob', characterName: 'Bob', text: 'I get seasick.', contributingMessageIds: ['b1'], lastMessageCreatedAt: '2026-07-14T10:01:00.000Z' },
    ],
    latestAssistantMessageId: 'b1',
    turnTimestamp: '2026-07-14T10:01:00.000Z',
  }
}

/** A model that answers SELF calls with two drafts and OTHER calls with one per subject. */
function scriptedModel(): void {
  mockExecute.mockImplementation(async (_sel, _msgs, _user, parse, taskType) => {
    const raw = taskType === 'memory-extraction-self'
      ? JSON.stringify([
          { content: 'I promised to bring the sextant.', summary: 'promised the sextant', importance: 0.8, keywords: ['sextant'] },
          { content: 'I dislike the sea.', summary: 'dislikes the sea', importance: 0.4 },
        ])
      : JSON.stringify([
          { subjectIndex: 1, content: 'They plan to sail tomorrow.', summary: 'plans to sail', importance: 0.6, kind: 'episodic', when: 'tomorrow' },
          { subjectIndex: 2, content: 'They are nervous about the trip.', summary: 'nervous about the trip', importance: 0.5 },
        ])
    return { success: true, result: parse(raw), usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } } as never
  })
}

/** Admission as a pure function of the candidate, so live and dry run see the same decisions. */
function deterministicAdmission(): void {
  let n = 0
  mockAdmit.mockImplementation(async (candidate, _resolved, opts) => {
    const reinforce = candidate.importance < 0.5
    const action = reinforce ? { kind: 'reinforce' as const, into: 'existing-1' } : { kind: 'insert' as const }
    return {
      action,
      memory: opts?.dryRun && !reinforce ? null : ({ id: reinforce ? 'existing-1' : `new-${++n}` } as never),
      novelDetails: [],
      linkedIds: [],
      trace: { assessments: [], notes: [] } as never,
    } as AdmissionOutcome
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('dry run equals live (invariant 10)', () => {
  it('produces the same candidates and decisions for a turn; only the dry run asks admission not to write', async () => {
    scriptedModel()
    deterministicAdmission()
    const live = await runTurnPasses(makeExtractionContext({ seats: [AMY, BOB, CHARLIE] }), transcript())
    const liveCalls = mockAdmit.mock.calls.map(c => [c[0], c[1]])
    expect(mockAdmit.mock.calls.every(c => !c[2]?.dryRun)).toBe(true)

    mockAdmit.mockClear()
    const dry = await runTurnPasses(makeExtractionContext({ seats: [AMY, BOB, CHARLIE], dryRun: true }), transcript())
    const dryCalls = mockAdmit.mock.calls.map(c => [c[0], c[1]])
    expect(mockAdmit.mock.calls.every(c => c[2]?.dryRun === true)).toBe(true)

    expect(dryCalls).toEqual(liveCalls)
    expect(dry.admitted.map(toExtractedCandidate)).toEqual(live.admitted.map(toExtractedCandidate))
    expect(live.admitted.length).toBeGreaterThan(0)
    // Only the live run reports written ids.
    expect(live.createdIds.length).toBeGreaterThan(0)
    expect(dry.createdIds).toEqual([])
    expect(dry.reinforcedIds).toEqual([])
  })

  it('produces the same candidates for a fold, and moves only the dry run\'s in-memory cursor', async () => {
    mockExecute.mockImplementation(async (_s, _m, _u, parse) => ({
      success: true,
      result: parse(JSON.stringify([{ subjectIndex: 1, content: 'Amy keeps the charts.', summary: 'keeps the charts', importance: 0.7 }])),
    }) as never)
    deterministicAdmission()
    const messages = [
      seatMessage('m1', AMY, 'I keep the charts.', '2026-07-14T09:00:00.000Z'),
      seatMessage('m2', BOB, 'Good, I cannot read them.', '2026-07-14T09:01:00.000Z'),
    ]
    const liveCtx = makeExtractionContext({ seats: [AMY, BOB], messages, mode: { otherPass: 'fold' } })
    const dryCtx = makeExtractionContext({ seats: [AMY, BOB], messages, mode: { otherPass: 'fold' }, dryRun: true })
    const live = await runFoldPass(liveCtx, 'other-fold', { windowMessages: messages })
    const dry = await runFoldPass(dryCtx, 'other-fold', { windowMessages: messages })
    expect(dry.admitted.map(toExtractedCandidate)).toEqual(live.admitted.map(toExtractedCandidate))
    expect((await dryCtx.cursors.read('other-fold')).afterMessageId).toBe('m2')
  })
})

describe('the rate limit is a live counter', () => {
  it('skips a holder once the inserts of this unit of work reach the hourly cap', async () => {
    scriptedModel()
    deterministicAdmission()
    // Amy has 19 of 20 this hour: past the soft start (14), so throttled at 0.7.
    const ctx = makeExtractionContext({
      seats: [AMY, BOB, CHARLIE],
      limits: { enabled: true, maxPerHour: 20, softStartFraction: 0.7, softFloor: 0.7 },
      recentAdmissions: { amy: 19, bob: 0 },
    })
    const result = await runTurnPasses(ctx, transcript())
    const amyAdmissions = mockAdmit.mock.calls.filter(c => c[0].subject.holderId === 'amy')
    // SELF: throttled at 0.7 → only the 0.8 draft, which inserts (19 → 20); OTHER: now at the cap → skipped.
    expect(amyAdmissions).toHaveLength(1)
    expect(amyAdmissions[0][0].summary).toBe('promised the sextant')
    expect(result.debugLogs.some(l => l.includes('SKIPPED extraction for Amy'))).toBe(true)
    // Bob, far from the cap, is untouched.
    expect(mockAdmit.mock.calls.filter(c => c[0].subject.holderId === 'bob').length).toBeGreaterThan(1)
  })

  it('makes no call for a holder already at the cap', async () => {
    scriptedModel()
    deterministicAdmission()
    const ctx = makeExtractionContext({
      seats: [AMY, CHARLIE],
      limits: { enabled: true, maxPerHour: 5, softStartFraction: 0.7, softFloor: 0.7 },
      recentAdmissions: { amy: 5 },
    })
    const t = transcript()
    t.characterSlices = [t.characterSlices[0]]
    await runTurnPasses(ctx, t)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockAdmit).not.toHaveBeenCalled()
  })
})

describe('caps', () => {
  it('honours the event slot at fold grain, and clamps the fold cap by the output budget', async () => {
    const drafts = [
      { subjectIndex: 1, content: 'A', summary: 'a', importance: 0.6 },
      { subjectIndex: 1, content: 'B', summary: 'b', importance: 0.6 },
      { subjectIndex: 1, content: 'On July 14th they sailed to Lighthouse Point.', summary: 'sailed', importance: 0.6, kind: 'episodic', when: '2026-07-14', entities: ['Lighthouse Point'] },
      { subjectIndex: 1, content: 'D', summary: 'd', importance: 0.6 },
    ]
    mockExecute.mockImplementation(async (_s, _m, _u, parse) => ({ success: true, result: parse(JSON.stringify(drafts)) }) as never)
    deterministicAdmission()
    const messages = [
      seatMessage('m1', AMY, 'Shall we?', '2026-07-14T09:00:00.000Z'),
      seatMessage('m2', BOB, 'We shall.', '2026-07-14T09:01:00.000Z'),
    ]
    // Budget 16000 → cap min(3, 2) = 2, plus the event slot → 3 per subject.
    const ctx = makeExtractionContext({ seats: [AMY, BOB], messages, mode: { otherPass: 'fold', foldCandidatesPerSubject: 3 }, maxTokens: 16000 })
    await runFoldPass(ctx, 'other-fold', { windowMessages: messages })
    const amyAboutBob = mockAdmit.mock.calls.filter(c => c[0].subject.holderId === 'amy')
    expect(amyAboutBob.map(c => c[0].summary)).toEqual(['a', 'b', 'sailed'])
  })
})
