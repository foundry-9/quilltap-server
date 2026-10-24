/**
 * Tests for the name-chip markers and the shared name matcher.
 */

import {
  assignMentionsToRuns,
  MENTION_CLOSE,
  MENTION_MID,
  MENTION_OPEN,
  rehypeMentionMarkers,
  splitMentionMarkers,
} from '@/lib/chat/mention-markers'
import { buildNameMatcher, firstNameMatch, lastNameMatch } from '@/lib/chat/name-mentions'

type Node = { type: string; tagName?: string; value?: string; children?: Node[] }

const el = (tagName: string, ...children: Node[]): Node => ({ type: 'element', tagName, children })
const text = (value: string): Node => ({ type: 'text', value })
const mark = (i: number, t: string) => `${MENTION_OPEN}${i}${MENTION_MID}${t}${MENTION_CLOSE}`

describe('name matcher', () => {
  const m = buildNameMatcher(['Abigail', 'Abby', 'Mrs. Sebold'])!

  it('matches whole names, case-sensitively', () => {
    expect(firstNameMatch('ask Abby now', m)).toEqual({ index: 4, text: 'Abby' })
    expect(firstNameMatch('abby', m)).toBeNull()
    expect(firstNameMatch('Abbyville', m)).toBeNull()
    expect(firstNameMatch('Ask Mrs. Sebold.', m)?.text).toBe('Mrs. Sebold')
  })

  it('finds the last match', () => {
    expect(lastNameMatch('Abby, then Abigail', m)).toEqual({ index: 11, text: 'Abigail' })
  })

  it('is null with no usable names', () => {
    expect(buildNameMatcher(['', '  ', null])).toBeNull()
  })
})

describe('rehypeMentionMarkers', () => {
  it('marks the first eligible occurrence of each mention, once', () => {
    const tree = el('root', el('p', text('Vergil and Abby; Abby again.')), el('p', text('Vergil later.')))
    rehypeMentionMarkers([{ text: 'Abby' }, { text: 'Vergil' }])(tree)
    expect(tree.children![0].children![0].value).toBe(`${mark(1, 'Vergil')} and ${mark(0, 'Abby')}; Abby again.`)
    expect(tree.children![1].children![0].value).toBe('Vergil later.')
  })

  it('skips code, emphasis and other non-block parents, taking the next eligible one', () => {
    const tree = el(
      'root',
      el('p', el('code', text('Abby')), el('em', text('Abby')), text(' then Abby')),
    )
    rehypeMentionMarkers([{ text: 'Abby' }])(tree)
    const p = tree.children![0]
    expect(p.children![0].children![0].value).toBe('Abby')
    expect(p.children![1].children![0].value).toBe('Abby')
    expect(p.children![2].value).toBe(` then ${mark(0, 'Abby')}`)
  })

  it('marks inside list items and blockquotes', () => {
    const tree = el('root', el('ul', el('li', text('Greg came'))))
    rehypeMentionMarkers([{ text: 'Greg' }])(tree)
    expect(tree.children![0].children![0].children![0].value).toBe(`${mark(0, 'Greg')} came`)
  })
})

describe('splitMentionMarkers', () => {
  it('returns plain text unchanged', () => {
    expect(splitMentionMarkers('no marks')).toEqual(['no marks'])
  })

  it('splits marked runs out', () => {
    expect(splitMentionMarkers(`"When ${mark(2, 'Abby')} scolds."`)).toEqual([
      '"When ',
      { index: 2, text: 'Abby' },
      ' scolds."',
    ])
  })
})

describe('assignMentionsToRuns', () => {
  it('gives each mention to the first prose run that names it', () => {
    const out = assignMentionsToRuns(['Hello.', null, 'Abby came. Greg too.', 'Abby again.'], [
      { text: 'Abby' },
      { text: 'Greg' },
    ])
    expect(out).toEqual([undefined, undefined, [{ text: 'Abby' }, { text: 'Greg' }], undefined])
  })
})
