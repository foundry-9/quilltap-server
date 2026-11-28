/**
 * doc_focus `line` in the Markdown editor names a 1-based line of the file and
 * lands on the block that line imports into (#309).
 */

import {
  frontmatterLineCount,
  markdownBlockIndexForLine,
} from '@/app/salon/[id]/components/markdown-source-lines'

beforeEach(() => {
  jest.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('markdownBlockIndexForLine', () => {
  // Blocks: 0 "First", 1 blank, 2 "Second", 3 blank, 4 "Third"
  const paragraphs = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'

  it('maps line 1 to the first block, not the second', () => {
    expect(markdownBlockIndexForLine(paragraphs, 1)).toBe(0)
  })

  it('maps line 5 to the third paragraph', () => {
    expect(markdownBlockIndexForLine(paragraphs, 5)).toBe(4)
  })

  it('keeps every line of a list in the list block', () => {
    const md = '# Title\n\n- one\n- two\n- three\n\nAfter.'
    const listStart = markdownBlockIndexForLine(md, 3)
    expect(markdownBlockIndexForLine(md, 5)).toBe(listStart)
    expect(markdownBlockIndexForLine(md, 7)).toBe(listStart + 2)
  })

  it('keeps every line of a fenced code block in one block', () => {
    const md = 'Intro.\n\n```\nline a\nline b\n```\n\nOutro.'
    expect(markdownBlockIndexForLine(md, 5)).toBe(markdownBlockIndexForLine(md, 3))
  })

  it('treats a line before the body (frontmatter, 0) as the first block', () => {
    expect(markdownBlockIndexForLine(paragraphs, 0)).toBe(0)
    expect(markdownBlockIndexForLine(paragraphs, -3)).toBe(0)
  })
})

describe('frontmatterLineCount', () => {
  it('counts the lines of a frontmatter block', () => {
    expect(frontmatterLineCount(null)).toBe(0)
    expect(frontmatterLineCount('---\ntitle: x\n---\n')).toBe(3)
    expect(frontmatterLineCount('---\ntitle: x\n---')).toBe(3)
  })
})
