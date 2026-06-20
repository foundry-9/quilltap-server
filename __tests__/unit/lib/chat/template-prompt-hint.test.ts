/**
 * @jest-environment node
 *
 * Unit tests for the formatting prompt-hint generator (§7 editor helper).
 */

import { generateFormattingPromptHint } from '@/lib/chat/template-prompt-hint'
import type { TemplateDelimiter } from '@/lib/schemas/template.types'

describe('generateFormattingPromptHint', () => {
  it('returns an empty string when there is nothing to describe', () => {
    expect(generateFormattingPromptHint([])).toBe('')
  })

  it('describes the narration delimiters', () => {
    const hint = generateFormattingPromptHint([], '*')
    expect(hint).toContain('Narration and action: wrap in *…*')
  })

  it('describes each delimiter kind', () => {
    const delimiters: TemplateDelimiter[] = [
      { kind: 'wrap', name: 'Internal', buttonName: 'Int', delimiters: ['{', '}'], style: 'qt-chat-inner-monologue' },
      { kind: 'linePrefix', name: 'OOC', buttonName: 'OOC', marker: '// ', style: 'qt-chat-ooc' },
      { kind: 'tagPrefix', name: 'Rank', buttonName: 'Rank', open: '[', close: ']', style: 'qt-chat-ooc' },
    ]
    const hint = generateFormattingPromptHint(delimiters, '*')
    expect(hint).toContain('Internal: wrap in {…}')
    expect(hint).toContain('OOC: begin the line with "// "')
    expect(hint).toContain('Rank: begin the line with a [TOKEN] tag')
    expect(hint).toContain('All hands on deck')
  })

  it('does not restate narration when a wrap delimiter matches it', () => {
    const delimiters: TemplateDelimiter[] = [
      { kind: 'wrap', name: 'Narration', buttonName: 'Nar', delimiters: '*', style: 'qt-chat-narration' },
    ]
    const hint = generateFormattingPromptHint(delimiters, '*')
    // Only one mention of narration (the dedicated narration bullet).
    const matches = hint.match(/Narration/g) || []
    expect(matches.length).toBe(1)
  })
})
