/**
 * Title ordering — `lib/utils/title-sort.ts`, shared by scenario lists and the
 * Atlas browser: case-insensitive, a leading "The" ignored.
 */

import { compareTitles, titleSortKey } from '@/lib/utils/title-sort'

describe('titleSortKey', () => {
  it('drops a leading definite article only', () => {
    expect(titleSortKey('The Covenant')).toBe('Covenant')
    expect(titleSortKey('the-attic')).toBe('attic')
    expect(titleSortKey('Theatre Night')).toBe('Theatre Night')
    expect(titleSortKey('Into the Woods')).toBe('Into the Woods')
    expect(titleSortKey('The')).toBe('The')
  })
})

describe('compareTitles', () => {
  it('files "The" titles under their next word', () => {
    const names = ['Winnower', 'The Mercury', 'Tessarium', 'The Ansible', 'Paris 1925', 'The Covenant', 'neo-Faraday Cage']
    expect([...names].sort(compareTitles)).toEqual([
      'The Ansible',
      'The Covenant',
      'The Mercury',
      'neo-Faraday Cage',
      'Paris 1925',
      'Tessarium',
      'Winnower',
    ])
  })

  it('keeps a stable order between "The X" and "X"', () => {
    expect(compareTitles('Attic', 'The Attic')).not.toBe(0)
    expect(compareTitles('Attic', 'The Attic')).toBe(-compareTitles('The Attic', 'Attic'))
  })
})
