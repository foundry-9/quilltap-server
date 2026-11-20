/**
 * The code editor's text arithmetic: line endings, indent unit, Tab and
 * Shift+Tab plans.
 */

import {
  applyEdits,
  countLines,
  detectIndentUnit,
  detectLineEnding,
  fromEditorText,
  leadingIndentAt,
  lineOfOffset,
  lineStarts,
  planIndent,
  planOutdent,
  toEditorText,
} from '@/components/code-editor/text'

describe('line endings', () => {
  it('round-trips LF, CRLF, no final newline and empty text', () => {
    for (const text of ['a\nb\n', 'a\r\nb\r\n', 'a\r\nb', '', '\n', '\r\n', 'one line', 'lone\rreturn\n']) {
      expect(fromEditorText(toEditorText(text), detectLineEnding(text))).toBe(text)
    }
  })

  it('takes the majority for a mixed file', () => {
    expect(detectLineEnding('a\r\nb\r\nc\n')).toBe('crlf')
    expect(detectLineEnding('a\r\nb\nc\n')).toBe('lf')
  })
})

describe('detectIndentUnit', () => {
  it('reads the smallest space indent, a tab indent, or defaults to two spaces', () => {
    expect(detectIndentUnit('{\n    "a": {\n        "b": 1\n    }\n}\n')).toBe('    ')
    expect(detectIndentUnit('a {\n\tcolor: red;\n}\n')).toBe('\t')
    expect(detectIndentUnit('a\nb\n')).toBe('  ')
    expect(detectIndentUnit('  \n')).toBe('  ')
  })
})

describe('lines', () => {
  it('counts and locates lines', () => {
    const text = 'ab\ncd\n'
    expect(countLines(text)).toBe(3)
    expect(lineStarts(text)).toEqual([0, 3, 6])
    expect(lineOfOffset(lineStarts(text), 4)).toBe(1)
    expect(lineOfOffset(lineStarts(text), 6)).toBe(2)
  })

  it('reads the indent up to the caret', () => {
    expect(leadingIndentAt('a\n    b', 7)).toBe('    ')
    expect(leadingIndentAt('a\n    b', 4)).toBe('  ')
  })
})

describe('planIndent', () => {
  it('inserts one unit at a collapsed caret', () => {
    const plan = planIndent('ab', 1, 1, '  ')
    expect(applyEdits('ab', plan.edits)).toBe('a  b')
    expect([plan.anchor, plan.focus]).toEqual([3, 3])
  })

  it('indents every non-empty line a selection touches', () => {
    const text = 'a\n\nb\nc'
    const plan = planIndent(text, 0, 5, '  ')
    expect(applyEdits(text, plan.edits)).toBe('  a\n\n  b\nc')
    expect(plan.anchor).toBe(0)
    expect(plan.focus).toBe(9)
  })

  it('does not take in a line the selection ends at the start of', () => {
    const text = 'a\nb\n'
    const plan = planIndent(text, 0, 2, '\t')
    expect(applyEdits(text, plan.edits)).toBe('\ta\nb\n')
  })
})

describe('planOutdent', () => {
  it('removes a tab or up to one unit of spaces from each line', () => {
    const text = '\ta\n   b\n c\nd'
    const plan = planOutdent(text, 0, text.length, '  ')
    expect(applyEdits(text, plan.edits)).toBe('a\n b\nc\nd')
  })

  it('keeps the caret on its character', () => {
    const text = '    abc'
    const plan = planOutdent(text, 6, 6, '  ')
    expect(applyEdits(text, plan.edits)).toBe('  abc')
    expect(plan.anchor).toBe(4)
  })

  it('moves a caret inside the removed indent to the line start', () => {
    const plan = planOutdent('  abc', 1, 1, '  ')
    expect(plan.anchor).toBe(0)
  })
})
