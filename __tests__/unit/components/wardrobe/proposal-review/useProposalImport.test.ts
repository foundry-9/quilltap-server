/**
 * useProposalImport: pieces are created first (one ordinary POST each), the
 * outfit second, bundling created plus reused pieces.
 */

jest.mock('@/lib/fetch-helpers', () => ({ fetchJson: jest.fn() }))

import { renderHook, act } from '@testing-library/react'
import { useProposalImport, type ProposalImportPiece } from '@/components/wardrobe/proposal-review/useProposalImport'
import { fetchJson } from '@/lib/fetch-helpers'
import { createQueryWrapper } from '../../../../helpers/renderWithQuery'

const mockFetch = fetchJson as jest.Mock

const piece = (title: string, types: any[] = ['top'], extra: Partial<ProposalImportPiece> = {}): ProposalImportPiece => ({
  title, description: '', imagePrompt: '  ', types, appropriateness: '', ...extra,
})
const outfit = { title: ' Evening ', description: ' fancy ', appropriateness: '', replace: true }

let nextId = 0
function okCreate() {
  mockFetch.mockImplementation(async (_url: string, init: any) => {
    const body = JSON.parse(init.body)
    return { ok: true, status: 201, data: { wardrobeItem: { id: `id-${++nextId}`, ...body } } }
  })
}
const bodies = () => mockFetch.mock.calls.map((c) => JSON.parse(c[1].body))

function setup(opts: Partial<Parameters<typeof useProposalImport>[0]> = {}) {
  const { wrapper } = createQueryWrapper()
  const hook = renderHook(
    () => useProposalImport({ container: { scope: 'character', id: 'c1' }, logLabel: 'T', ...opts }),
    { wrapper },
  )
  return hook
}

let warn: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  nextId = 0
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe('useProposalImport', () => {
  it('creates pieces in order, then the outfit bundling them', async () => {
    okCreate()
    const { result } = setup()
    let res: any
    await act(async () => {
      res = await result.current.run({ pieces: [piece('Shirt', ['top']), piece('Trousers', ['bottom'])], outfit })
    })
    const sent = bodies()
    expect(mockFetch.mock.calls.every((c) => c[0] === '/api/v1/characters/c1/wardrobe')).toBe(true)
    expect(mockFetch.mock.calls[0][1].method).toBe('POST')
    expect(sent.map((b) => b.title)).toEqual(['Shirt', 'Trousers', 'Evening'])
    expect(sent[0]).toMatchObject({ description: null, imagePrompt: null, appropriateness: null, isDefault: false })
    expect(sent[2]).toMatchObject({
      description: 'fancy', componentItemIds: ['id-1', 'id-2'], replace: true, types: ['top', 'bottom'], isDefault: false,
    })
    expect(res.outfitOutcome).toBe('created')
    expect(res.outfitPieceCount).toBe(2)
    expect(res.created).toHaveLength(2)
    expect(res.outfit.title).toBe('Evening')
    expect(result.current.importing).toBe(false)
  })

  it('files items under a folder when given', async () => {
    okCreate()
    const { result } = setup({ folder: 'Gala' })
    await act(async () => { await result.current.run({ pieces: [piece('A')], outfit: null }) })
    expect(bodies()[0].folder).toBe('Gala')
  })

  it('uses the container\'s collection URL', async () => {
    okCreate()
    const { result } = setup({ container: { scope: 'general', id: null } })
    await act(async () => { await result.current.run({ pieces: [piece('A')], outfit: null }) })
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/wardrobe')
  })

  it('outcome is none when no outfit is asked for', async () => {
    okCreate()
    const { result } = setup()
    let res: any
    await act(async () => { res = await result.current.run({ pieces: [piece('A')], outfit: null }) })
    expect(res).toMatchObject({ outfit: null, outfitOutcome: 'none', outfitPieceCount: 1 })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('reports failed pieces, leaves them out and warns', async () => {
    let n = 0
    mockFetch.mockImplementation(async (_u: string, init: any) => {
      const body = JSON.parse(init.body)
      if (body.title === 'Bad') return { ok: false, status: 400, error: 'nope' }
      return { ok: true, status: 201, data: { wardrobeItem: { id: `id-${++n}`, ...body } } }
    })
    const { result } = setup()
    let res: any
    await act(async () => {
      res = await result.current.run({ pieces: [piece('Good1'), piece('Bad'), piece('Good2', ['bottom'])], outfit })
    })
    expect(res.failedTitles).toEqual(['Bad'])
    expect(res.created.map((i: any) => i.title)).toEqual(['Good1', 'Good2'])
    expect(bodies()[3].componentItemIds).toEqual(['id-1', 'id-2'])
    expect(warn).toHaveBeenCalled()
  })

  it('too-few when fewer than the minimum pieces land, and makes no outfit call', async () => {
    mockFetch.mockImplementation(async (_u: string, init: any) => {
      const body = JSON.parse(init.body)
      return body.title === 'Bad'
        ? { ok: false, status: 500, error: 'x' }
        : { ok: true, status: 201, data: { wardrobeItem: { id: 'id-1', ...body } } }
    })
    const { result } = setup()
    let res: any
    await act(async () => { res = await result.current.run({ pieces: [piece('Good'), piece('Bad')], outfit }) })
    expect(res).toMatchObject({ outfit: null, outfitOutcome: 'too-few', outfitPieceCount: 1 })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('too-few when nothing new was created, even with reused items', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, error: 'x' })
    const { result } = setup()
    let res: any
    await act(async () => {
      res = await result.current.run({
        pieces: [piece('A')], outfit, reusedItems: [{ id: 'old1', types: ['top'] }, { id: 'old2', types: ['bottom'] }],
      })
    })
    expect(res.outfitOutcome).toBe('too-few')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('bundles reused items with created ones and unions their slots', async () => {
    okCreate()
    const { result } = setup()
    let res: any
    await act(async () => {
      res = await result.current.run({ pieces: [piece('Hat', ['accessories'])], outfit, reusedItems: [{ id: 'old1', types: ['footwear'] }] })
    })
    const last = bodies()[1]
    expect(last.componentItemIds).toEqual(['id-1', 'old1'])
    expect(last.types).toEqual(expect.arrayContaining(['accessories', 'footwear']))
    expect(res.outfitPieceCount).toBe(2)
    expect(res.outfitOutcome).toBe('created')
  })

  it('reports a failed outfit while keeping the created pieces', async () => {
    mockFetch.mockImplementation(async (_u: string, init: any) => {
      const body = JSON.parse(init.body)
      return body.componentItemIds
        ? { ok: false, status: 500, error: 'boom' }
        : { ok: true, status: 201, data: { wardrobeItem: { id: `id-${++nextId}`, ...body } } }
    })
    const { result } = setup()
    let res: any
    await act(async () => { res = await result.current.run({ pieces: [piece('A'), piece('B', ['bottom'])], outfit }) })
    expect(res).toMatchObject({ outfit: null, outfitOutcome: 'failed' })
    expect(res.created).toHaveLength(2)
  })

  it('calls afterCreate for each piece and the outfit, in order', async () => {
    okCreate()
    const afterCreate = jest.fn(async () => {})
    const { result } = setup()
    await act(async () => {
      await result.current.run({ pieces: [piece('A'), piece('B', ['bottom'])], outfit, afterCreate })
    })
    expect(afterCreate.mock.calls.map((c: any[]) => c[1])).toEqual(['A', 'B', 'Evening'])
  })

  it('importing is true during the run and false after, even on throw', async () => {
    let release!: (v: unknown) => void
    mockFetch.mockImplementation(() => new Promise((r) => { release = r }))
    const { result } = setup()
    let p: Promise<any>
    act(() => { p = result.current.run({ pieces: [piece('A')], outfit: null }) })
    expect(result.current.importing).toBe(true)
    await act(async () => { release({ ok: true, status: 201, data: { wardrobeItem: { id: 'x', types: [] } } }); await p })
    expect(result.current.importing).toBe(false)

    mockFetch.mockRejectedValue(new Error('kaboom'))
    await act(async () => {
      await expect(result.current.run({ pieces: [piece('A')], outfit: null })).rejects.toThrow('kaboom')
    })
    expect(result.current.importing).toBe(false)
  })
})
