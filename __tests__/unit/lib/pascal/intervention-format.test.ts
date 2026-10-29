/**
 * Operator intervention — the definition format (spec Part 1): the
 * `intervention` block, the per-member `intervene` flags, which fields a run
 * may show, and the Workbench draft round trip.
 */

import { QtapCustomToolSchema } from '@/lib/pascal/custom-tool.types'
import { interventionEligibility, isIntervenable } from '@/lib/pascal/intervention/eligibility'
import { definitionFromDraft, draftFromDefinition, newDraft } from '@/lib/pascal/tool-draft'

const BASE = {
  name: 'probe',
  description: 'A probe.',
  outcomes: [{ when: true, message: '-', state: 'info' }],
}

describe('the intervention block', () => {
  it('accepts an enabled block, with or without field flags', () => {
    expect(QtapCustomToolSchema.safeParse({ ...BASE, intervention: { enabled: true } }).success).toBe(true)
    expect(
      QtapCustomToolSchema.safeParse({ ...BASE, intervention: { enabled: true, fields: { roll: false, value: false } } }).success,
    ).toBe(true)
  })

  it('rejects an empty block as ambiguous', () => {
    expect(QtapCustomToolSchema.safeParse({ ...BASE, intervention: {} }).success).toBe(false)
  })

  it('rejects an unknown field key', () => {
    expect(QtapCustomToolSchema.safeParse({ ...BASE, intervention: { enabled: true, fields: { dice: false } } }).success).toBe(false)
  })

  it('accepts and ignores flags on a tool that is not intervenable', () => {
    const parsed = QtapCustomToolSchema.parse({
      ...BASE,
      intervention: { enabled: false, fields: { llmAnswer: false } },
      parameters: { bonus: { type: 'number', default: 0, intervene: false } },
    })
    expect(isIntervenable(parsed)).toBe(false)
    expect(parsed.parameters?.bonus.intervene).toBe(false)
  })

  it('keeps an effect flag through the schema', () => {
    const parsed = QtapCustomToolSchema.parse({ ...BASE, effects: [{ target: 'state.n', value: 1, intervene: false }] })
    expect(parsed.effects?.[0].intervene).toBe(false)
  })
})

describe('interventionEligibility', () => {
  const definition = QtapCustomToolSchema.parse({
    ...BASE,
    chipLabel: 'Probe {{value}}',
    intervention: { enabled: true, fields: { message: false } },
    parameters: {
      bonus: { type: 'number', default: 0 },
      secret: { type: 'string', default: 'x', intervene: false },
    },
    llm: { prompt: 'Speak.', errorMessage: 'Silence.' },
    effects: [{ target: 'state.a', value: 1 }, { target: 'state.b', value: 2, intervene: false }],
  })

  it('shows every applicable field except those flagged false', () => {
    const eligible = interventionEligibility(definition, 'range')
    expect(eligible.fields).toEqual([
      'roll', 'value', 'llmPrompt', 'llmAnswer', 'outcome', 'state', 'chipLabel', 'title', 'visibility', 'announcer',
    ])
    expect(eligible.params).toEqual(['bonus'])
    expect(eligible.effects).toEqual([0])
  })

  it('has no separately editable value for dice', () => {
    expect(interventionEligibility(definition, 'dice').fields).not.toContain('value')
  })

  it('offers no consult or chip label fields a tool does not have', () => {
    const plain = QtapCustomToolSchema.parse({ ...BASE, intervention: { enabled: true } })
    const fields = interventionEligibility(plain, 'range').fields
    expect(fields).not.toContain('llmPrompt')
    expect(fields).not.toContain('llmAnswer')
    expect(fields).not.toContain('chipLabel')
  })
})

describe('the Workbench draft', () => {
  it('round-trips every flag', () => {
    const raw = {
      ...BASE,
      intervention: { enabled: true, fields: { roll: false, announcer: false } },
      parameters: { bonus: { type: 'number', default: 0, intervene: false }, plain: { type: 'number', default: 1 } },
      effects: [{ target: 'state.n', value: 1, intervene: false }, { log: 'A line.' }],
    }
    const draft = draftFromDefinition(raw)
    expect(draft).not.toBeNull()
    const doc = definitionFromDraft(draft!)
    expect(doc.intervention).toEqual({ enabled: true, fields: { roll: false, announcer: false } })
    expect((doc.parameters as Record<string, { intervene?: boolean }>).bonus.intervene).toBe(false)
    expect((doc.parameters as Record<string, { intervene?: boolean }>).plain.intervene).toBeUndefined()
    expect((doc.effects as Array<{ intervene?: boolean }>)[0].intervene).toBe(false)
    expect((doc.effects as Array<{ intervene?: boolean }>)[1].intervene).toBeUndefined()
    expect(QtapCustomToolSchema.safeParse(doc).success).toBe(true)
  })

  it('keeps a switched-off block, and the author\'s choices, through a round trip', () => {
    const draft = draftFromDefinition({ ...BASE, intervention: { enabled: false, fields: { roll: false } } })!
    expect(definitionFromDraft(draft).intervention).toEqual({ enabled: false, fields: { roll: false } })
  })

  it('writes no block for a new tool', () => {
    expect(newDraft().intervention.enabled).toBe(false)
    const draft = { ...newDraft(), name: 'fresh', description: 'Fresh.' }
    expect(definitionFromDraft(draft).intervention).toBeUndefined()
  })
})
