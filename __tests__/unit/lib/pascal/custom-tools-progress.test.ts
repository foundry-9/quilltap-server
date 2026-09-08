/**
 * Pascal and character progressions — reads and writes.
 *
 * A `progress` subject is metadata's twin, deliberately: it goes through the
 * SAME fail-soft comparison table, so what is tested here is not the ordering
 * ladder (that lives in the metadata suites) but the three things this family
 * adds — that the derived sheet is what a comparator actually sees, that a
 * gate answered before the deal can turn on it, and that an effect writing
 * `progress.<id>.<field>` lands inside the one character write, creating the
 * progression when nobody authored it and rolling itself back when the result
 * would not validate.
 */

import {
  QtapCustomToolSchema,
  formatDefinitionIssues,
  parseEffectTarget,
} from '@/lib/pascal/custom-tool.types'
import { executeCustomTool, matchesWhen, renderTemplate } from '@/lib/pascal/custom-tools'
import { evaluateToolGate } from '@/lib/pascal/tool-gate'
import { collectToolVocabulary } from '@/lib/pascal/tool-vocabulary'
import { classifyPlaceholder } from '@/lib/pascal/placeholders'
import { flattenProgressions, UNIT_MS } from '@/lib/progressions/engine'
import { parseProgressKey } from '@/lib/progressions/schema'

const START = Date.parse('2026-09-08T14:00:00Z')

/** A character carrying one ten-minute cannon recharge. */
const SHEET = {
  faction: 'Ordo Aurum',
  progressions: {
    cannon: {
      name: 'Cannon recharge',
      startTime: '2026-09-08T14:00:00Z',
      endTime: '2026-09-08T14:10:00Z',
      timeIncrement: 'minute',
      quantity: { total: 1.0, unit: 'MJ', precision: 1 },
    },
  },
}

const sheetAt = (nowMs: number) => flattenProgressions(SHEET, nowMs)

const BASE = {
  name: 'probe',
  description: 'A probe.',
  outcomes: [{ when: true, message: '-', state: 'info' }],
}

function define(partial: Record<string, unknown>) {
  return QtapCustomToolSchema.parse({ ...BASE, ...partial })
}

function rejection(doc: unknown): string {
  const result = QtapCustomToolSchema.safeParse(doc)
  if (result.success) throw new Error('expected the definition to be rejected, but it parsed')
  return formatDefinitionIssues(result.error)
}

const subjects = (progress: Record<string, number | string | boolean>) => ({
  value: 0.5,
  roll: 0.5,
  params: {},
  progress,
})

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

describe('classifyPlaceholder — the progress and now families', () => {
  it('splits progress.<id>.<field> at the FIRST dot', () => {
    expect(classifyPlaceholder('progress.cannon.percent')).toEqual({
      kind: 'progress',
      id: 'cannon',
      field: 'percent',
    })
  })

  it('classifies now', () => {
    expect(classifyPlaceholder('now')).toEqual({ kind: 'now' })
  })

  it('leaves a half-written progress key unknown', () => {
    for (const key of ['progress.', 'progress.cannon', 'progress.cannon.', 'progress..percent']) {
      expect(classifyPlaceholder(key).kind).toBe('unknown')
    }
  })
})

// ---------------------------------------------------------------------------
// Reads — when.progress
// ---------------------------------------------------------------------------

describe('when.progress', () => {
  const holds = (when: unknown, nowMs: number) =>
    matchesWhen(
      define({ outcomes: [{ when, message: '-', state: 'info' }, { when: true, message: '-', state: 'info' }] })
        .outcomes[0].when,
      subjects(sheetAt(nowMs))
    )

  it('tests a boolean field', () => {
    expect(holds({ progress: { 'cannon.complete': { eq: true } } }, START + 11 * UNIT_MS.minute)).toBe(true)
    expect(holds({ progress: { 'cannon.complete': { eq: true } } }, START + UNIT_MS.minute)).toBe(false)
  })

  it('orders the uncapped percent', () => {
    expect(holds({ progress: { 'cannon.percent': { gte: 50 } } }, START + 5 * UNIT_MS.minute)).toBe(true)
    expect(holds({ progress: { 'cannon.percent': { gte: 50 } } }, START + 4 * UNIT_MS.minute)).toBe(false)
    // Past the end, percent keeps climbing — Pascal sees the overrun.
    expect(holds({ progress: { 'cannon.percent': { gt: 100 } } }, START + 11 * UNIT_MS.minute)).toBe(true)
  })

  it('orders remainingMs, which goes negative when overdue', () => {
    expect(holds({ progress: { 'cannon.remainingMs': { lt: 0 } } }, START + 11 * UNIT_MS.minute)).toBe(true)
    expect(holds({ progress: { 'cannon.remainingMs': { lt: 0 } } }, START + UNIT_MS.minute)).toBe(false)
  })

  it('orders startTime and endTime as epoch milliseconds', () => {
    expect(holds({ progress: { 'cannon.endTime': { gt: START } } }, START)).toBe(true)
  })

  it('compares the state string', () => {
    expect(holds({ progress: { 'cannon.state': { eq: 'active' } } }, START + UNIT_MS.minute)).toBe(true)
    expect(holds({ progress: { 'cannon.state': { eq: 'active' } } }, START - UNIT_MS.minute)).toBe(false)
  })

  it('declines fail-soft for a progression the character does not carry', () => {
    expect(holds({ progress: { 'zeppelin.complete': { eq: true } } }, START)).toBe(false)
  })

  it('declines fail-soft for a field that does not exist', () => {
    expect(holds({ progress: { 'cannon.trimester': { eq: 2 } } }, START)).toBe(false)
  })

  it('declines fail-soft when the sheet is empty — the catch-all answers', () => {
    expect(
      matchesWhen(
        define({
          outcomes: [
            { when: { progress: { 'cannon.complete': { eq: true } } }, message: '-', state: 'info' },
            { when: true, message: '-', state: 'info' },
          ],
        }).outcomes[0].when,
        subjects({})
      )
    ).toBe(false)
  })

  it('declines rather than throwing when a comparator orders a string field', () => {
    expect(holds({ progress: { 'cannon.state': { gt: 1 } } }, START + UNIT_MS.minute)).toBe(false)
  })

  it('ANDs with the other subjects on the same row', () => {
    const when = { gt: 0.4, progress: { 'cannon.complete': { eq: false } } }
    expect(holds(when, START + UNIT_MS.minute)).toBe(true)
    expect(holds(when, START + 11 * UNIT_MS.minute)).toBe(false)
  })

  it('resolves a $param operand against the run’s parameters', () => {
    const definition = define({
      parameters: { threshold: { type: 'number', default: 50 } },
      outcomes: [
        { when: { progress: { 'cannon.percent': { gte: { $param: 'threshold' } } } }, message: '-', state: 'info' },
        { when: true, message: '-', state: 'info' },
      ],
    })
    const at = (nowMs: number, threshold: number) =>
      matchesWhen(definition.outcomes[0].when, {
        value: 0.5,
        roll: 0.5,
        params: { threshold },
        progress: sheetAt(nowMs),
      })
    expect(at(START + 5 * UNIT_MS.minute, 50)).toBe(true)
    expect(at(START + 5 * UNIT_MS.minute, 80)).toBe(false)
  })
})

describe('the progress subject at load time', () => {
  const withWhen = (when: unknown) =>
    define({
      outcomes: [{ when, message: '-', state: 'info' }, { when: true, message: '-', state: 'info' }],
    })

  it('accepts a well-shaped key', () => {
    expect(() => withWhen({ progress: { 'cannon.complete': { eq: true } } })).not.toThrow()
  })

  it('rejects a key that is not "<id>.<field>", naming the offending key', () => {
    // Zod reports a record-key failure as "Invalid key in record" rather than
    // the regex's own message, so the assertion is on the verdict and on the
    // path — which is what actually tells an author WHICH key they got wrong.
    for (const key of ['cannon', 'Cannon.complete', 'cannon.', '.complete', 'cannon.complete.extra']) {
      const message = rejection({
        ...BASE,
        outcomes: [
          { when: { progress: { [key]: { eq: true } } }, message: '-', state: 'info' },
          { when: true, message: '-', state: 'info' },
        ],
      })
      expect(message).toContain(`progress.${key}`)
    }
  })

  it('counts a non-empty progress block as testing something', () => {
    expect(() => withWhen({ progress: { 'cannon.complete': { eq: true } } })).not.toThrow()
    // An EMPTY one does not — a row that tests nothing is a catch-all in disguise.
    expect(() =>
      withWhen({ progress: {} })
    ).toThrow()
  })
})

/**
 * The one parser behind both the load-time schema and the Workbench's
 * condition validator. It exists so the progression-identifier rule lives in a
 * single place — it used to be written out three times, which is exactly how
 * two of them drift.
 *
 * Its per-mistake messages reach an author through the Workbench (and any
 * other direct caller). They do NOT reach one through `when.progress`: Zod
 * reports a record-KEY failure as its own "Invalid key in record" and discards
 * the refinement's message, so there the path names the offending key instead.
 * Asserted here rather than assumed, so nobody later "fixes" the schema to
 * surface a message it cannot surface.
 */
describe('parseProgressKey', () => {
  it('splits a well-formed key', () => {
    expect(parseProgressKey('cannon.complete')).toEqual({ ok: true, id: 'cannon', field: 'complete' })
  })

  it('splits at the FIRST dot, so a dotted field is the field', () => {
    expect(parseProgressKey('cannon.a.b')).toMatchObject({ ok: false })
  })

  it('says specifically that no field was named', () => {
    const parsed = parseProgressKey('cannon')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toContain('names no field')
  })

  it('says specifically that the id is not an id', () => {
    const parsed = parseProgressKey('Cannon.complete')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toContain('not a progression id')
  })

  it('rejects an empty id and an empty field', () => {
    expect(parseProgressKey('.complete').ok).toBe(false)
    expect(parseProgressKey('cannon.').ok).toBe(false)
  })

  it('agrees with the schema on every specimen', () => {
    // The two must never diverge — that is the whole point of the shared
    // parser, and this is the assertion that keeps it true.
    for (const key of ['cannon.complete', 'a.b', 'cannon', 'Cannon.complete', 'cannon.', '.complete', 'a.b.c']) {
      const viaParser = parseProgressKey(key).ok
      const viaSchema = QtapCustomToolSchema.safeParse({
        ...BASE,
        outcomes: [
          { when: { progress: { [key]: { eq: true } } }, message: '-', state: 'info' },
          { when: true, message: '-', state: 'info' },
        ],
      }).success
      expect(viaSchema).toBe(viaParser)
    }
  })
})

// ---------------------------------------------------------------------------
// Reads — the availability gate
// ---------------------------------------------------------------------------

describe('evaluateToolGate with a progress subject', () => {
  const FIRE = { availableWhen: { progress: { 'cannon.complete': { eq: true } } } }

  it('withholds a weapon while it is charging and offers it once charged', () => {
    expect(evaluateToolGate(FIRE, {}, sheetAt(START + UNIT_MS.minute))).toEqual({
      available: false,
      withheldBy: 'availableWhen',
    })
    expect(evaluateToolGate(FIRE, {}, sheetAt(START + 11 * UNIT_MS.minute))).toEqual({ available: true })
  })

  it('fails CLOSED for a character carrying no progressions at all', () => {
    expect(evaluateToolGate(FIRE, {}, {}).available).toBe(false)
    expect(evaluateToolGate(FIRE, {}).available).toBe(false)
    expect(evaluateToolGate(FIRE, {}, null).available).toBe(false)
  })

  it('fails OPEN under withheldWhen for the same character', () => {
    const held = { withheldWhen: { progress: { 'cannon.complete': { eq: true } } } }
    expect(evaluateToolGate(held, {}, {}).available).toBe(true)
    expect(evaluateToolGate(held, {}, sheetAt(START + 11 * UNIT_MS.minute))).toEqual({
      available: false,
      withheldBy: 'withheldWhen',
    })
  })

  it('ANDs a metadata test with a progress test in the same gate', () => {
    const gate = {
      availableWhen: {
        metadata: { hasAnsibleAccess: { eq: true } },
        progress: { 'cannon.complete': { eq: true } },
      },
    }
    const charged = sheetAt(START + 11 * UNIT_MS.minute)
    expect(evaluateToolGate(gate, { hasAnsibleAccess: true }, charged).available).toBe(true)
    expect(evaluateToolGate(gate, { hasAnsibleAccess: false }, charged).available).toBe(false)
    expect(evaluateToolGate(gate, { hasAnsibleAccess: true }, sheetAt(START)).available).toBe(false)
  })

  it('accepts a gate that names only progress, with no metadata key at all', () => {
    expect(() => QtapCustomToolSchema.parse({ ...BASE, ...FIRE })).not.toThrow()
  })

  it('still rejects a gate that tests nothing', () => {
    expect(rejection({ ...BASE, availableWhen: {} })).toContain('at least one')
  })
})

// ---------------------------------------------------------------------------
// Reads — templates and expressions
// ---------------------------------------------------------------------------

describe('{{progress.…}} and {{now}} in a template', () => {
  const vars = (nowMs: number) => ({
    value: 0.5,
    roll: 0.5,
    dice: '',
    params: {},
    progress: sheetAt(nowMs),
    now: nowMs,
  })

  it('renders a derived field', () => {
    expect(renderTemplate('{{progress.cannon.state}}', vars(START + UNIT_MS.minute))).toBe('active')
    expect(renderTemplate('{{progress.cannon.elapsed}}', vars(START + UNIT_MS.minute))).toBe('1 minute')
  })

  it('renders a numeric field through the shared number convention', () => {
    expect(renderTemplate('{{progress.cannon.percent}}', vars(START + 5 * UNIT_MS.minute))).toBe('50')
  })

  it('renders {{now}} as epoch milliseconds', () => {
    expect(renderTemplate('{{now}}', vars(START))).toBe(String(START))
  })

  it('leaves an absent progression and an absent field as written', () => {
    expect(renderTemplate('{{progress.zeppelin.percent}}', vars(START))).toBe('{{progress.zeppelin.percent}}')
    expect(renderTemplate('{{progress.cannon.trimester}}', vars(START))).toBe('{{progress.cannon.trimester}}')
  })

  it('leaves {{now}} as written when no run clock was supplied', () => {
    expect(renderTemplate('{{now}}', { value: 0, roll: 0, dice: '', params: {} })).toBe('{{now}}')
  })
})

describe('{{now}} and {{progress.…}} in an effect expression', () => {
  it('the grammar accepts both refs', async () => {
    const definition = define({
      effects: [{ target: 'progress.cannon.endTime', value: '{{now}} + 600000' }],
    })
    const result = await executeCustomTool(definition, null, { now: START, progress: sheetAt(START) })
    expect(result.effects?.[0]).toMatchObject({ value: START + 600_000 })
  })

  it('arithmetic on a derived field works', async () => {
    const definition = define({
      effects: [{ target: 'metadata.charge', value: '{{progress.cannon.percent}} / 100' }],
    })
    const result = await executeCustomTool(definition, null, {
      now: START,
      progress: sheetAt(START + 5 * UNIT_MS.minute),
    })
    expect(result.effects?.[0]).toMatchObject({ value: 0.5 })
  })

  it('an absent progression fails the expression SOFT — the effect skips, the roll stands', async () => {
    const definition = define({
      effects: [{ target: 'metadata.charge', value: '{{progress.zeppelin.percent}} + 1' }],
    })
    const result = await executeCustomTool(definition, null, { now: START, progress: sheetAt(START) })
    expect(result.effects?.[0]).toHaveProperty('skipped')
  })

  it('holds ONE clock reading across a whole run', async () => {
    const definition = define({
      effects: [
        { target: 'metadata.a', value: '{{now}}' },
        { target: 'metadata.b', value: '{{now}}' },
      ],
    })
    const result = await executeCustomTool(definition, null, { now: START })
    expect(result.effects?.[0]).toMatchObject({ value: START })
    expect(result.effects?.[1]).toMatchObject({ value: START })
  })
})

// ---------------------------------------------------------------------------
// Effect targets
// ---------------------------------------------------------------------------

describe('parseEffectTarget — the progress branch', () => {
  it('parses each writable field', () => {
    for (const field of [
      'name',
      'description',
      'startTime',
      'endTime',
      'timeIncrement',
      'percentageReport',
      'reportFrequency',
      'onComplete',
      'reportTemplate',
      'quantity.total',
      'quantity.unit',
      'quantity.precision',
      'remove',
    ]) {
      const parsed = parseEffectTarget(`progress.cannon.${field}`)
      expect(parsed).toEqual({
        ok: true,
        target: { kind: 'progress', id: 'cannon', field, raw: `progress.cannon.${field}` },
      })
    }
  })

  it('refuses a field outside the writable set, naming the whole list', () => {
    const parsed = parseEffectTarget('progress.cannon.percent')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toContain('not a writable progression field')
    expect(parsed.reason).toContain('quantity.precision')
  })

  it('refuses updatedAt — the applier stamps it, an author does not', () => {
    expect(parseEffectTarget('progress.cannon.updatedAt').ok).toBe(false)
  })

  it('refuses an id that is not an identifier', () => {
    const parsed = parseEffectTarget('progress.Cannon.endTime')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toContain('not a valid id')
  })

  it('refuses a target naming only an id, or nothing at all', () => {
    for (const target of ['progress.cannon', 'progress.', 'progress.cannon.']) {
      expect(parseEffectTarget(target).ok).toBe(false)
    }
  })

  it('still names all three families when the prefix is wrong', () => {
    const parsed = parseEffectTarget('cannon.endTime')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toContain('progress.')
  })

  /**
   * The reserved key is not writable through the `metadata.` door.
   *
   * An effect's value is always a primitive, so `metadata.progressions` would
   * replace the whole progressions object with a string — wiping every span
   * the character carries, past the validation and rollback that guard the
   * `progress.` path, and fail-soft enough on the next read that nobody would
   * notice. Caught at LOAD time, where the author can still be told why.
   */
  it('refuses to write the reserved progressions key through "metadata."', () => {
    const parsed = parseEffectTarget('metadata.progressions')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toContain('reserved')
    expect(parsed.reason).toContain('progress.<id>.<field>')
  })

  it('refuses a dotted metadata key under the reserved one, which would touch no progression', () => {
    // Metadata keys are taken WHOLE, so this writes a literal key named
    // "progressions.cannon" — never the cannon. Refused because nobody who
    // writes it means that.
    expect(parseEffectTarget('metadata.progressions.cannon').ok).toBe(false)
  })

  it('rejects the reserved-key write at LOAD time, not at run time', () => {
    expect(rejection({ ...BASE, effects: [{ target: 'metadata.progressions', value: 1 }] })).toContain(
      'reserved'
    )
  })

  it('still allows a metadata key that merely starts with the same letters', () => {
    expect(parseEffectTarget('metadata.progressionsNotes')).toMatchObject({
      ok: true,
      target: { kind: 'metadata', key: 'progressionsNotes' },
    })
  })

  it('leaves the state and metadata branches untouched', () => {
    expect(parseEffectTarget('state.encounter.count')).toMatchObject({ ok: true })
    expect(parseEffectTarget('metadata.progress.thing')).toMatchObject({
      ok: true,
      target: { kind: 'metadata', key: 'progress.thing' },
    })
  })

  it('rejects an unwritable progress target at LOAD time, not at run time', () => {
    expect(
      rejection({ ...BASE, effects: [{ target: 'progress.cannon.percent', value: 1 }] })
    ).toContain('writable progression field')
  })
})

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

describe('collectToolVocabulary — progress', () => {
  it('reports ids read from a when, a gate and a placeholder', () => {
    const tool = define({
      availableWhen: { progress: { 'cannon.complete': { eq: true } } },
      outcomes: [
        { when: { progress: { 'fuse.started': { eq: true } } }, message: '{{progress.kettle.percent}}', state: 'info' },
        { when: true, message: '-', state: 'info' },
      ],
    })
    expect(collectToolVocabulary(tool).progress).toEqual(['cannon', 'fuse', 'kettle'])
  })

  it('reports ids WRITTEN separately from ids read', () => {
    const tool = define({
      outcomes: [
        { when: { progress: { 'cannon.complete': { eq: true } } }, message: '-', state: 'info' },
        { when: true, message: '-', state: 'info' },
      ],
      effects: [
        { target: 'progress.cannon.startTime', value: '{{now}}' },
        { target: 'progress.cannon.endTime', value: '{{now}} + 600000' },
      ],
    })
    const vocabulary = collectToolVocabulary(tool)
    expect(vocabulary.progress).toEqual(['cannon'])
    expect(vocabulary.progressWrites).toEqual(['cannon'])
    expect(vocabulary.now).toBe(true)
  })

  it('reports ids, never "<id>.<field>" keys — the roster withholds the odds', () => {
    const tool = define({
      availableWhen: { progress: { 'cannon.percent': { gte: 100 } } },
    })
    expect(collectToolVocabulary(tool).progress).toEqual(['cannon'])
  })

  it('leaves the lists empty and now false for a tool that quotes neither', () => {
    const vocabulary = collectToolVocabulary(define({}))
    expect(vocabulary.progress).toEqual([])
    expect(vocabulary.progressWrites).toEqual([])
    expect(vocabulary.now).toBe(false)
  })
})
