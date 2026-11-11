/**
 * The `?includeArchived` opt-in, read in one place.
 *
 * Archiving is a tombstone, not a delete: an archived scenario or wardrobe item
 * is still a live row, and eleven listing endpoints hide it by default. The
 * accepted spelling has to be identical across all eleven or an archived entry
 * reappears at one endpoint and not another — so the *refusals* below matter as
 * much as the acceptances, and the fall-closed behaviour on an unparseable URL
 * is the whole reason this is a function rather than an inline read.
 */

import { readIncludeArchived, readPagination } from '@/lib/api/query-params'

/** The only property the reader touches. */
function req(url: string): Request {
  return { url } as Request
}

describe('readIncludeArchived — asked', () => {
  it('honours the literal true', () => {
    expect(readIncludeArchived(req('https://x.test/api/v1/wardrobe?includeArchived=true'))).toBe(true)
  })

  it('honours the bare valueless form', () => {
    expect(readIncludeArchived(req('https://x.test/api/v1/wardrobe?includeArchived'))).toBe(true)
  })

  it('honours it alongside other params', () => {
    expect(
      readIncludeArchived(req('https://x.test/api/v1/wardrobe?tier=general&includeArchived=true&q=hat'))
    ).toBe(true)
  })
})

describe('readIncludeArchived — not asked', () => {
  it('is false when the param is absent', () => {
    expect(readIncludeArchived(req('https://x.test/api/v1/wardrobe'))).toBe(false)
  })

  it('is false for anything other than the literal true', () => {
    for (const value of ['1', 'yes', 'True', 'TRUE', 'on', 'false', '0']) {
      expect(
        readIncludeArchived(req(`https://x.test/api/v1/wardrobe?includeArchived=${value}`))
      ).toBe(false)
    }
  })

  it('falls closed on an unparseable URL rather than throwing', () => {
    expect(readIncludeArchived(req('not a url'))).toBe(false)
    expect(readIncludeArchived({} as Request)).toBe(false)
  })
})

describe('readPagination', () => {
  const opts = { defaultLimit: 20, maxLimit: 50 }

  it('reads a well-formed pair', () => {
    expect(readPagination(req('https://x.test/a?limit=10&offset=30'), opts)).toEqual({ limit: 10, offset: 30 })
  })

  it('defaults when absent', () => {
    expect(readPagination(req('https://x.test/a'), opts)).toEqual({ limit: 20, offset: 0 })
  })

  it('caps the limit at maxLimit', () => {
    expect(readPagination(req('https://x.test/a?limit=5000'), opts).limit).toBe(50)
  })

  // SQLite reads LIMIT -1 as "no limit" (#167).
  it('treats a negative, zero or non-numeric limit as the default', () => {
    for (const bad of ['-1', '0', 'abc', '']) {
      expect(readPagination(req(`https://x.test/a?limit=${bad}`), opts).limit).toBe(20)
    }
  })

  it('treats a negative or non-numeric offset as zero', () => {
    for (const bad of ['-5', 'abc']) {
      expect(readPagination(req(`https://x.test/a?offset=${bad}`), opts).offset).toBe(0)
    }
  })

  it('clamps a default larger than the cap', () => {
    expect(readPagination(req('https://x.test/a'), { defaultLimit: 500, maxLimit: 100 }).limit).toBe(100)
  })

  it('prefers nextUrl when present', () => {
    const r = { nextUrl: new URL('https://x.test/a?limit=7') } as unknown as Request
    expect(readPagination(r, opts).limit).toBe(7)
  })

  it('falls back to defaults on an unparseable URL', () => {
    expect(readPagination(req('not a url'), opts)).toEqual({ limit: 20, offset: 0 })
  })
})
