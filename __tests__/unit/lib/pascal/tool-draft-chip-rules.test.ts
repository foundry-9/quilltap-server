/**
 * The chip rules shared by the outcome and gate editors: which issues a
 * place shows, which comparators a subject offers, and how a test is made
 * legal when its subject changes.
 */

import { COMPARATOR_KEYS } from '@/lib/pascal/custom-tool.types'
import {
  EQUALITY_COMPARATORS,
  NUMERIC_COMPARATORS,
  TEXT_COMPARATORS,
  comparatorsForType,
  issuesAt,
  legalInventoryStateTest,
  legalNumberTest,
  type DraftIssue,
} from '@/lib/pascal/tool-draft'

describe('issuesAt', () => {
  const issues: DraftIssue[] = [
    { severity: 'error', where: { section: 'llm', field: 'prompt' }, message: 'one' },
    { severity: 'warning', where: { section: 'llm', field: 'prompt' }, message: 'two' },
    { severity: 'error', where: { section: 'brief', id: 'o1' }, message: 'three' },
  ] as DraftIssue[]

  it('keeps the issues of one severity whose place is accepted, in order', () => {
    expect(issuesAt(issues, 'error', () => true).map((i) => i.message)).toEqual(['one', 'three'])
    expect(issuesAt(issues, 'warning', (w) => w.section === 'llm').map((i) => i.message)).toEqual(['two'])
    expect(issuesAt(issues, 'error', (w) => w.section === 'brief' && 'id' in w && w.id === 'o1').map((i) => i.message)).toEqual(['three'])
  })
})

describe('comparatorsForType', () => {
  it('offers by value type, and everything when the type is unknown', () => {
    expect(comparatorsForType('string')).toBe(TEXT_COMPARATORS)
    expect(comparatorsForType('boolean')).toBe(EQUALITY_COMPARATORS)
    expect(comparatorsForType('number')).toBe(NUMERIC_COMPARATORS)
    expect(comparatorsForType(null)).toBe(COMPARATOR_KEYS)
  })
})

describe('legalInventoryStateTest', () => {
  it('keeps ≠, turns anything else into =', () => {
    expect(legalInventoryStateTest('neq', { kind: 'string', text: 'carried' }).comparator).toBe('neq')
    expect(legalInventoryStateTest('gt', { kind: 'string', text: 'carried' }).comparator).toBe('eq')
  })

  it('keeps a state or a parameter, and makes anything else "equipped"', () => {
    expect(legalInventoryStateTest('eq', { kind: 'string', text: 'carried' }).operand).toEqual({ kind: 'string', text: 'carried' })
    expect(legalInventoryStateTest('eq', { kind: 'param', name: 'p' }).operand).toEqual({ kind: 'param', name: 'p' })
    expect(legalInventoryStateTest('eq', { kind: 'string', text: 'nonsense' }).operand).toEqual({ kind: 'string', text: 'equipped' })
    expect(legalInventoryStateTest('eq', { kind: 'number', text: '3' }).operand).toEqual({ kind: 'string', text: 'equipped' })
  })
})

describe('legalNumberTest', () => {
  it('turns containment into the fallback comparator and keeps the rest', () => {
    expect(legalNumberTest('contains', { kind: 'number', text: '1' }, { comparator: 'gte' }).comparator).toBe('gte')
    expect(legalNumberTest('ncontains', { kind: 'number', text: '1' }, { comparator: 'eq' }).comparator).toBe('eq')
    expect(legalNumberTest('lt', { kind: 'number', text: '1' }, { comparator: 'eq' }).comparator).toBe('lt')
  })

  it('turns a text or true/false literal into a number', () => {
    expect(legalNumberTest('eq', { kind: 'string', text: '7' }, { comparator: 'eq' }).operand).toEqual({ kind: 'number', text: '7' })
    expect(legalNumberTest('eq', { kind: 'boolean', value: true }, { comparator: 'eq' }).operand).toEqual({ kind: 'number', text: '' })
    expect(legalNumberTest('eq', { kind: 'string', text: 'x' }, { comparator: 'gte', text: '1' }).operand).toEqual({ kind: 'number', text: '1' })
  })

  it('leaves numbers and references alone', () => {
    const param = { kind: 'param' as const, name: 'n' }
    expect(legalNumberTest('eq', param, { comparator: 'eq' }).operand).toBe(param)
  })
})
