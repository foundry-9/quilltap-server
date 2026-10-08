/**
 * Recall tuning (lib/memory/recall-tuning.ts) — the R1–R6 knobs of the recall
 * multiplier retuning, and the R1/R2 arithmetic in combineRecallMultipliers.
 *
 * The load-bearing claim is the first describe block: with no tuning, or the
 * default tuning, recall is byte-identical to the code before the knobs
 * existed. Everything the probe-set sweep measures is relative to that.
 */

import {
  DEFAULT_RECALL_TUNING,
  RecallTuningInputSchema,
  describeRecallTuning,
  resolveRecallTuning,
  selectSpecificAnchors,
} from '../recall-tuning'
import {
  RECALL_MULTIPLIERS,
  RECALL_TUNING_DEFAULTS,
  MULTIPLIER_CLAMP,
  boostGateStrength,
  boostGateThreshold,
  combineRecallMultipliers,
  type RecallContext,
} from '../recall-tags'

const NOW = Date.parse('2026-10-08T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

const ctx = (over: Partial<RecallContext> = {}): RecallContext => ({
  currentProjectId: 'proj-a',
  scopePolicy: 'down-weight',
  turnContext: 'information',
  presentAboutCharacterIds: ['char-present'],
  currentChatId: 'chat-here',
  nowMs: NOW,
  ...over,
})

/** A memory that collects every boost: narrow same-project, context, present, fresh24. */
const boosted = {
  id: 'm-boosted',
  projectId: 'proj-a',
  keywords: ['scope: narrow', 'information', 'present'],
  aboutCharacterId: 'char-present',
  createdAt: new Date(NOW - 2 * HOUR).toISOString(),
  chatId: 'chat-elsewhere',
}

const MEMORIES = [
  boosted,
  { ...boosted, id: 'm-past', keywords: ['scope: narrow', 'information', 'past'] },
  { ...boosted, id: 'm-moment-old', keywords: ['moment', 'banter'], createdAt: '2026-01-01T00:00:00.000Z' },
  { ...boosted, id: 'm-cross', projectId: 'proj-b', keywords: ['scope: narrow'] },
  { id: 'm-bare', keywords: [], createdAt: '2026-05-01T00:00:00.000Z' },
  { ...boosted, id: 'm-fresh48', createdAt: new Date(NOW - 30 * HOUR).toISOString() },
]

/** The pre-retuning ranking, expressed as a tuning input. */
const LEGACY = {
  boostGateAbs: 0,
  boostGateMargin: 0,
  boostCap: MULTIPLIER_CLAMP.max,
  multipliers: { freshEvent24h: 1.6, freshEvent48h: 1.35 },
  specificAnchors: false,
}

describe('the retuned defaults', () => {
  it('resolves no input, and an empty input, to the default tuning', () => {
    expect(resolveRecallTuning()).toBe(DEFAULT_RECALL_TUNING)
    expect(resolveRecallTuning({})).toEqual(DEFAULT_RECALL_TUNING)
  })

  it('are the values the probe-set sweep chose (cap14)', () => {
    expect(DEFAULT_RECALL_TUNING).toEqual({
      multipliers: { ...RECALL_MULTIPLIERS },
      boostGate: { abs: 0.45, margin: 0.15, ramp: 0.1 },
      boostCap: 1.4,
      freshBypassesGate: false,
      windowBypassesGate: false,
      specificAnchors: true,
      anchorMinHits: 1,
      anchorOrder: 'rarest',
      backgroundReserve: 0,
    })
    expect(RECALL_MULTIPLIERS.freshEvent24h).toBe(1.3)
    expect(RECALL_MULTIPLIERS.freshEvent48h).toBe(1.15)
    expect(DEFAULT_RECALL_TUNING).toMatchObject(RECALL_TUNING_DEFAULTS)
  })

  it.each([false, true])('apply when a context carries no tuning (retrospective %s)', retro => {
    for (const memory of MEMORIES) {
      for (const relevance of [{ cosine: 0.31, bestCosine: 0.64 }, { cosine: 0.6, bestCosine: 0.64 }]) {
        const plain = combineRecallMultipliers(memory, ctx({ turnRetrospective: retro }), relevance)
        const tuned = combineRecallMultipliers(memory, ctx({ turnRetrospective: retro, tuning: DEFAULT_RECALL_TUNING }), relevance)
        expect(tuned).toEqual(plain)
      }
    }
  })

  it.each([false, true])('the legacy tuning reproduces the pre-retuning product (retrospective %s)', retro => {
    const legacy = resolveRecallTuning(LEGACY)
    expect(legacy.boostGate).toBeNull()
    for (const memory of MEMORIES) {
      const r = combineRecallMultipliers(memory, ctx({ turnRetrospective: retro, tuning: legacy }), { cosine: 0.31, bestCosine: 0.64 })
      expect(r.fired.some(f => f.startsWith('gate') || f.startsWith('cap'))).toBe(false)
    }
    const top = combineRecallMultipliers(boosted, ctx({ tuning: legacy }))
    expect(top.multiplier).toBeCloseTo(
      RECALL_MULTIPLIERS.scopeNarrowSameProject * RECALL_MULTIPLIERS.contextMatch * RECALL_MULTIPLIERS.participantPresent * 1.6,
    )
  })
})

describe('resolveRecallTuning', () => {
  it('fills an absent gate term from the default and turns a 0 term off', () => {
    expect(resolveRecallTuning({ boostGateAbs: 0.5 }).boostGate).toEqual({ abs: 0.5, margin: 0.15, ramp: 0.1 })
    expect(resolveRecallTuning({ boostGateAbs: 0.45, boostGateMargin: 0, boostGateRamp: 0 }).boostGate).toEqual({
      abs: 0.45,
      margin: null,
      ramp: 0,
    })
    expect(resolveRecallTuning({ boostGateAbs: 0, boostGateMargin: 0.15 }).boostGate).toEqual({
      abs: null,
      margin: 0.15,
      ramp: 0.1,
    })
  })

  it('treats 0 and null gate constants as off', () => {
    expect(resolveRecallTuning({ boostGateAbs: 0, boostGateMargin: null, boostGateRamp: 0.1 }).boostGate).toBeNull()
  })

  it('merges multiplier overrides over the defaults', () => {
    const t = resolveRecallTuning({ multipliers: { freshEvent24h: 1.3, freshEvent48h: 1.15 } })
    expect(t.multipliers.freshEvent24h).toBe(1.3)
    expect(t.multipliers.freshEvent48h).toBe(1.15)
    expect(t.multipliers.participantPresent).toBe(RECALL_MULTIPLIERS.participantPresent)
  })
})

describe('RecallTuningInputSchema', () => {
  it('accepts the spec’s full candidate', () => {
    const parsed = RecallTuningInputSchema.safeParse({
      boostGateAbs: 0.45,
      boostGateMargin: 0.15,
      boostGateRamp: 0.1,
      boostCap: 1.6,
      multipliers: { freshEvent24h: 1.3, freshEvent48h: 1.15 },
      specificAnchors: true,
      backgroundReserve: 0.33,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects unknown keys at the top level and inside multipliers', () => {
    expect(RecallTuningInputSchema.safeParse({ boostGateMarginX: 0.1 }).success).toBe(false)
    expect(RecallTuningInputSchema.safeParse({ multipliers: { freshEvent12h: 2 } }).success).toBe(false)
  })

  it('rejects a background reserve over half the head', () => {
    expect(RecallTuningInputSchema.safeParse({ backgroundReserve: 0.6 }).success).toBe(false)
  })
})

describe('the R1 gate', () => {
  const gate = { abs: 0.45, margin: 0.15, ramp: 0.1 }

  it('sits at the larger of the floor and best − margin', () => {
    expect(boostGateThreshold(gate, 0.511)).toBeCloseTo(0.45)
    expect(boostGateThreshold(gate, 0.644)).toBeCloseTo(0.494)
    expect(boostGateThreshold({ abs: null, margin: 0.15, ramp: 0 }, 0.5)).toBeCloseTo(0.35)
    expect(boostGateThreshold({ abs: 0.4, margin: null, ramp: 0 }, 0.9)).toBeCloseTo(0.4)
  })

  it('keeps boosts in full above the gate and fades them to nothing over the ramp', () => {
    expect(boostGateStrength(gate, 0.5, 0.511)).toBe(1)
    expect(boostGateStrength(gate, 0.4, 0.511)).toBeCloseTo(0.5)
    expect(boostGateStrength(gate, 0.35, 0.511)).toBe(0)
    expect(boostGateStrength(gate, 0.2, 0.511)).toBe(0)
  })

  it('is a hard step when the ramp is 0', () => {
    const step = { abs: 0.45, margin: null, ramp: 0 }
    expect(boostGateStrength(step, 0.45, 0.6)).toBe(1)
    expect(boostGateStrength(step, 0.449, 0.6)).toBe(0)
  })
})

describe('combineRecallMultipliers under tuning', () => {
  const tuning = resolveRecallTuning({ boostGateAbs: 0.45, boostGateMargin: 0.15, boostGateRamp: 0.1 })

  it('strips the boosts from a candidate below the gate', () => {
    const r = combineRecallMultipliers(boosted, ctx({ tuning }), { cosine: 0.33, bestCosine: 0.511 })
    expect(r.multiplier).toBe(1)
    expect(r.fired).toContain('gate×0.00')
  })

  it('keeps half the boost halfway down the ramp', () => {
    const full = combineRecallMultipliers(boosted, ctx()).multiplier
    const r = combineRecallMultipliers(boosted, ctx({ tuning }), { cosine: 0.4, bestCosine: 0.511 })
    expect(r.multiplier).toBeCloseTo(1 + (full - 1) * 0.5)
  })

  it('applies penalties in full whatever the gate says', () => {
    const past = { ...boosted, keywords: ['scope: narrow', 'information', 'past'] }
    const r = combineRecallMultipliers(past, ctx({ tuning }), { cosine: 0.2, bestCosine: 0.6 })
    expect(r.multiplier).toBeCloseTo(RECALL_MULTIPLIERS.temporalPast)
  })

  it('caps the product of boosts', () => {
    const capped = resolveRecallTuning({ boostCap: 1.6 })
    const r = combineRecallMultipliers(boosted, ctx({ tuning: capped }))
    expect(r.multiplier).toBeCloseTo(1.6)
    expect(r.fired).toContain('cap1.6')
  })

  it('reads overridden multipliers', () => {
    const softer = resolveRecallTuning({ boostCap: 4, multipliers: { freshEvent24h: 1.3 } })
    const r = combineRecallMultipliers(boosted, ctx({ tuning: softer }))
    expect(r.multiplier).toBeCloseTo(
      RECALL_MULTIPLIERS.scopeNarrowSameProject * RECALL_MULTIPLIERS.contextMatch * RECALL_MULTIPLIERS.participantPresent * 1.3,
    )
  })

  it('can leave the fresh boost outside the gate', () => {
    const bypass = resolveRecallTuning({
      boostGateAbs: 0.45,
      boostGateMargin: 0.15,
      boostGateRamp: 0.1,
      freshBypassesGate: true,
    })
    const r = combineRecallMultipliers(boosted, ctx({ tuning: bypass }), { cosine: 0.33, bestCosine: 0.69 })
    // The narrow/context/present boosts are stripped; fresh24 stays in full.
    expect(r.multiplier).toBeCloseTo(RECALL_MULTIPLIERS.freshEvent24h)
    expect(r.fired).toContain('gate×0.00')
  })

  it('can leave the time-window boost outside the gate too', () => {
    const window = { from: new Date(NOW - 3 * HOUR).toISOString(), to: new Date(NOW).toISOString() }
    const both = resolveRecallTuning({
      boostGateAbs: 0.45,
      boostGateMargin: 0.15,
      boostCap: 4,
      freshBypassesGate: true,
      windowBypassesGate: true,
    })
    const r = combineRecallMultipliers(boosted, ctx({ tuning: both, occurredWithin: window }), {
      cosine: 0.3,
      bestCosine: 0.69,
    })
    expect(r.multiplier).toBeCloseTo(RECALL_MULTIPLIERS.freshEvent24h * RECALL_MULTIPLIERS.occurredWithinWindow)
  })

  it('still caps the total when fresh bypasses the gate', () => {
    const bypass = resolveRecallTuning({ boostGateAbs: 0.45, boostCap: 1.4, freshBypassesGate: true })
    const r = combineRecallMultipliers(boosted, ctx({ tuning: bypass }), { cosine: 0.6, bestCosine: 0.6 })
    expect(r.multiplier).toBeCloseTo(1.4)
  })

  it('leaves a gated row with only a fresh boost untouched under the bypass', () => {
    const freshOnly = { id: 'f', keywords: [], createdAt: boosted.createdAt, chatId: 'chat-elsewhere' }
    const bypass = resolveRecallTuning({ boostGateAbs: 0.45, freshBypassesGate: true })
    const noContext = { turnContext: null }
    const r = combineRecallMultipliers(freshOnly, ctx({ ...noContext, tuning: bypass }), { cosine: 0.2, bestCosine: 0.6 })
    expect(r).toEqual(combineRecallMultipliers(freshOnly, ctx(noContext)))
  })

  it('gates only when told the candidate’s relevance', () => {
    const r = combineRecallMultipliers(boosted, ctx({ tuning }))
    expect(r).toEqual(combineRecallMultipliers(boosted, ctx()))
  })
})

describe('selectSpecificAnchors (R4)', () => {
  it('drops present participants and zero-hit names, then prefers the rarest', () => {
    const chosen = selectSpecificAnchors(
      [
        { phrase: 'Amy', count: 1749 },
        { phrase: 'Marie', count: 115 },
        { phrase: 'Prospero', count: 96 },
        { phrase: 'Steinway', count: 0 },
        { phrase: 'Tessarium', count: 29 },
      ],
      ['amy', 'Marie'],
    )
    expect(chosen).toEqual(['Tessarium', 'Prospero'])
  })

  it('keeps the distiller’s order on ties and stops at the maximum', () => {
    const chosen = selectSpecificAnchors(
      [
        { phrase: 'A', count: 5 },
        { phrase: 'B', count: 5 },
        { phrase: 'C', count: 1 },
        { phrase: 'D', count: 5 },
      ],
      [],
    )
    expect(chosen).toEqual(['C', 'A', 'B'])
  })
})

describe('selectSpecificAnchors — minimum hits and order', () => {
  // F2's names, as the probe-set replay counted them.
  const f2 = [
    { phrase: 'Mochi', count: 7 },
    { phrase: 'Feline Duchy', count: 2 },
    { phrase: 'Ariel Stars', count: 10 },
    { phrase: 'Arnold', count: 1 },
    { phrase: 'Jefferson City', count: 2 },
  ]

  it('skips names below the minimum before ranking the rest by rarity', () => {
    expect(selectSpecificAnchors(f2, [], 3, { minHits: 3 })).toEqual(['Mochi', 'Ariel Stars'])
  })

  it('keeps the distiller’s order when asked', () => {
    expect(selectSpecificAnchors(f2, [], 3, { order: 'distiller' })).toEqual(['Mochi', 'Feline Duchy', 'Ariel Stars'])
  })

  it('still drops present names and zero-hit names in distiller order', () => {
    const b = [
      { phrase: 'Amy', count: 1749 },
      { phrase: 'Steinway', count: 0 },
      { phrase: 'Tessarium', count: 29 },
      { phrase: 'Prospero', count: 96 },
    ]
    expect(selectSpecificAnchors(b, ['Amy'], 3, { order: 'distiller' })).toEqual(['Tessarium', 'Prospero'])
  })
})

describe('describeRecallTuning', () => {
  it('says "defaults" when nothing changed and lists only what did', () => {
    expect(describeRecallTuning(DEFAULT_RECALL_TUNING)).toBe('defaults')
    expect(describeRecallTuning(resolveRecallTuning({}))).toBe('defaults')
    expect(
      describeRecallTuning(resolveRecallTuning({ boostGateMargin: 0.1, boostCap: 1.6, multipliers: { freshEvent24h: 1.45 } })),
    ).toBe('gate abs=0.45 margin=0.1 ramp=0.1, cap=1.6, freshEvent24h=1.45')
    expect(describeRecallTuning(resolveRecallTuning(LEGACY))).toBe(
      'gate off, cap=4, freshEvent24h=1.6, freshEvent48h=1.35, specificAnchors=false',
    )
  })
})
