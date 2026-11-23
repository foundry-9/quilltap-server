/**
 * The resume card's one line on where a chat stands, cut from its context
 * summary (Markdown written for a model).
 */

import { summaryExcerpt, SUMMARY_EXCERPT_MAX } from '@/lib/chat/summary-excerpt'

describe('summaryExcerpt', () => {
  it.each([null, undefined, '', '   \n  \n'])('is null for an empty summary (%p)', (summary) => {
    expect(summaryExcerpt(summary)).toBeNull()
  })

  it('skips headings and takes the first line that says something', () => {
    expect(summaryExcerpt('## Active threads\n\n- The bridge is down.\n- The ford is rising.')).toBe(
      'The bridge is down.',
    )
  })

  it('treats a bold line standing alone as a heading', () => {
    expect(summaryExcerpt('**Active threads**\n- The letter on the sill: still unopened.')).toBe(
      'The letter on the sill: still unopened.',
    )
    expect(summaryExcerpt('**Active threads:**\nThe packet waits on Friday.')).toBe('The packet waits on Friday.')
  })

  it('is null when the summary holds only headings and rules', () => {
    expect(summaryExcerpt('# One\n## Two\n---\n**Three**')).toBeNull()
  })

  it('takes prose as it comes', () => {
    expect(summaryExcerpt('Riya is drafting the bill of sale.\n\nMore follows.')).toBe(
      'Riya is drafting the bill of sale.',
    )
  })

  it.each([
    ['- a dash bullet', 'a dash bullet'],
    ['* a star bullet', 'a star bullet'],
    ['+ a plus bullet', 'a plus bullet'],
    ['1. a numbered item', 'a numbered item'],
    ['2) another numbered item', 'another numbered item'],
    ['> a quoted line', 'a quoted line'],
  ])('drops the list or quote marker from %p', (line, expected) => {
    expect(summaryExcerpt(line)).toBe(expected)
  })

  it('strips inline Markdown and keeps the words', () => {
    expect(
      summaryExcerpt('- The line was *sealed, not filled*, then **handed** to `Suparna` ([see note](qtap://x/y.md)).'),
    ).toBe('The line was sealed, not filled, then handed to Suparna (see note).')
  })

  it('leaves apostrophes, snake_case and arithmetic alone', () => {
    expect(summaryExcerpt("Tester's ID and the wiring_letter_draft: 2 * 3 * 4 shares.")).toBe(
      "Tester's ID and the wiring_letter_draft: 2 * 3 * 4 shares.",
    )
  })

  it('collapses runs of whitespace', () => {
    expect(summaryExcerpt('-   Two   spaces\tand a tab.')).toBe('Two spaces and a tab.')
  })

  it('returns a line that fits untouched', () => {
    const line = 'x'.repeat(SUMMARY_EXCERPT_MAX)
    expect(summaryExcerpt(line)).toBe(line)
  })

  it('cuts a long line at a word and ends it with an ellipsis', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const excerpt = summaryExcerpt(long)!

    expect(excerpt.length).toBeLessThanOrEqual(SUMMARY_EXCERPT_MAX)
    expect(excerpt.endsWith('…')).toBe(true)
    // Whole words only: what precedes the ellipsis is a prefix ending on a word.
    const body = excerpt.slice(0, -1)
    expect(long.startsWith(body)).toBe(true)
    expect(long[body.length]).toBe(' ')
  })

  it('does not leave punctuation hanging before the ellipsis', () => {
    const excerpt = summaryExcerpt('One clause here, another clause there; and a third one after that.', 20)!
    expect(excerpt).toBe('One clause here…')
  })

  it('cuts mid-word rather than return next to nothing when there is no space to cut at', () => {
    const excerpt = summaryExcerpt('a ' + 'y'.repeat(100), 20)!
    expect(excerpt).toHaveLength(20)
    expect(excerpt.endsWith('…')).toBe(true)
  })

  it('honours a caller\'s own limit', () => {
    expect(summaryExcerpt('The bridge is down and the ford is rising fast tonight.', 30)!.length).toBeLessThanOrEqual(30)
  })
})
