import { describe, it, expect } from '@jest/globals'
import { formatDigestProvenance } from '@/lib/chat/context/memory-injector'

describe('formatDigestProvenance', () => {
  it('describes a digest by its source count', () => {
    expect(formatDigestProvenance({ source: 'CONSOLIDATED', consolidatedFrom: new Array(14).fill('x') })).toBe(' (from 14 notes)')
    expect(formatDigestProvenance({ source: 'CONSOLIDATED', consolidatedFrom: ['x'] })).toBe(' (from 1 note)')
  })
  it('is empty for ordinary memories and empty digests', () => {
    expect(formatDigestProvenance({ source: 'AUTO', consolidatedFrom: [] })).toBe('')
    expect(formatDigestProvenance({ source: 'CONSOLIDATED', consolidatedFrom: [] })).toBe('')
  })
})
