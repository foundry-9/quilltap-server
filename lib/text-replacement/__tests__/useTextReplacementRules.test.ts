import { compileRules, findReplacement } from '../useTextReplacementRules'
import type { TextReplacementRule } from '@/lib/schemas/text-replacement.types'

function rule(partial: Partial<TextReplacementRule>): TextReplacementRule {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    fromText: 'aris',
    toText: 'Aristarchus',
    caseSensitive: false,
    enabled: true,
    sortOrder: 0,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...partial,
  }
}

describe('compileRules', () => {
  it('returns empty when given no rules', () => {
    const compiled = compileRules([])
    expect(compiled.empty).toBe(true)
    expect(compiled.caseSensitive.size).toBe(0)
    expect(compiled.caseInsensitive.size).toBe(0)
  })

  it('places case-insensitive rules under their lower-cased trigger', () => {
    const compiled = compileRules([rule({ fromText: 'Aris', toText: 'Aristarchus' })])
    expect(compiled.caseInsensitive.get('aris')).toBe('Aristarchus')
    expect(compiled.caseSensitive.size).toBe(0)
    expect(compiled.empty).toBe(false)
  })

  it('places case-sensitive rules under the exact trigger', () => {
    const compiled = compileRules([
      rule({ fromText: 'URL', caseSensitive: true, toText: 'Uniform Resource Locator' }),
    ])
    expect(compiled.caseSensitive.get('URL')).toBe('Uniform Resource Locator')
    expect(compiled.caseInsensitive.size).toBe(0)
  })

  it('skips disabled rules at compile time', () => {
    const compiled = compileRules([rule({ fromText: 'aris', enabled: false })])
    expect(compiled.empty).toBe(true)
  })

  it('treats a list of all-disabled rules as empty', () => {
    const compiled = compileRules([
      rule({ fromText: 'aris', enabled: false }),
      rule({ fromText: 'omw', enabled: false }),
    ])
    expect(compiled.empty).toBe(true)
  })
})

describe('findReplacement', () => {
  it('returns case-sensitive match when both maps could match', () => {
    const compiled = compileRules([
      rule({ fromText: 'URL', caseSensitive: true, toText: 'Uniform Resource Locator' }),
      rule({ fromText: 'url', caseSensitive: false, toText: 'a URL' }),
    ])
    expect(findReplacement('URL', compiled)).toBe('Uniform Resource Locator')
  })

  it('falls back to case-insensitive when case-sensitive does not match', () => {
    const compiled = compileRules([
      rule({ fromText: 'URL', caseSensitive: true, toText: 'Uniform Resource Locator' }),
      rule({ fromText: 'aris', caseSensitive: false, toText: 'Aristarchus' }),
    ])
    expect(findReplacement('Aris', compiled)).toBe('Aristarchus')
    expect(findReplacement('aris', compiled)).toBe('Aristarchus')
    expect(findReplacement('ARIS', compiled)).toBe('Aristarchus')
  })

  it('returns undefined when no rule matches', () => {
    const compiled = compileRules([rule({ fromText: 'aris', toText: 'Aristarchus' })])
    expect(findReplacement('Marisa', compiled)).toBeUndefined()
    expect(findReplacement('', compiled)).toBeUndefined()
  })

  it('does not match a case-sensitive rule with the wrong casing', () => {
    const compiled = compileRules([
      rule({ fromText: 'URL', caseSensitive: true, toText: 'Uniform Resource Locator' }),
    ])
    expect(findReplacement('url', compiled)).toBeUndefined()
    expect(findReplacement('Url', compiled)).toBeUndefined()
  })
})
