/**
 * Operator intervention — recompute (spec Part 3). Pure and table-driven: the
 * same engine, replaying the recorded draw and the consult in use, with the
 * operator's pins.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

import { executeCustomTool, type LlmConsultResult } from '@/lib/pascal/custom-tools'
import { QtapCustomToolSchema } from '@/lib/pascal/custom-tool.types'
import { changedFields, factsOf, presentationFor, recomputeRun, type RunSnapshot } from '@/lib/pascal/intervention/recompute'
import { checkOverrides } from '@/lib/pascal/intervention/overrides'

const SNAPSHOT: RunSnapshot = {
  params: null,
  private: undefined,
  metadata: {},
  progress: {},
  now: 1_000,
  character: 'Mira',
  state: {},
  inventory: null,
}

const RANGE = QtapCustomToolSchema.parse({
  name: 'pick',
  description: 'Pick the lock.',
  intervention: { enabled: true },
  parameters: { top: { type: 'number', default: 10, min: 1, max: 100 } },
  roll: { min: 0, max: { $param: 'top' } },
  outcomes: [
    { when: { gte: 5 }, message: 'Open at {{value}}.', state: 'success' },
    { when: true, message: 'Still locked at {{value}}.', state: 'failure' },
  ],
  effects: [
    { when: { outcome: { eq: 'success' } }, target: 'state.opened', value: 'true' },
    { log: '{{character}} tried the lock.' },
  ],
})

const DICE = QtapCustomToolSchema.parse({
  name: 'hit',
  description: 'Swing.',
  intervention: { enabled: true },
  roll: '2d6+1',
  outcomes: [
    { when: { gte: 10 }, message: 'Hit: {{dice}}', state: 'success' },
    { when: true, message: 'Miss: {{dice}}', state: 'failure' },
  ],
})

describe('replay, not reroll', () => {
  it('keeps the unit draw when a parameter moves the range', async () => {
    const run = await recomputeRun({ definition: RANGE, snapshot: SNAPSHOT, draw: { form: 'range', unit: 0.9 }, overrides: {} })
    expect(run.result.raw).toBeCloseTo(9)
    const wider = await recomputeRun({
      definition: RANGE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.9 },
      overrides: { params: { top: 50 } },
    })
    expect(wider.result.raw).toBeCloseTo(45)
  })

  it('keeps a pinned roll through a parameter change', async () => {
    const run = await recomputeRun({
      definition: RANGE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.9 },
      overrides: { params: { top: 50 }, roll: 2 },
    })
    expect(run.result.raw).toBe(2)
    expect(run.result.state).toBe('failure')
  })

  it('clamps a parameter and says so', async () => {
    const run = await recomputeRun({
      definition: RANGE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.5 },
      overrides: { params: { top: 500 } },
    })
    expect(run.result.params.top).toBe(100)
    expect(run.clampedParams).toEqual(['top'])
  })

  it('records the draw it used on an ordinary run', async () => {
    const run = await executeCustomTool(RANGE, null)
    expect(run.draw.form).toBe('range')
    const dice = await executeCustomTool(DICE, null)
    expect(dice.draw).toEqual({ form: 'dice', faces: dice.diceRolls })
  })

  it('replays dice faces, clamps pinned faces, and re-renders {{dice}} from them', async () => {
    const replay = await recomputeRun({ definition: DICE, snapshot: SNAPSHOT, draw: { form: 'dice', faces: [2, 3] }, overrides: {} })
    expect(replay.result.value).toBe(6)
    expect(replay.result.message).toBe('Miss: 2d6+1: [2, 3] + 1 = 6')
    const pinned = await recomputeRun({ definition: DICE, snapshot: SNAPSHOT, draw: { form: 'dice', faces: [2, 3] }, overrides: { dice: [9, 6] } })
    expect(pinned.result.diceRolls).toEqual([6, 6])
    expect(pinned.result.value).toBe(13)
    expect(pinned.result.message).toBe('Hit: 2d6+1: [6, 6] + 1 = 13')
  })
})

describe('the outcome, message and effects', () => {
  it('forces a row whatever the table says, and notes it when the odds are shown', async () => {
    const run = await recomputeRun({ definition: RANGE, snapshot: SNAPSHOT, draw: { form: 'range', unit: 0.1 }, overrides: { outcomeIndex: 0 } })
    expect(run.result.outcomeIndex).toBe(0)
    expect(run.result.message).toBe('Open at 1.')
    expect(run.result.tableOutcomeIndex).toBe(1)
    expect(run.warnings.some((w) => w.includes('row 2'))).toBe(true)
  })

  it('takes a pinned message literally', async () => {
    const run = await recomputeRun({
      definition: RANGE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.1 },
      overrides: { message: 'Exactly {{value}} as written.' },
    })
    expect(run.result.message).toBe('Exactly {{value}} as written.')
  })

  it('fires, suppresses and literally edits effects', async () => {
    const auto = await recomputeRun({ definition: RANGE, snapshot: SNAPSHOT, draw: { form: 'range', unit: 0.1 }, overrides: {} })
    expect(auto.result.effects?.[0]).toMatchObject({ skipped: 'condition did not hold' })

    const forced = await recomputeRun({
      definition: RANGE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.1 },
      overrides: { effects: { '0': { mode: 'on', value: '{{value}}' }, '1': { mode: 'off' } } },
    })
    expect(forced.result.effects?.[0]).toMatchObject({ value: '{{value}}' })
    expect(forced.result.effects?.[1]).toMatchObject({ skipped: 'switched off for this run' })

    const relogged = await recomputeRun({
      definition: RANGE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.1 },
      overrides: { effects: { '1': { mode: 'auto', log: 'Nobody touched {{it}}.' } } },
    })
    expect(relogged.result.effects?.[1]).toMatchObject({ log: 'Nobody touched {{it}}.' })
  })

  it('presents the definition\'s defaults unless overridden', async () => {
    const run = await recomputeRun({
      definition: RANGE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.1 },
      overrides: { title: 'The Lock', announcer: 'character', visibility: 'whisper' },
    })
    expect(run.presentation).toEqual({ title: 'The Lock', announcer: 'character', visibility: 'whisper' })
  })
})

describe('the consult', () => {
  const ORACLE = QtapCustomToolSchema.parse({
    name: 'oracle',
    description: 'Ask.',
    intervention: { enabled: true },
    parameters: { topic: { type: 'string', default: 'rain' } },
    llm: { prompt: 'Will it {{params.topic}}?', errorMessage: 'Silence.' },
    outcomes: [
      { when: { llm: { eq: 'YES' } }, message: 'Yes: {{llm}}', state: 'success' },
      { when: true, message: 'No: {{llm}}', state: 'failure' },
    ],
  })
  const DEALT_FIRST = QtapCustomToolSchema.parse({
    name: 'teller',
    description: 'Tell.',
    intervention: { enabled: true },
    parameters: { topic: { type: 'string', default: 'rain' } },
    llm: { prompt: 'Describe {{params.topic}}: {{outcome.state}}', errorMessage: 'Silence.' },
    outcomes: [{ when: true, message: '{{llm}}', state: 'info' }],
  })
  const consult: LlmConsultResult = { ok: true, output: 'YES', prompt: 'Will it rain?' }

  it('never calls a model: the consult in use stands in (consult first)', async () => {
    const llmInvoke = jest.fn()
    const run = await executeCustomTool(ORACLE, null, { draw: { form: 'range', unit: 0.5 }, consult, llmInvoke })
    expect(llmInvoke).not.toHaveBeenCalled()
    expect(run.outcomeIndex).toBe(0)
  })

  it('marks an answer out of date when an upstream change alters the prompt (consult first)', async () => {
    const same = await recomputeRun({ definition: ORACLE, snapshot: SNAPSHOT, draw: { form: 'range', unit: 0.5 }, consult, overrides: {} })
    expect(same.staleAnswer).toBe(false)
    const moved = await recomputeRun({
      definition: ORACLE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.5 },
      consult,
      overrides: { params: { topic: 'snow' } },
    })
    expect(moved.staleAnswer).toBe(true)
    expect(moved.promptNow).toBe('Will it snow?')
  })

  it('marks an answer out of date when a forced row changes a dealt-first prompt', async () => {
    const original: LlmConsultResult = { ok: true, output: 'Drizzle.', prompt: 'Describe rain: info' }
    const run = await recomputeRun({
      definition: DEALT_FIRST,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.5 },
      consult: original,
      overrides: { params: { topic: 'hail' } },
    })
    expect(run.staleAnswer).toBe(true)
    expect(run.result.message).toBe('Drizzle.')
  })

  it('a pinned answer re-picks the row and is never out of date', async () => {
    const run = await recomputeRun({
      definition: ORACLE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.5 },
      consult,
      overrides: { llmAnswer: { ok: true, output: 'NO' }, params: { topic: 'snow' } },
    })
    expect(run.result.outcomeIndex).toBe(1)
    expect(run.staleAnswer).toBe(false)
  })
})

describe('checkOverrides', () => {
  const HIDDEN = QtapCustomToolSchema.parse({
    ...RANGE,
    intervention: { enabled: true, fields: { roll: false } },
    parameters: { top: { type: 'number', default: 10, intervene: false } },
  })

  it('refuses an override naming a hidden field or member', () => {
    expect(checkOverrides(HIDDEN, { rollForm: 'range' }, { roll: 3 })).toMatch(/roll/)
    expect(checkOverrides(HIDDEN, { rollForm: 'range' }, { params: { top: 3 } })).toMatch(/top/)
    expect(checkOverrides(HIDDEN, { rollForm: 'range' }, { outcomeIndex: 0 })).toBeNull()
  })

  it('refuses shapes the run was not dealt in', () => {
    expect(checkOverrides(DICE, { rollForm: 'dice', diceCount: 2 }, { roll: 3 })).not.toBeNull()
    expect(checkOverrides(DICE, { rollForm: 'dice', diceCount: 2 }, { dice: [1, 2, 3] })).not.toBeNull()
    expect(checkOverrides(DICE, { rollForm: 'dice', diceCount: 2 }, { value: 3 })).not.toBeNull()
    expect(checkOverrides(DICE, { rollForm: 'dice', diceCount: 2 }, { outcomeIndex: 9 })).not.toBeNull()
  })
})

describe('changedFields', () => {
  it('names what differs between the run as dealt and as announced', async () => {
    const dealt = await recomputeRun({ definition: RANGE, snapshot: SNAPSHOT, draw: { form: 'range', unit: 0.1 }, overrides: {} })
    const final = await recomputeRun({
      definition: RANGE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.1 },
      overrides: { outcomeIndex: 0, title: 'The Lock' },
    })
    const changed = changedFields(
      factsOf(RANGE, dealt.result, presentationFor(RANGE, dealt.result.visibility)),
      factsOf(RANGE, final.result, final.presentation),
    )
    expect(changed).toEqual(expect.arrayContaining(['outcome', 'message', 'state', 'title', 'effects.0']))
    expect(changed).not.toContain('roll')
    expect(changedFields(factsOf(RANGE, dealt.result, dealt.presentation), factsOf(RANGE, dealt.result, dealt.presentation))).toEqual([])
  })
})

describe('what the run could have been', () => {
  const ranged = (roll: Record<string, unknown>) =>
    QtapCustomToolSchema.parse({
      name: 'span',
      description: 'Span.',
      intervention: { enabled: true },
      roll,
      outcomes: [{ when: true, message: '{{value}}', state: 'info' }],
    })

  it('reports the half-open draw and follows it through a $param bound', async () => {
    const run = await recomputeRun({
      definition: RANGE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.5 },
      overrides: { params: { top: 50 } },
    })
    expect(run.result.rollSpan).toEqual({ min: 0, max: 50, maxExclusive: true })
    expect(run.result.valueSpan).toEqual({ min: 0, max: 50, maxExclusive: true })
  })

  it('carries the span through multiply, offset and round', async () => {
    const result = await executeCustomTool(ranged({ min: 1, max: 21, multiplier: 2, offset: 3, round: true }), {})
    expect(result.rollSpan).toEqual({ min: 1, max: 21, maxExclusive: true })
    // 1*2+3 = 5 reachable; just under 21*2+3 = 45 rounds to 45.
    expect(result.valueSpan).toEqual({ min: 5, max: 45 })
  })

  it('does not let a half on the open end round up into reach', async () => {
    const result = await executeCustomTool(ranged({ min: 0, max: 10, offset: 0.5, round: true }), {})
    // Values reach just under 10.5, which rounds to 10, never 11.
    expect(result.valueSpan).toEqual({ min: 1, max: 10 })
  })

  it('swaps the ends, and the open one, under a negative multiplier', async () => {
    const result = await executeCustomTool(ranged({ min: 1, max: 21, multiplier: -2 }), {})
    expect(result.valueSpan).toEqual({ min: -42, max: -2, minExclusive: true })
  })

  it('gives dice their total from all-ones to all-sides', async () => {
    const result = await executeCustomTool(DICE, {})
    expect(result.rollSpan).toEqual({ min: 3, max: 13 })
    expect(result.valueSpan).toEqual({ min: 3, max: 13 })
  })

  it('warns when a pin lands outside what the table could deal', async () => {
    const run = await recomputeRun({
      definition: RANGE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.5 },
      overrides: { roll: 12, value: -1 },
    })
    expect(run.warnings).toContain('The pinned draw lies outside what the table could deal (0 up to (not including) 10).')
    expect(run.warnings).toContain('The pinned value lies outside what the modifiers could reach (0 up to (not including) 10).')
    const inside = await recomputeRun({
      definition: RANGE,
      snapshot: SNAPSHOT,
      draw: { form: 'range', unit: 0.5 },
      overrides: { roll: 9.9 },
    })
    expect(inside.warnings).toEqual([])
  })
})
