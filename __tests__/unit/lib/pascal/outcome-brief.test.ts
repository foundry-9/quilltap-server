/**
 * Bug 257 — a consult that narrates a verdict the table has already reached.
 *
 * When no outcome row tests the consult, the table is dealt BEFORE the model
 * is asked, and the prompt may quote the winning row (`{{outcome.brief}}`,
 * `{{outcome.state}}`, `{{outcome.index}}`). When some row does test it, the
 * old order holds and `{{outcome.*}}` in the prompt is refused at load.
 */

import { executeCustomTool } from '@/lib/pascal/custom-tools'
import { QtapCustomToolSchema, type QtapCustomTool } from '@/lib/pascal/custom-tool.types'
import {
  definitionFromDraft,
  draftFromDefinition,
  reachableOutcomesMissingBrief,
  validateDraft,
} from '@/lib/pascal/tool-draft'
import { classifyPlaceholder } from '@/lib/pascal/placeholders'

function define(doc: unknown): QtapCustomTool {
  const result = QtapCustomToolSchema.safeParse(doc)
  if (!result.success) {
    throw new Error(`fixture is not a valid definition: ${result.error.issues.map((i) => i.message).join('; ')}`)
  }
  return result.data
}

const issuesOf = (doc: unknown): string[] => {
  const result = QtapCustomToolSchema.safeParse(doc)
  return result.success ? [] : result.error.issues.map((i) => i.message)
}

/** Scripted oracle that records the prompt it was posed. */
const scripted = (output = 'A report.') => {
  const calls: string[] = []
  const invoke = async (prompt: string) => {
    calls.push(prompt)
    return { ok: true as const, output, provider: 'test', model: 'scripted' }
  }
  return { calls, invoke }
}

const scanner = (overrides: Record<string, unknown> = {}) => ({
  name: 'entanglement_scan',
  description: 'Scan a shard for entanglement.',
  parameters: { layers: { type: 'number', default: 95 } },
  roll: { min: 1, max: 100 },
  llm: {
    prompt: 'Write a report. State: {{outcome.state}}, row {{outcome.index}}. Conclusion to reach: {{outcome.brief}}',
    errorMessage: 'The link falters.',
  },
  outcomes: [
    {
      when: { roll: { gte: { $param: 'layers' } } },
      message: '{{llm}}',
      state: 'success',
      brief: 'Confirmed at {{params.layers}} layers.',
    },
    { when: true, message: '{{llm}}', state: 'failure', brief: 'Not found.' },
  ],
  ...overrides,
})

describe('{{outcome.*}} placeholders', () => {
  it('classify the three fields and nothing else', () => {
    expect(classifyPlaceholder('outcome.brief')).toEqual({ kind: 'outcome', field: 'brief' })
    expect(classifyPlaceholder('outcome.state')).toEqual({ kind: 'outcome', field: 'state' })
    expect(classifyPlaceholder('outcome.index')).toEqual({ kind: 'outcome', field: 'index' })
    expect(classifyPlaceholder('outcome.verdict').kind).toBe('unknown')
    expect(classifyPlaceholder('outcome').kind).toBe('unknown')
  })
})

describe('executeCustomTool — table first when no row tests the consult', () => {
  it('tells the prompt the winning row, whichever way the roll fell', async () => {
    const low = scripted()
    const lowRun = await executeCustomTool(define(scanner({ roll: { min: 1, max: 1 } })), {}, { llmInvoke: low.invoke })
    expect(lowRun.state).toBe('failure')
    expect(low.calls).toEqual(['Write a report. State: failure, row 1. Conclusion to reach: Not found.'])

    const high = scripted()
    const highRun = await executeCustomTool(
      define(scanner({ roll: { min: 100, max: 100 } })),
      {},
      { llmInvoke: high.invoke }
    )
    expect(highRun.state).toBe('success')
    expect(high.calls).toEqual(['Write a report. State: success, row 0. Conclusion to reach: Confirmed at 95 layers.'])
  })

  it('renders the brief with the prompt’s own placeholders, with layers overridden', async () => {
    const oracle = scripted()
    await executeCustomTool(define(scanner({ roll: { min: 50, max: 50 } })), { layers: 10 }, { llmInvoke: oracle.invoke })
    expect(oracle.calls[0]).toContain('Confirmed at 10 layers.')
  })

  it('leaves a missing brief as written rather than inventing one', async () => {
    const oracle = scripted()
    const tool = define(
      scanner({
        roll: { min: 1, max: 1 },
        outcomes: [{ when: true, message: '{{llm}}', state: 'failure' }],
      })
    )
    await executeCustomTool(tool, {}, { llmInvoke: oracle.invoke })
    expect(oracle.calls[0]).toContain('{{outcome.brief}}')
  })

  it('lets messages and effects quote the outcome too', async () => {
    const tool = define(
      scanner({
        roll: { min: 1, max: 1 },
        effects: [{ log: 'Row {{outcome.index}} ({{outcome.state}}): {{outcome.brief}}' }],
        outcomes: [{ when: true, message: '{{llm}} [{{outcome.state}}]', state: 'failure', brief: 'Not found.' }],
      })
    )
    const run = await executeCustomTool(tool, {}, { llmInvoke: scripted('Report.').invoke })
    expect(run.message).toBe('Report. [failure]')
    expect(run.effects?.[0]).toMatchObject({ log: 'Row 0 (failure): Not found.' })
  })

  it('still consults after a silent provider, and the table keeps its verdict', async () => {
    const tool = define(scanner({ roll: { min: 1, max: 1 } }))
    const run = await executeCustomTool(tool, {}, {
      llmInvoke: async () => ({ ok: false as const, reason: 'down' }),
    })
    expect(run.state).toBe('failure')
    expect(run.message).toBe('The link falters.')
  })
})

describe('executeCustomTool — consult first when a row tests it', () => {
  const oracle = (prompt = 'Does the doorman wave it through? YES or NO.') =>
    define({
      name: 'forged_invitation',
      description: 'Present a forged invitation.',
      llm: { prompt, errorMessage: 'Silence.' },
      outcomes: [
        { when: { llm: { eq: 'YES' } }, message: 'In: {{llm}} ({{outcome.state}})', state: 'success' },
        { when: true, message: 'Out: {{llm}}', state: 'failure' },
      ],
    })

  it('keeps the old order: the answer picks the row', async () => {
    const run = await executeCustomTool(oracle(), {}, { llmInvoke: scripted('YES').invoke })
    expect(run.state).toBe('success')
    expect(run.message).toBe('In: YES (success)')
  })
})

describe('load-time rules', () => {
  it('accepts the narrator pattern', () => {
    expect(issuesOf(scanner())).toEqual([])
  })

  it('refuses {{outcome.*}} in a prompt whose table tests the consult', () => {
    const issues = issuesOf(
      scanner({
        outcomes: [
          { when: { llm: { contains: 'confirmed' } }, message: '{{llm}}', state: 'success', brief: 'x' },
          { when: true, message: '{{llm}}', state: 'failure' },
        ],
      })
    )
    expect(issues.join('\n')).toMatch(/outcome\.(brief|state|index)/)
    expect(issues.join('\n')).toMatch(/tests the consult's answer/)
  })

  it('refuses it for an ok-test too', () => {
    const issues = issuesOf(
      scanner({
        outcomes: [
          { when: { llm: { ok: false } }, message: '{{llm}}', state: 'failure' },
          { when: true, message: '{{llm}}', state: 'success' },
        ],
      })
    )
    expect(issues.length).toBeGreaterThan(0)
  })

  it('refuses a brief on a tool with no llm block', () => {
    const issues = issuesOf({
      name: 'plain',
      description: 'No consult here.',
      outcomes: [{ when: true, message: 'ok', state: 'info', brief: 'Say ok.' }],
    })
    expect(issues.join('\n')).toMatch(/no `llm` block/)
  })

  it('refuses a brief that quotes {{llm}} or {{outcome.*}}', () => {
    for (const brief of ['See {{llm}}', 'Row {{outcome.index}}']) {
      const issues = issuesOf(
        scanner({ outcomes: [{ when: true, message: '{{llm}}', state: 'info', brief }] })
      )
      expect(issues.join('\n')).toMatch(/written before the consult/)
    }
  })

  it('refuses an empty brief', () => {
    expect(
      issuesOf(scanner({ outcomes: [{ when: true, message: '{{llm}}', state: 'info', brief: '' }] })).length
    ).toBeGreaterThan(0)
  })
})

describe('the Workbench draft', () => {
  const draftOf = (doc: unknown) => draftFromDefinition(doc)!

  it('round-trips a brief, and omits a blank one', () => {
    const emitted = definitionFromDraft(draftOf(scanner())) as { outcomes: Array<{ brief?: string }> }
    expect(emitted.outcomes.map((o) => o.brief)).toEqual(['Confirmed at {{params.layers}} layers.', 'Not found.'])

    const blank = draftOf(scanner())
    blank.outcomes[0].brief = '  '
    const reEmitted = definitionFromDraft(blank) as { outcomes: Array<{ brief?: string }> }
    expect(reEmitted.outcomes[0]).not.toHaveProperty('brief')
  })

  it('is valid as written', () => {
    expect(validateDraft(draftOf(scanner())).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('warns about a row that has no brief when the prompt reads one', () => {
    const draft = draftOf(scanner())
    draft.outcomes[1].brief = ''
    const warnings = validateDraft(draft).filter((i) => i.severity === 'warning' && i.where.section === 'brief')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].where).toMatchObject({ id: draft.outcomes[1].id })
  })

  it('errors on {{outcome.*}} in the prompt when a row tests the consult', () => {
    // The loader refuses this document, so build the draft the way the form
    // would reach it: a valid tool, then a chip added to the first row.
    const draft = draftOf(scanner())
    draft.outcomes[0].conditions.push({
      id: 'c-llm',
      subject: { kind: 'llm' },
      comparator: 'eq',
      operand: { kind: 'string', text: 'YES' },
    })
    const errors = validateDraft(draft).filter((i) => i.severity === 'error' && i.where.section === 'llm')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].message).toMatch(/table cannot be dealt before the consult/)
  })

  it('warns when the prompt asks the model to compare numbers', () => {
    for (const prompt of [
      'If {{roll}} >= {{params.layers}}, report success.',
      'Report entangled when {{value}} < 40.',
      'You must actually do the math here.',
    ]) {
      const draft = draftOf(
        scanner({ llm: { prompt, errorMessage: 'x' }, outcomes: [{ when: true, message: '{{llm}}', state: 'info' }] })
      )
      const messages = validateDraft(draft)
        .filter((i) => i.severity === 'warning' && i.where.section === 'llm')
        .map((i) => i.message)
      expect(messages.join('\n')).toMatch(/compare numbers/)
    }
  })

  it('does not warn for a prompt that merely quotes a figure', () => {
    const draft = draftOf(
      scanner({
        llm: { prompt: 'Write a report on a scan of depth {{params.layers}}. Tone: clinical.', errorMessage: 'x' },
        outcomes: [{ when: true, message: '{{llm}}', state: 'info' }],
      })
    )
    const advice = validateDraft(draft).filter((i) => i.where.section === 'llm')
    expect(advice).toEqual([])
  })

  it('flags, from the audit, reachable rows without a brief', () => {
    const draft = draftOf(scanner())
    draft.outcomes[0].brief = ''
    const hits = [
      { index: 0, hits: 12 },
      { index: 1, hits: 988 },
    ]
    expect(reachableOutcomesMissingBrief(draft, hits)).toEqual([0])
    // an unreachable row is not nagged about
    expect(reachableOutcomesMissingBrief(draft, [{ index: 0, hits: 0 }, { index: 1, hits: 1000 }])).toEqual([])
    // a prompt that reads no brief has nothing to miss
    draft.llmPrompt = 'Write a report.'
    expect(reachableOutcomesMissingBrief(draft, hits)).toEqual([])
  })
})
