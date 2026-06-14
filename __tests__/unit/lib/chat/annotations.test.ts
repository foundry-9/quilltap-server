/**
 * @jest-environment node
 *
 * Unit tests for kind-aware delimiter derivation in lib/chat/annotations.
 */

import {
  delimiterToPrefixSuffix,
  generateRenderingPatterns,
  getDelimiterTooltip,
} from '@/lib/chat/annotations'
import type { TemplateDelimiter } from '@/lib/schemas/template.types'

const wrapStr: TemplateDelimiter = { kind: 'wrap', name: 'Narration', buttonName: 'Nar', delimiters: '*', style: 'qt-chat-narration' }
const wrapPair: TemplateDelimiter = { kind: 'wrap', name: 'Narration', buttonName: 'Nar', delimiters: ['[', ']'], style: 'qt-chat-narration' }
const linePrefix: TemplateDelimiter = { kind: 'linePrefix', name: 'OOC', buttonName: 'OOC', marker: '// ', style: 'qt-chat-ooc' }
const tagPrefix: TemplateDelimiter = { kind: 'tagPrefix', name: 'Rank', buttonName: 'Rank', open: '[', close: ']', style: 'qt-chat-ooc' }

describe('delimiterToPrefixSuffix', () => {
  it('maps a wrap string to same open/close', () => {
    expect(delimiterToPrefixSuffix(wrapStr)).toEqual({ prefix: '*', suffix: '*' })
  })
  it('maps a wrap pair to open/close', () => {
    expect(delimiterToPrefixSuffix(wrapPair)).toEqual({ prefix: '[', suffix: ']' })
  })
  it('maps a linePrefix to marker + empty suffix', () => {
    expect(delimiterToPrefixSuffix(linePrefix)).toEqual({ prefix: '// ', suffix: '' })
  })
  it('maps a tagPrefix to open/close', () => {
    expect(delimiterToPrefixSuffix(tagPrefix)).toEqual({ prefix: '[', suffix: ']' })
  })
})

describe('generateRenderingPatterns', () => {
  it('emits inline patterns (no scope) for wrap delimiters', () => {
    const [p] = generateRenderingPatterns([wrapStr])
    expect(p.className).toBe('qt-chat-narration')
    expect(p).not.toHaveProperty('scope')
  })

  it('emits a line-scoped pattern for a linePrefix', () => {
    const [p] = generateRenderingPatterns([linePrefix])
    expect(p).toMatchObject({ pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm', scope: 'line' })
  })

  it('emits a line-scoped, unicode pattern for a tagPrefix using the default token', () => {
    const [p] = generateRenderingPatterns([tagPrefix])
    expect(p.scope).toBe('line')
    expect(p.flags).toContain('u')
    // default token pattern: one-or-more non-lowercase
    expect(p.pattern).toContain('[^\\p{Ll}]+')
    // a real regex from it accepts uppercase, rejects lowercase
    const re = new RegExp(p.pattern, p.flags)
    expect(re.test('[CAPTAIN] hi')).toBe(true)
    expect(re.test('[captain] hi')).toBe(false)
  })

  it('honors a custom tokenPattern', () => {
    const custom: TemplateDelimiter = { ...tagPrefix, tokenPattern: '\\d+' }
    const [p] = generateRenderingPatterns([custom])
    const re = new RegExp(p.pattern, p.flags)
    expect(re.test('[123] go')).toBe(true)
    expect(re.test('[ABC] go')).toBe(false)
  })

  it('dedupes by kind+prefix+suffix so a wrap [ ] and a tagPrefix [ ] both survive', () => {
    const patterns = generateRenderingPatterns([wrapPair, tagPrefix])
    expect(patterns).toHaveLength(2)
  })

  it('appends the narration pattern when not already covered', () => {
    const patterns = generateRenderingPatterns([linePrefix], '*')
    expect(patterns.some((p) => p.className === 'qt-chat-narration')).toBe(true)
  })
})

describe('getDelimiterTooltip', () => {
  it('describes each kind', () => {
    expect(getDelimiterTooltip(wrapStr)).toContain('*...*')
    expect(getDelimiterTooltip(linePrefix)).toContain('// ')
    expect(getDelimiterTooltip(tagPrefix)).toContain('TOKEN')
  })
})
