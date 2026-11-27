import { isTextReplacementBoundary, TEXT_REPLACEMENT_TRIGGER_CHARS } from '@/lib/text-replacement/boundary'

describe('text replacement word boundaries', () => {
  it.each([' ', ' ', '\t', '.', ',', ';', ':', '!', '?', ')'])('%j ends a word', (ch) => {
    expect(isTextReplacementBoundary(ch)).toBe(true)
  })

  it.each(['a', '-', '\n', '(', "'"])('%j does not', (ch) => {
    expect(isTextReplacementBoundary(ch)).toBe(false)
  })

  it('has exactly the ten trigger characters', () => {
    expect(TEXT_REPLACEMENT_TRIGGER_CHARS.size).toBe(10)
  })
})
