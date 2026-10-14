import { describe, expect, it } from '@jest/globals'
import { deriveScriptoriumStatus } from '@/lib/scriptorium/status'

describe('deriveScriptoriumStatus', () => {
  it('is none when the chat has no chunks', () => {
    expect(deriveScriptoriumStatus(undefined)).toBe('none')
    expect(deriveScriptoriumStatus({ total: 0, embedded: 0 })).toBe('none')
  })

  it('is rendered while any chunk still lacks an embedding', () => {
    expect(deriveScriptoriumStatus({ total: 14, embedded: 12 })).toBe('rendered')
    expect(deriveScriptoriumStatus({ total: 3, embedded: 0 })).toBe('rendered')
  })

  it('is embedded once every chunk is embedded', () => {
    expect(deriveScriptoriumStatus({ total: 24, embedded: 24 })).toBe('embedded')
  })
})
