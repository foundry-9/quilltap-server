/**
 * Writing Assistant output normalising and filenames.
 */

import { normalizeWritingOutput, writingOutputFilename } from '../writing-output'

describe('normalizeWritingOutput', () => {
  it('trims', () => {
    expect(normalizeWritingOutput('\n\n  # Title\n\nBody.  \n')).toBe('# Title\n\nBody.')
  })

  it('unwraps a whole-text ```markdown fence', () => {
    expect(normalizeWritingOutput('```markdown\n# Title\n\nBody.\n```')).toBe('# Title\n\nBody.')
  })

  it('unwraps a whole-text ```md fence', () => {
    expect(normalizeWritingOutput('```md\nA line.\n```\n')).toBe('A line.')
  })

  it('leaves a piece that is itself a code block alone', () => {
    const piece = '```ts\nconst x = 1\n```'
    expect(normalizeWritingOutput(piece)).toBe(piece)
  })

  it('leaves interior fences alone', () => {
    const piece = '# Usage\n\n```markdown\n*emphasis*\n```\n\nThat is all.'
    expect(normalizeWritingOutput(piece)).toBe(piece)
  })

  it('does not unwrap two fenced blocks that merely start and end the text', () => {
    const piece = '```markdown\nOne.\n```\n\nBetween.\n\n```markdown\nTwo.\n```'
    expect(normalizeWritingOutput(piece)).toBe(piece)
  })

  it('does not strip a real first line', () => {
    expect(normalizeWritingOutput('Here is the rain, falling.')).toBe('Here is the rain, falling.')
  })
})

describe('writingOutputFilename', () => {
  it('slugs the title', () => {
    expect(writingOutputFilename('The Night Train: Act II!', 1)).toBe('the-night-train-act-ii.md')
  })

  it('numbers later outputs by ordinal', () => {
    expect(writingOutputFilename('Notes', 2)).toBe('notes-2.md')
    expect(writingOutputFilename('Notes', 3)).toBe('notes-3.md')
  })

  it('falls back when the title slugs to nothing', () => {
    expect(writingOutputFilename('', 1)).toBe('console-output.md')
    expect(writingOutputFilename('!!!', 2)).toBe('console-output-2.md')
    expect(writingOutputFilename(null, 1)).toBe('console-output.md')
  })

  it('caps the slug at 80 characters', () => {
    const name = writingOutputFilename('a'.repeat(200), 1)
    expect(name).toBe(`${'a'.repeat(80)}.md`)
  })
})
