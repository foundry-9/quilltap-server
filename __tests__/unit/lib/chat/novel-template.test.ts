/**
 * @jest-environment node
 *
 * The built-in Novel template and the template capabilities it is built from:
 * unmarked narration, an unmarked-text style, Markdown asterisks taken away,
 * curly-tolerant and open-ended wrap delimiters, and nested inline rules.
 * Exercised through the shared core (both renderers' tokenizer + pre-parse) and
 * the server's HTML post-processing.
 */

import { generateRenderingPatterns } from '@/lib/chat/annotations'
import {
  compileRenderingPatterns,
  escapeMarkdownInBrackets,
  segmentsToHtml,
  tokenizeInline,
  unmarkedClassFor,
} from '@/lib/chat/roleplay-rendering'
import { NOVEL_TEMPLATE, NOVEL_DELIMITERS } from '@/lib/chat/novel-template'
import { applyLineScopedClasses, applyRoleplayPatterns } from '@/lib/services/markdown-postprocess'
import { isQuoteSensitiveRoleplayConfig } from '@/lib/markdown/typography'
import { generateFormattingPromptHint } from '@/lib/chat/template-prompt-hint'
import { RoleplayTemplateSchema } from '@/lib/schemas/template.types'

const NARRATION = 'qt-roleplay-plain qt-rp-italic'
const EMPHASIS = 'qt-roleplay-plain qt-rp-bold qt-rp-italic'
const DIALOGUE = 'qt-chat-dialogue'
const OOC = 'qt-chat-ooc'

const patterns = NOVEL_TEMPLATE.renderingPatterns
const rules = compileRenderingPatterns(patterns)

/** Tokenize as a block's direct text: unmarked runs get the narration class. */
function html(text: string): string {
  return segmentsToHtml(tokenizeInline(text, rules, { unmarkedClassName: unmarkedClassFor(rules) }))
}

describe('Novel template', () => {
  it('validates against the template schema with null narration', () => {
    const parsed = RoleplayTemplateSchema.parse({
      ...NOVEL_TEMPLATE,
      id: '00000000-0000-4000-8000-000000000001',
      createdAt: '2026-10-22T00:00:00.000Z',
      updatedAt: '2026-10-22T00:00:00.000Z',
    })
    expect(parsed.narrationDelimiters).toBeNull()
    expect(parsed.markdownAsterisks).toBe(false)
    expect(parsed.unmarkedStyle?.style).toBe('qt-roleplay-plain')
  })

  it('derives its patterns from the editor-reachable fields alone', () => {
    expect(patterns).toEqual(
      generateRenderingPatterns(NOVEL_DELIMITERS, null, {
        unmarkedStyle: NOVEL_TEMPLATE.unmarkedStyle,
        markdownAsterisks: false,
      }),
    )
    expect(patterns.map((p) => p.scope ?? 'inline')).toEqual([
      'strip', 'literal', 'inline', 'inline', 'inline', 'unmarked',
    ])
  })

  describe('display', () => {
    it('sets plain prose as italic narration', () => {
      expect(html('She set the cup down.')).toBe(`<span class="${NARRATION}">She set the cup down.</span>`)
    })

    it('leaves straight-quoted dialogue upright, narration italic around it', () => {
      expect(html('"You\'re late," he said.')).toBe(
        `<span class="${DIALOGUE}">"You're late,"</span><span class="${NARRATION}"> he said.</span>`,
      )
    })

    it('matches curly and mixed quotes alike', () => {
      expect(html('“Hello”')).toBe(`<span class="${DIALOGUE}">“Hello”</span>`)
      expect(html('“Hello"')).toBe(`<span class="${DIALOGUE}">“Hello"</span>`)
    })

    it('runs an unclosed quotation to the end of the paragraph', () => {
      expect(html('"And then I went home.')).toBe(`<span class="${DIALOGUE}">"And then I went home.</span>`)
    })

    it('styles emphasis in narration, concealing the asterisks', () => {
      expect(html('It was *urgent*.')).toBe(
        `<span class="${NARRATION}">It was </span><span class="${EMPHASIS}">urgent</span><span class="${NARRATION}">.</span>`,
      )
    })

    it('nests emphasis inside dialogue', () => {
      expect(html('"I said *stop*!"')).toBe(
        `<span class="${DIALOGUE}">"I said <span class="${EMPHASIS}">stop</span>!"</span>`,
      )
    })

    it('styles ((out of character)) text, delimiters visible', () => {
      expect(html('((brb, dinner))')).toBe(`<span class="${OOC}">((brb, dinner))</span>`)
    })

    it('never applies the narration class inside a claimed span', () => {
      const segs = tokenizeInline('"a *b* c"', rules, { unmarkedClassName: NARRATION })
      expect(segs).toHaveLength(1)
      expect(segs[0].children?.every((c) => c.className !== NARRATION)).toBe(true)
    })
  })

  describe('pre-parse (Markdown asterisks off)', () => {
    const pre = (s: string) => escapeMarkdownInBrackets(s, patterns)

    it('escapes single asterisks so Markdown leaves them for the emphasis delimiter', () => {
      expect(pre('It was *urgent*.')).toBe('It was \\*urgent\\*.')
    })

    it('drops doubled asterisks: they mean nothing', () => {
      expect(pre('A **bold** claim.')).toBe('A bold claim.')
      expect(pre('"I **said** so."')).toBe('"I said so."')
      expect(pre('***Both***')).toBe('Both')
    })

    it('does not double-escape asterisks inside dialogue', () => {
      expect(pre('"I said *stop*!"')).toBe('"I said \\*stop\\*!"')
    })

    it('leaves scene breaks, bullets and code alone', () => {
      expect(pre('* * *')).toBe('* * *')
      expect(pre('***')).toBe('***')
      expect(pre('* an item *with* stress')).toBe('* an item \\*with\\* stress')
      expect(pre('use `a*b` here')).toBe('use `a*b` here')
      expect(pre('```\n**x**\n```')).toBe('```\n**x**\n```')
    })

    it('leaves templates with Markdown asterisks on untouched', () => {
      const markdownOn = generateRenderingPatterns(NOVEL_DELIMITERS, null, { markdownAsterisks: true })
      expect(markdownOn.some((p) => p.scope === 'strip' || p.scope === 'literal')).toBe(false)
    })
  })

  describe('server HTML post-processing', () => {
    it('applies the narration class only to text directly in a block', () => {
      const out = applyRoleplayPatterns('<p>She ran. <a href="x">link</a></p>', rules)
      expect(out).toBe(`<p><span class="${NARRATION}">She ran. </span><a href="x">link</a></p>`)
    })

    it('does not style text inside a wrap-block span as narration', () => {
      const out = applyRoleplayPatterns(`<p><span class="${EMPHASIS}">Damn.</span></p>`, rules)
      expect(out).toBe(`<p><span class="${EMPHASIS}">Damn.</span></p>`)
    })

    it('sheds narration spans from a block a line rule claims', () => {
      const lineRules = compileRenderingPatterns([
        ...patterns,
        { pattern: '^// (?<rpBody>.+)$', className: OOC, flags: 'm', scope: 'line', hideDelimiters: true },
      ])
      const inline = applyRoleplayPatterns('<p>// an aside</p>', lineRules)
      expect(applyLineScopedClasses(inline, lineRules)).toBe(`<p class="${OOC}">an aside</p>`)
    })
  })

  it('keeps smart quotes available (dialogue matches both forms)', () => {
    expect(isQuoteSensitiveRoleplayConfig(patterns, NOVEL_TEMPLATE.dialogueDetection)).toBe(false)
  })

  it('drafts formatting instructions that describe unmarked prose and the quote rules', () => {
    const hint = generateFormattingPromptHint(NOVEL_DELIMITERS, null, { markdownAsterisks: false })
    expect(hint).toContain('Narration and action: plain prose')
    expect(hint).toContain('Straight or curly quotation marks are both fine')
    expect(hint).toContain('leave " off every paragraph but the last')
    expect(hint).toContain('Never use double asterisks')
  })
})
