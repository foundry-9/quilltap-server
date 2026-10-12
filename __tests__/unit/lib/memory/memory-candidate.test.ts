/**
 * The memory candidate (memory refactor §3.2, Phase A): one shape for every
 * producer. Each producer's candidate round-trips through the schema, and the
 * row the writer builds from it carries the targeting tags in its keywords
 * exactly as `parseTargetingTags` reads them back.
 */

jest.mock('@/lib/memory/memory-service', () => ({ createMemoryWithGate: jest.fn() }))
jest.mock('@/lib/memory/time/calendar-refresh', () => ({ refreshMemoryTimeZone: jest.fn(async () => 'UTC') }))

import {
  MemoryCandidateSchema,
  candidateFromDraft,
  toCreateMemoryOptions,
  normaliseTargeting,
  splitTargetingKeywords,
  targetingKeywords,
  coerceImportance,
  DEFAULT_TARGETING,
  type MemoryCandidate,
} from '@/lib/memory/candidate'
import { parseTargetingTags } from '@/lib/memory/recall-tags'
import { normalizeDigestKeywords } from '@/lib/memory/consolidation-plan'
import { writeCandidate } from '@/lib/memory/memory-processor'
import { createMemoryWithGate } from '@/lib/memory/memory-service'

const HOLDER = 'char-holder'
const OTHER = 'char-other'

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
  const row = toCreateMemoryOptions(candidate, { occurredAt: null, narrativeTime: null })
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

  it('per-turn SELF/OTHER: the draft becomes the gate input, a model 0 stays 0', async () => {
    ;(createMemoryWithGate as jest.Mock).mockResolvedValue({ action: 'INSERT', memory: { id: 'm1' } })
    const draft = {
      content: 'Amy is afraid of the dark.',
      summary: 'Amy fears the dark',
      keywords: ['dark'],
      importance: 0,
      targeting: { temporal: 'present', scope: 'wide', context: 'relationships' } as const,
      kind: 'semantic' as const,
    }
    await writeCandidate({
      characterId: HOLDER,
      characterName: 'Holly',
      aboutCharacterId: OTHER,
      aboutCharacterName: 'Amy',
      pass: 'OTHER',
      candidate: draft,
      passLabel: 'test',
      ctx: { chatId: 'chat-1', userId: 'u1', projectId: 'proj-1', transcript: { turnTimestamp: '2026-10-12T19:00:00.000Z' } },
      sourceMessageId: 'msg-1',
      sourceMessageCreatedAt: '2026-10-12T19:00:00.000Z',
      timeZone: 'UTC',
      debugLogs: [],
      createdIds: [],
      reinforcedIds: [],
      collected: [],
    })
    const input = (createMemoryWithGate as jest.Mock).mock.calls[0][0]
    expect(input).toMatchObject({
      characterId: HOLDER,
      aboutCharacterId: OTHER,
      projectId: 'proj-1',
      importance: 0,
      source: 'AUTO',
      witnessedContext: 'user_present',
      keywords: ['dark', 'present', 'scope: wide', 'relationships'],
    })

    roundTrip(candidateFromDraft(draft, { holderId: HOLDER, aboutId: OTHER }, provenance('other-turn')))
  })

  it('the dry run reports the same keywords and importance the live write sends', async () => {
    const collected: Array<{ keywords: string[]; importance: number }> = []
    await writeCandidate({
      characterId: HOLDER,
      characterName: 'Holly',
      aboutCharacterId: HOLDER,
      aboutCharacterName: 'Holly',
      pass: 'SELF',
      candidate: { content: 'I promised.', summary: 'promised', keywords: ['oath'], importance: 0, targeting: DEFAULT_TARGETING },
      passLabel: 'test',
      ctx: { chatId: 'chat-1', userId: 'u1', dryRun: true },
      sourceMessageId: null,
      sourceMessageCreatedAt: '2026-10-12T19:00:00.000Z',
      timeZone: 'UTC',
      debugLogs: [],
      createdIds: [],
      reinforcedIds: [],
      collected: collected as never,
    })
    expect(createMemoryWithGate).not.toHaveBeenCalled()
    expect(collected[0]).toMatchObject({ keywords: ['oath', 'present', 'scope: wide', 'information'], importance: 0 })
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
