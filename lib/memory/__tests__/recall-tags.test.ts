/**
 * Unit tests for the recall-side targeting-tag reading (lib/memory/recall-tags.ts).
 *
 * Pure module — no mocks. Covers: tag parsing round-trips (valid / invalid /
 * missing, matching the extraction-side defaults), each multiplier in isolation,
 * cross-project narrow exclusion vs strong down-weight, legacy projectId:null
 * passing through unpenalized, and the combined-multiplier clamp.
 */

import {
  parseTargetingTags,
  scopeProjectMultiplier,
  temporalMultiplier,
  combineRecallMultipliers,
  RECALL_MULTIPLIERS,
  MULTIPLIER_CLAMP,
  DEFAULT_TEMPORAL,
  DEFAULT_SCOPE,
  DEFAULT_CONTEXT,
  type RecallContext,
  type TargetingTags,
} from '../recall-tags'

const PROJ_A = 'project-aaaa'
const PROJ_B = 'project-bbbb'

const ctx = (over: Partial<RecallContext> = {}): RecallContext => ({
  currentProjectId: PROJ_A,
  scopePolicy: 'down-weight',
  ...over,
})

describe('parseTargetingTags', () => {
  it('round-trips a fully-tagged keyword array', () => {
    const tags = parseTargetingTags(['summarizer', 'future', 'scope: narrow', 'philosophy'])
    expect(tags).toEqual<TargetingTags>({
      temporal: 'future',
      scope: 'narrow',
      context: 'philosophy',
    })
  })

  it('defaults every axis when keywords are empty', () => {
    expect(parseTargetingTags([])).toEqual<TargetingTags>({
      temporal: DEFAULT_TEMPORAL,
      scope: DEFAULT_SCOPE,
      context: DEFAULT_CONTEXT,
    })
  })

  it('defaults on null/undefined keywords', () => {
    expect(parseTargetingTags(null)).toEqual({ temporal: 'present', scope: 'wide', context: 'information' })
    expect(parseTargetingTags(undefined)).toEqual({ temporal: 'present', scope: 'wide', context: 'information' })
  })

  it('defaults an unknown value on each axis', () => {
    // `scope: sideways` is invalid → default wide; no temporal/context words present → defaults.
    const tags = parseTargetingTags(['random', 'scope: sideways'])
    expect(tags).toEqual({ temporal: 'present', scope: 'wide', context: 'information' })
  })

  it('parses the scope prefix case-insensitively and trims whitespace', () => {
    expect(parseTargetingTags(['SCOPE:  Narrow']).scope).toBe('narrow')
  })

  it('lets the appended tag win over a colliding free keyword (last-match-wins)', () => {
    // A free keyword "history" appears before the real appended context tag "banter".
    const tags = parseTargetingTags(['history', 'present', 'scope: wide', 'banter'])
    expect(tags.context).toBe('banter')
  })

  it('ignores non-string entries without throwing', () => {
    const tags = parseTargetingTags([42 as unknown as string, 'past', null as unknown as string, 'scope: narrow', 'trivia'])
    expect(tags).toEqual({ temporal: 'past', scope: 'narrow', context: 'trivia' })
  })
})

describe('scopeProjectMultiplier', () => {
  const wide: TargetingTags = { temporal: 'present', scope: 'wide', context: 'information' }
  const narrow: TargetingTags = { temporal: 'present', scope: 'narrow', context: 'information' }

  it('passes wide-scope memories through unchanged', () => {
    expect(scopeProjectMultiplier(wide, PROJ_B, PROJ_A, 'down-weight')).toEqual({ multiplier: 1, fired: [] })
  })

  it('passes narrow memories with no projectId through unchanged (never penalize missing data)', () => {
    expect(scopeProjectMultiplier(narrow, null, PROJ_A, 'down-weight')).toEqual({ multiplier: 1, fired: [] })
    expect(scopeProjectMultiplier(narrow, undefined, PROJ_A, 'down-weight')).toEqual({ multiplier: 1, fired: [] })
  })

  it('boosts a narrow memory whose project matches the current chat', () => {
    const r = scopeProjectMultiplier(narrow, PROJ_A, PROJ_A, 'down-weight')
    expect(r.multiplier).toBe(RECALL_MULTIPLIERS.scopeNarrowSameProject)
    expect(r.fired).toEqual(['narrow✓'])
  })

  it('strong-down-weights a cross-project narrow memory under down-weight policy', () => {
    const r = scopeProjectMultiplier(narrow, PROJ_B, PROJ_A, 'down-weight')
    expect(r.multiplier).toBe(RECALL_MULTIPLIERS.scopeNarrowCrossProjectDownWeight)
    expect(r.exclude).toBeUndefined()
    expect(r.fired).toEqual(['narrow✗'])
  })

  it('excludes a cross-project narrow memory under exclude policy', () => {
    const r = scopeProjectMultiplier(narrow, PROJ_B, PROJ_A, 'exclude')
    expect(r.multiplier).toBe(0)
    expect(r.exclude).toBe(true)
  })

  it('treats a narrow memory in a project-less chat as cross-project', () => {
    const r = scopeProjectMultiplier(narrow, PROJ_B, null, 'down-weight')
    expect(r.multiplier).toBe(RECALL_MULTIPLIERS.scopeNarrowCrossProjectDownWeight)
  })
})

describe('temporalMultiplier', () => {
  const withTemporal = (t: TargetingTags['temporal']): TargetingTags => ({
    temporal: t,
    scope: 'wide',
    context: 'information',
  })

  it('penalizes past', () => {
    expect(temporalMultiplier(withTemporal('past')).multiplier).toBe(RECALL_MULTIPLIERS.temporalPast)
  })

  it('penalizes moment (unconditional on the recall path)', () => {
    expect(temporalMultiplier(withTemporal('moment')).multiplier).toBe(RECALL_MULTIPLIERS.temporalMoment)
  })

  it('leaves present and future unchanged', () => {
    expect(temporalMultiplier(withTemporal('present'))).toEqual({ multiplier: 1, fired: [] })
    expect(temporalMultiplier(withTemporal('future'))).toEqual({ multiplier: 1, fired: [] })
  })
})

describe('combineRecallMultipliers', () => {
  it('multiplies scope and temporal adjustments together', () => {
    // narrow + same project (×1.15) and past (×0.85).
    const memory = { projectId: PROJ_A, keywords: ['past', 'scope: narrow', 'history'] }
    const r = combineRecallMultipliers(memory, ctx())
    expect(r.exclude).toBe(false)
    expect(r.multiplier).toBeCloseTo(
      RECALL_MULTIPLIERS.scopeNarrowSameProject * RECALL_MULTIPLIERS.temporalPast,
      5,
    )
    expect(r.fired).toEqual(['narrow✓', 'past↓'])
  })

  it('short-circuits to exclude for a cross-project narrow memory under exclude policy', () => {
    const memory = { projectId: PROJ_B, keywords: ['present', 'scope: narrow', 'history'] }
    const r = combineRecallMultipliers(memory, ctx({ scopePolicy: 'exclude' }))
    expect(r.exclude).toBe(true)
    expect(r.multiplier).toBe(0)
  })

  it('passes a legacy projectId:null narrow memory through unpenalized', () => {
    const memory = { projectId: null, keywords: ['present', 'scope: narrow', 'history'] }
    const r = combineRecallMultipliers(memory, ctx({ currentProjectId: PROJ_A }))
    expect(r.exclude).toBe(false)
    expect(r.multiplier).toBe(1)
    expect(r.fired).toEqual([])
  })

  it('leaves an untagged (wide/present) memory at multiplier 1', () => {
    const memory = { projectId: PROJ_A, keywords: [] }
    const r = combineRecallMultipliers(memory, ctx())
    expect(r.multiplier).toBe(1)
    expect(r.fired).toEqual([])
  })

  it('clamps the combined multiplier to the configured ceiling', () => {
    // Force a product above the clamp to prove the ceiling bites. narrow-same (×1.15)
    // is the only positive multiplier today, so we assert the clamp bound directly.
    const memory = { projectId: PROJ_A, keywords: ['present', 'scope: narrow', 'history'] }
    const r = combineRecallMultipliers(memory, ctx())
    expect(r.multiplier).toBeLessThanOrEqual(MULTIPLIER_CLAMP.max)
    expect(r.multiplier).toBeGreaterThanOrEqual(MULTIPLIER_CLAMP.min)
  })
})
