/**
 * The memory candidate (memory refactor §3.2, Phase A): one shape for every
 * producer. Each producer's candidate round-trips through the schema, and the
 * row the writer builds from it carries the targeting tags in its keywords
 * exactly as `parseTargetingTags` reads them back.
 */

jest.mock('@/lib/memory/admission', () => require('../../../helpers/admission-mock').admissionModuleMock())
jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({ executeCheapLLMTask: jest.fn() }))
jest.mock('@/lib/memory/time/calendar-refresh', () => ({ refreshMemoryTimeZone: jest.fn(async () => 'UTC') }))

import {
  MemoryCandidateSchema,
  candidateFromDraft,
  toAdmissionRow,
  normaliseTargeting,
  splitTargetingKeywords,
  targetingKeywords,
  coerceImportance,
  anchorTimeMsFrom,
  DEFAULT_TARGETING,
  type MemoryCandidate,
} from '@/lib/memory/candidate'
import { parseTargetingTags } from '@/lib/memory/recall-tags'
import { normalizeDigestKeywords } from '@/lib/memory/consolidation-plan'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { runPass } from '@/lib/memory/extraction/run'
import { selfTurnPass } from '@/lib/memory/extraction/passes/self-turn'
import { otherTurnPass } from '@/lib/memory/extraction/passes/other-turn'
import { turnWindow } from '@/lib/memory/extraction/window'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import { makeExtractionContext, type TestContextOptions } from '../../../helpers/extraction-context'
import { mockAdmitRow, admissionOutcome } from '../../../helpers/admission-mock'

const HOLDER = 'char-holder'
const OTHER = 'char-other'

const TURN_TIME = '2026-10-12T19:00:00.000Z'

/** Holly speaks one slice this turn; Amy speaks too, so Holly's OTHER call has Amy as subject 1. */
function transcript(lastMessageCreatedAt: string | null = TURN_TIME): TurnTranscript {
  return {
    turnOpenerMessageId: null,
    userMessage: null,
    characterSlices: [
      { characterId: HOLDER, characterName: 'Holly', characterPronouns: null, text: 'I promised.', contributingMessageIds: ['msg-1'], lastMessageCreatedAt },
      { characterId: OTHER, characterName: 'Amy', characterPronouns: null, text: 'I fear the dark.', contributingMessageIds: ['msg-2'], lastMessageCreatedAt: TURN_TIME },
    ],
    latestAssistantMessageId: 'msg-2',
    turnTimestamp: TURN_TIME,
  }
}

function ctxFor(opts: TestContextOptions = {}) {
  return makeExtractionContext({
    seats: [{ characterId: HOLDER, name: 'Holly' }, { characterId: OTHER, name: 'Amy' }],
    userId: 'u1',
    mode: { otherPass: 'turn' },
    ...opts,
  })
}

/** The model answers Holly's call (and only hers) with `items`. */
function modelAnswers(items: unknown[]): void {
  jest.mocked(executeCheapLLMTask).mockImplementation(async (_s, _m, _u, parse, _t, _c, _x, _f, _max, characterId) => ({
    success: true,
    result: parse(JSON.stringify(characterId === HOLDER ? items : [])),
  }) as never)
}

const provenance = (pass: MemoryCandidate['provenance']['pass'], source: 'AUTO' | 'MANUAL' = 'AUTO') => ({
  source,
  witnessedContext: source === 'MANUAL' ? ('manual' as const) : ('user_present' as const),
  chatId: 'chat-1',
  projectId: null,
  sourceMessageId: 'msg-1',
  anchorTimeMs: Date.parse('2026-10-12T19:00:00.000Z'),
  pass,
})

function roundTrip(candidate: MemoryCandidate) {
  // Parsing a parsed candidate changes nothing.
  expect(MemoryCandidateSchema.parse(candidate)).toEqual(candidate)
  const row = toAdmissionRow(candidate, { occurredAt: null, narrativeTime: null })
  expect(row.characterId).toBe(candidate.subject.holderId)
  expect(row.aboutCharacterId).toBe(candidate.subject.aboutId)
  expect(row.source).toBe(candidate.provenance.source)
  expect(row.importance).toBe(candidate.importance)
  // The row's keywords: the free words, then the tags — read back unchanged.
  expect(parseTargetingTags(row.keywords ?? [])).toEqual(candidate.targeting ?? DEFAULT_TARGETING)
  expect(splitTargetingKeywords(row.keywords ?? []).free).toEqual(candidate.keywords)
  return row
}

describe('targeting', () => {
  it('normalises against the closed vocabularies, with fallbacks', () => {
    expect(normaliseTargeting({ temporal: 'PAST', scope: ' narrow ', context: 'gossip' })).toEqual({
      temporal: 'past',
      scope: 'narrow',
      context: 'information',
    })
    expect(normaliseTargeting(null, { temporal: 'past' })).toEqual({ ...DEFAULT_TARGETING, temporal: 'past' })
  })

  it('materialises and splits symmetrically', () => {
    const t = { temporal: 'moment', scope: 'narrow', context: 'banter' } as const
    expect(targetingKeywords(t)).toEqual(['moment', 'scope: narrow', 'banter'])
    expect(splitTargetingKeywords(['Harbour', ...targetingKeywords(t)])).toEqual({ free: ['Harbour'], targeting: t })
  })
})

describe('importance: the parser default is the only default', () => {
  it.each([
    [0, 0],
    [0.73, 0.73],
    [5, 1],
    [-1, 0],
    [undefined, 0.5],
    ['0.9', 0.5],
    [Number.NaN, 0.5],
  ])('%p → %p', (raw, expected) => {
    expect(coerceImportance(raw)).toBe(expected)
  })
})

describe('producers', () => {
  beforeEach(() => jest.clearAllMocks())

  it('per-turn SELF/OTHER: the draft becomes the admitted row, a model 0 stays 0', async () => {
    mockAdmitRow.mockResolvedValue(admissionOutcome('insert', { id: 'm1' }))
    const draft = {
      content: 'Amy is afraid of the dark.',
      summary: 'Amy fears the dark',
      keywords: ['dark'],
      importance: 0,
      targeting: { temporal: 'present', scope: 'wide', context: 'relationships' } as const,
      kind: 'semantic' as const,
    }
    modelAnswers([{ subjectIndex: 1, ...draft, ...draft.targeting }])
    const result = await runPass(otherTurnPass(), ctxFor({ projectId: 'proj-1' }), turnWindow(transcript()))

    expect(mockAdmitRow).toHaveBeenCalledTimes(1)
    const input = mockAdmitRow.mock.calls[0][0]
    expect(input).toMatchObject({
      characterId: HOLDER,
      aboutCharacterId: OTHER,
      projectId: 'proj-1',
      importance: 0,
      source: 'AUTO',
      witnessedContext: 'user_present',
      keywords: ['dark', 'present', 'scope: wide', 'relationships'],
      sourceMessageId: 'msg-1',
      sourceMessageTimestamp: TURN_TIME,
    })
    expect(result.admitted[0].candidate.provenance.pass).toBe('other-turn')

    roundTrip(candidateFromDraft(draft, { holderId: HOLDER, aboutId: OTHER }, provenance('other-turn'))!)
  })

  it('the dry run reports the same keywords and importance the live write sends', async () => {
    mockAdmitRow.mockResolvedValue(admissionOutcome('insert', { id: 'm1' }))
    modelAnswers([{ content: 'I promised.', summary: 'promised', keywords: ['oath'], importance: 0 }])

    const live = await runPass(selfTurnPass(), ctxFor(), turnWindow(transcript()))
    const dry = await runPass(selfTurnPass(), ctxFor({ dryRun: true }), turnWindow(transcript()))

    expect(mockAdmitRow).toHaveBeenCalledTimes(2)
    const [[liveRow, liveOpts], [dryRow, dryOpts]] = mockAdmitRow.mock.calls
    expect(liveOpts).toEqual({ userId: 'u1' })
    // The dry run asks admission to decide only; the row it would write is the live one.
    expect(dryOpts).toEqual({ userId: 'u1', dryRun: true })
    expect(dryRow).toEqual(liveRow)
    expect(dryRow).toMatchObject({ keywords: ['oath', 'present', 'scope: wide', 'information'], importance: 0 })
    expect(dry.admitted.map(a => a.candidate)).toEqual(live.admitted.map(a => a.candidate))
    expect(dry.createdIds).toEqual([])
    expect(live.createdIds).toEqual(['m1'])
  })

  it('fold episode: past / narrow / history, about nobody in particular', () => {
    const candidate = MemoryCandidateSchema.parse({
      content: 'They went down to the cellar and found the crates.',
      summary: 'the cellar expedition',
      keywords: ['cellar', 'crates'],
      targeting: { temporal: 'past', scope: 'narrow', context: 'history' },
      importance: 0.7,
      kind: 'episodic',
      when: 'last night',
      entities: ['Cellar', 'Crates'],
      subject: { holderId: HOLDER, aboutId: null },
      provenance: provenance('episode-fold'),
    })
    const row = roundTrip(candidate)
    expect(row.keywords).toEqual(['cellar', 'crates', 'past', 'scope: narrow', 'history'])
    expect(row.kind).toBe('episodic')
  })

  it('manual: no targeting tags are written, and the row reads as the defaults', () => {
    const candidate = MemoryCandidateSchema.parse({
      content: 'Holly prefers tea.',
      summary: 'prefers tea',
      keywords: ['tea'],
      targeting: null,
      importance: 0.6,
      kind: 'semantic',
      when: null,
      subject: { holderId: HOLDER, aboutId: null },
      provenance: provenance('manual', 'MANUAL'),
    })
    const row = roundTrip(candidate)
    expect(row.keywords).toEqual(['tea'])
    expect(row.witnessedContext).toBe('manual')
  })

  it('consolidation: a digest\'s keywords normalise through the same targeting rules', () => {
    const keywords = normalizeDigestKeywords(
      ['Harbour', 'harbour', 'SCOPE: narrow', 'banter'],
      [['present', 'scope: wide', 'history'], ['past', 'scope: wide', 'history']],
      'semantic',
    )
    expect(keywords).toEqual(['harbour', 'present', 'scope: narrow', 'banter'])
    const { free, targeting } = splitTargetingKeywords(keywords)
    roundTrip(
      MemoryCandidateSchema.parse({
        content: 'A digest.',
        summary: 'digest',
        keywords: free,
        targeting: normaliseTargeting(targeting),
        importance: 0.8,
        kind: 'semantic',
        when: null,
        subject: { holderId: HOLDER, aboutId: OTHER },
        provenance: provenance('consolidation'),
      }),
    )
  })

  it('a blank draft is not a candidate, and skips alone rather than aborting the turn', async () => {
    expect(candidateFromDraft({ content: '   ' }, { holderId: HOLDER, aboutId: null }, provenance('self-turn'))).toBeNull()
    // Blank content with a usable summary falls back to the summary.
    expect(
      candidateFromDraft({ content: '  ', summary: 'kept' }, { holderId: HOLDER, aboutId: null }, provenance('self-turn'))
        ?.content,
    ).toBe('kept')

    // A blank draft from the model skips alone; the next draft is still admitted.
    mockAdmitRow.mockResolvedValue(admissionOutcome('insert', { id: 'm1' }))
    modelAnswers([
      { content: '   ', importance: 0.5 },
      { content: 'I promised.', summary: 'promised', importance: 0.5 },
    ])
    const result = await runPass(selfTurnPass(), ctxFor({ dryRun: true }), turnWindow(transcript()))
    expect(result.debugLogs.join('\n')).toContain('skipped a draft with no usable text')
    expect(result.admitted).toHaveLength(1)
    expect(result.admitted[0].candidate.summary).toBe('promised')
    expect(mockAdmitRow).toHaveBeenCalledTimes(1)
  })

  it('an empty or malformed source timestamp falls through to the next anchor', () => {
    expect(anchorTimeMsFrom(['', 'not a date', '2026-10-12T19:00:00.000Z'])).toBe(Date.parse('2026-10-12T19:00:00.000Z'))
    expect(anchorTimeMsFrom([null, undefined, ''], 42)).toBe(42)
  })

  it('a slice with no source time anchors on the turn timestamp', async () => {
    mockAdmitRow.mockResolvedValue(admissionOutcome('insert', { id: 'm1' }))
    modelAnswers([{ content: 'I promised.', summary: 'promised', importance: 0.5 }])
    const result = await runPass(selfTurnPass(), ctxFor({ dryRun: true }), turnWindow(transcript(null)))
    expect(result.admitted).toHaveLength(1)
    expect(result.admitted[0].occurredAt).toBe(TURN_TIME)
    expect(mockAdmitRow.mock.calls[0][0].sourceMessageTimestamp).toBe(TURN_TIME)
  })

  // An empty-string slice time is not nullish, so `??` in the turn passes keeps
  // it instead of falling to the turn timestamp; the anchor then defaults to
  // the wall clock. Flip to `it` when self-turn/other-turn use a validity check.
  it.failing('an empty slice source time still anchors on the turn timestamp', async () => {
    mockAdmitRow.mockResolvedValue(admissionOutcome('insert', { id: 'm1' }))
    modelAnswers([{ content: 'I promised.', summary: 'promised', importance: 0.5 }])
    const result = await runPass(selfTurnPass(), ctxFor({ dryRun: true }), turnWindow(transcript('')))
    expect(result.admitted).toHaveLength(1)
    expect(result.admitted[0].occurredAt).toBe(TURN_TIME)
  })

  it('refuses a candidate with no text or an out-of-range importance', () => {
    const base = {
      content: 'x',
      summary: 'x',
      targeting: null,
      importance: 0.5,
      kind: 'semantic',
      when: null,
      subject: { holderId: HOLDER, aboutId: null },
      provenance: provenance('manual', 'MANUAL'),
    }
    expect(MemoryCandidateSchema.safeParse({ ...base, content: '' }).success).toBe(false)
    expect(MemoryCandidateSchema.safeParse({ ...base, importance: 1.2 }).success).toBe(false)
    expect(MemoryCandidateSchema.safeParse(base).success).toBe(true)
  })
})
