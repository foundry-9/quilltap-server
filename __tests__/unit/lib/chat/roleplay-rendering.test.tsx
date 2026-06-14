/**
 * @jest-environment node
 *
 * Unit + cross-renderer equivalence tests for the shared roleplay-rendering core.
 *
 * The whole point of `lib/chat/roleplay-rendering.ts` is that the client renderer
 * (React nodes) and the server renderer (HTML string) derive from ONE tokenizer,
 * so they can't drift. These tests:
 *   1. lock `tokenizeInline` / `lineClassFor` / `compileRenderingPatterns` behavior, and
 *   2. assert the React adapter and the HTML emit-helper serialize the SAME
 *      Segment[] to identical markup.
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RenderingPattern } from '@/lib/schemas/template.types'
import {
  type Segment,
  compileRenderingPatterns,
  tokenizeInline,
  lineClassFor,
  lineMatchFor,
  segmentsToHtml,
  escapeMarkdownInBrackets,
} from '@/lib/chat/roleplay-rendering'

// Common inline rules mirroring the legacy default patterns.
const INLINE_PATTERNS: RenderingPattern[] = [
  { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' },
  { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' },
  { pattern: '(?<!\\{)\\{[^{}]+\\}(?!\\})', className: 'qt-chat-inner-monologue' },
  { pattern: '[""][^""]+[""]', className: 'qt-chat-dialogue' },
]

/** The React adapter, replicated from MessageContent.segmentsToReactNodes. */
function segmentsToReactNodes(segments: Segment[]): React.ReactNode[] {
  return segments.map((seg, i) =>
    seg.className ? <span key={i} className={seg.className}>{seg.text}</span> : seg.text,
  )
}

describe('roleplay-rendering core', () => {
  describe('compileRenderingPatterns', () => {
    it('strips the global flag (matching walks manually)', () => {
      const [rule] = compileRenderingPatterns([{ pattern: 'x', className: 'c', flags: 'g' }])
      expect(rule.regex.flags).not.toContain('g')
    })

    it('defaults legacy patterns (no scope) to inline', () => {
      const [rule] = compileRenderingPatterns([{ pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' }])
      expect(rule.scope).toBe('inline')
    })

    it('preserves an explicit line scope', () => {
      const [rule] = compileRenderingPatterns([
        { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm', scope: 'line' },
      ])
      expect(rule.scope).toBe('line')
    })

    it('keeps the u flag for unicode patterns', () => {
      const [rule] = compileRenderingPatterns([
        { pattern: '^\\[(?:[^\\p{Ll}]+)\\].*$', className: 'qt-chat-tag', flags: 'mu', scope: 'line' },
      ])
      expect(rule.regex.flags).toContain('u')
    })
  })

  describe('tokenizeInline', () => {
    const rules = compileRenderingPatterns(INLINE_PATTERNS)

    it('returns a single plain segment for unmatched text', () => {
      expect(tokenizeInline('plain text', rules)).toEqual([{ text: 'plain text' }])
    })

    it('returns [] for empty input', () => {
      expect(tokenizeInline('', rules)).toEqual([])
    })

    it('wraps a single inline match with surrounding plain runs', () => {
      expect(tokenizeInline('hello *world* end', rules)).toEqual([
        { text: 'hello ' },
        { text: '*world*', className: 'qt-chat-narration' },
        { text: ' end' },
      ])
    })

    it('picks the earliest match across rules, in document order', () => {
      expect(tokenizeInline('a [b] c *d*', rules)).toEqual([
        { text: 'a ' },
        { text: '[b]', className: 'qt-chat-narration' },
        { text: ' c ' },
        { text: '*d*', className: 'qt-chat-narration' },
      ])
    })

    it('does NOT treat a [text](url) link as bracket narration', () => {
      // The (?!\() lookahead in the bracket rule excludes markdown links.
      expect(tokenizeInline('see [docs](http://x) here', rules)).toEqual([
        { text: 'see [docs](http://x) here' },
      ])
    })

    it('ignores line-scoped rules (they are applied at the block level)', () => {
      const lineRules = compileRenderingPatterns([
        { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm', scope: 'line' },
      ])
      expect(tokenizeInline('// an ooc line', lineRules)).toEqual([{ text: '// an ooc line' }])
    })

    it('still matches a legacy inline-scoped // pattern inline (no behavior change)', () => {
      const legacy = compileRenderingPatterns([{ pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' }])
      expect(tokenizeInline('// an ooc line', legacy)).toEqual([
        { text: '// an ooc line', className: 'qt-chat-ooc' },
      ])
    })
  })

  describe('lineClassFor', () => {
    const oocRule = compileRenderingPatterns([
      { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm', scope: 'line' },
    ])
    const tagRule = compileRenderingPatterns([
      { pattern: '^\\[(?:[^\\p{Ll}]+)\\].*$', className: 'qt-chat-tag', flags: 'mu', scope: 'line' },
    ])

    it('returns the class when the whole block is one matching line', () => {
      expect(lineClassFor('// out of character', oocRule)).toBe('qt-chat-ooc')
    })

    it('returns undefined for a mixed multi-line block', () => {
      expect(lineClassFor('// ooc line\nnormal line', oocRule)).toBeUndefined()
    })

    it('returns undefined when nothing matches', () => {
      expect(lineClassFor('just narration', oocRule)).toBeUndefined()
    })

    it('ignores inline-scoped rules', () => {
      const inlineOoc = compileRenderingPatterns([{ pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' }])
      expect(lineClassFor('// ooc', inlineOoc)).toBeUndefined()
    })

    it('matches an uppercase tag token (the [CAPTAIN] case)', () => {
      expect(lineClassFor('[CAPTAIN] All hands on deck!', tagRule)).toBe('qt-chat-tag')
    })

    it('rejects a lowercase tag token', () => {
      expect(lineClassFor('[captain] all hands', tagRule)).toBeUndefined()
    })

    it('accepts non-Latin uppercase / non-cased tag tokens', () => {
      expect(lineClassFor('[ÇÉ] hola', tagRule)).toBe('qt-chat-tag')
      expect(lineClassFor('[漢字] greetings', tagRule)).toBe('qt-chat-tag')
    })
  })

  describe('hide delimiters', () => {
    it('emits only the inner content for a hidden inline wrap', () => {
      const rules = compileRenderingPatterns([
        { pattern: '(?<!\\+)\\+(?<rpBody>[^+]+)\\+(?!\\+)', className: 'qt-chat-narration', hideDelimiters: true },
      ])
      expect(tokenizeInline('a +narr+ b', rules)).toEqual([
        { text: 'a ' },
        { text: 'narr', className: 'qt-chat-narration' },
        { text: ' b' },
      ])
    })

    it('keeps the delimiters when hide is off', () => {
      const rules = compileRenderingPatterns([
        { pattern: '(?<!\\+)\\+(?<rpBody>[^+]+)\\+(?!\\+)', className: 'qt-chat-narration' },
      ])
      expect(tokenizeInline('a +narr+ b', rules)).toEqual([
        { text: 'a ' },
        { text: '+narr+', className: 'qt-chat-narration' },
        { text: ' b' },
      ])
    })

    it('lineMatchFor returns the prefix and stripped body for a linePrefix', () => {
      const rules = compileRenderingPatterns([
        { pattern: '^// (?<rpBody>.+)$', className: 'qt-chat-ooc', flags: 'm', scope: 'line', hideDelimiters: true },
      ])
      expect(lineMatchFor('// an ooc line', rules)).toEqual({
        className: 'qt-chat-ooc',
        hideDelimiters: true,
        prefix: '// ',
        body: 'an ooc line',
      })
    })

    it('lineMatchFor strips the [TAG] for a tagPrefix, keeping the body', () => {
      const rules = compileRenderingPatterns([
        { pattern: '^\\[(?:[^\\p{Ll}]+)\\](?<rpBody>.*)$', className: 'qt-chat-tag', flags: 'mu', scope: 'line', hideDelimiters: true },
      ])
      expect(lineMatchFor('[CAPTAIN] all hands', rules)).toEqual({
        className: 'qt-chat-tag',
        hideDelimiters: true,
        prefix: '[CAPTAIN]',
        body: ' all hands',
      })
    })

    it('lineClassFor still returns just the class (back-compat wrapper)', () => {
      const rules = compileRenderingPatterns([
        { pattern: '^// (?<rpBody>.+)$', className: 'qt-chat-ooc', flags: 'm', scope: 'line', hideDelimiters: true },
      ])
      expect(lineClassFor('// ooc', rules)).toBe('qt-chat-ooc')
    })
  })

  describe('cross-renderer equivalence (React adapter === HTML emit)', () => {
    const rules = compileRenderingPatterns(INLINE_PATTERNS)
    const cases = [
      'plain text only',
      'hello *world* end',
      'a [b] c *d*',
      'mix {thoughts} and *action* together',
    ]

    it.each(cases)('serializes identically for: %s', (input) => {
      const segments = tokenizeInline(input, rules)
      const html = segmentsToHtml(segments)
      const react = renderToStaticMarkup(<>{segmentsToReactNodes(segments)}</>)
      expect(react).toBe(html)
    })
  })

  describe('escapeMarkdownInBrackets', () => {
    const BRACKET: RenderingPattern = { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' }

    it('returns content unchanged when no relevant patterns', () => {
      expect(escapeMarkdownInBrackets('text *with* stars', [])).toBe('text *with* stars')
    })

    it('escapes markdown chars inside [...] when bracket narration present', () => {
      const result = escapeMarkdownInBrackets('[narration with *emphasis*]', [BRACKET])
      expect(result).toContain('\\*')
    })

    it('preserves fenced code blocks unchanged', () => {
      const content = '[bracket] then ```[in code] *stars*``` end'
      const result = escapeMarkdownInBrackets(content, [BRACKET])
      expect(result).toContain('[in code] *stars*')
    })
  })
})
