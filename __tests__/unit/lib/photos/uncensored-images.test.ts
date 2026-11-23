/**
 * findUncensoredImages / withGenerationModeration (lib/photos/uncensored-images.ts):
 * every gallery's "was this drawn uncensored?" question, asked by content hash.
 */

import {
  findUncensoredImages,
  withGenerationModeration,
} from '@/lib/photos/uncensored-images'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

function repos(rows: Array<{ sha256: string; generationModeration: string | null }>) {
  const findUncensoredBySha256s = jest.fn(async (shas: readonly string[]) =>
    rows.filter((r) => shas.includes(r.sha256)),
  )
  return { files: { findUncensoredBySha256s } } as never as {
    files: { findUncensoredBySha256s: typeof findUncensoredBySha256s }
  }
}

describe('findUncensoredImages', () => {
  it('maps each uncensored hash to its record, deduping and skipping blanks', async () => {
    const r = repos([
      { sha256: A, generationModeration: 'uncensored-failover' },
      { sha256: A, generationModeration: 'uncensored-routed' },
    ])
    const found = await findUncensoredImages(r as never, [A, A, null, undefined, '', B])
    expect(r.files.findUncensoredBySha256s).toHaveBeenCalledWith([A, B])
    expect(found.get(A)).toBe('uncensored-failover')
    expect(found.has(B)).toBe(false)
  })

  it('asks nothing for an empty list', async () => {
    const r = repos([])
    expect((await findUncensoredImages(r as never, [])).size).toBe(0)
    expect(r.files.findUncensoredBySha256s).not.toHaveBeenCalled()
  })

  it('never throws: a failed read badges nothing', async () => {
    const r = { files: { findUncensoredBySha256s: jest.fn(async () => { throw new Error('db gone') }) } }
    expect((await findUncensoredImages(r as never, [A])).size).toBe(0)
  })
})

describe('withGenerationModeration', () => {
  it('stamps each entry by its sha256, null where there is no record', async () => {
    const r = repos([{ sha256: C, generationModeration: 'uncensored-profile' }])
    const out = await withGenerationModeration(r as never, [
      { id: 1, sha256: C },
      { id: 2, sha256: A },
      { id: 3 },
    ])
    expect(out.map((e) => [e.id, e.generationModeration])).toEqual([
      [1, 'uncensored-profile'],
      [2, null],
      [3, null],
    ])
  })
})
