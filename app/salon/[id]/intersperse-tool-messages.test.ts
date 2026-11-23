import { readToolAnchorOffset } from './intersperse-tool-messages'

describe('readToolAnchorOffset', () => {
  it('reads a finite numeric anchorOffset', () => {
    expect(readToolAnchorOffset(JSON.stringify({ anchorOffset: 12 }))).toBe(12)
    expect(readToolAnchorOffset(JSON.stringify({ anchorOffset: 0 }))).toBe(0)
  })

  it('returns undefined for missing, non-numeric, or non-finite offsets', () => {
    expect(readToolAnchorOffset(JSON.stringify({ toolName: 'rng' }))).toBeUndefined()
    expect(readToolAnchorOffset(JSON.stringify({ anchorOffset: 'x' }))).toBeUndefined()
    expect(readToolAnchorOffset(JSON.stringify({ anchorOffset: null }))).toBeUndefined()
    expect(readToolAnchorOffset('not json')).toBeUndefined()
  })
})
