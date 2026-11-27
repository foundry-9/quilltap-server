/**
 * remark-plugins: the one ordered remark list the client renderer and the
 * server pre-render share.
 */

import { remarkPluginsFor } from '@/lib/markdown/remark-plugins'

jest.mock('remark-gfm', () => ({ __esModule: true, default: function remarkGfm() {} }))
jest.mock('remark-breaks', () => ({ __esModule: true, default: function remarkBreaks() {} }))
jest.mock('remark-math', () => ({ __esModule: true, default: function remarkMath() {} }))
jest.mock('remark-smartypants', () => ({ __esModule: true, default: function remarkSmartypants() {} }))

function names(list: ReturnType<typeof remarkPluginsFor>): string[] {
  return list.map((entry) => (Array.isArray(entry) ? (entry[0] as { name: string }).name : (entry as { name: string }).name))
}

describe('remarkPluginsFor', () => {
  it('runs gfm, math and breaks, in that order, without smart quotes', () => {
    expect(names(remarkPluginsFor(false))).toEqual(['remarkGfm', 'remarkMath', 'remarkBreaks'])
  })

  it('adds smart quotes last, after breaks, when curling', () => {
    expect(names(remarkPluginsFor(true))).toEqual(['remarkGfm', 'remarkMath', 'remarkBreaks', 'remarkSmartypants'])
  })

  it('returns a stable list per typographer state', () => {
    expect(remarkPluginsFor(true)).toBe(remarkPluginsFor(true))
    expect(remarkPluginsFor(false)).toBe(remarkPluginsFor(false))
  })
})
