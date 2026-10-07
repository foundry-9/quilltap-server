/**
 * The character wardrobe loader keeps the origin each endpoint attached.
 *
 * The server tags every item with the wardrobe it was read from; the hook's
 * only job is not to lose that tag. De-duplication keeps the first (winning)
 * copy, so a personal garment that shadows a General archetype of the same id
 * must surface as `character`, not as `Shared · Quilltap General`.
 */

import { renderHook, waitFor } from '@testing-library/react'

import { useCharacterWardrobeItems } from '@/lib/hooks/use-character-wardrobe-items'

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>

const CHARACTER = { scope: 'character', id: 'char-1', name: 'Bertie' }
const GENERAL = { scope: 'general', id: null, name: 'Quilltap General' }
const SISTERS = { scope: 'group', id: 'G1', name: 'The Sisters' }

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function routeTo(table: Record<string, unknown>): void {
  mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!(url in table)) throw new Error(`unexpected fetch: ${url}`)
    return ok(table[url])
  })
}

beforeEach(() => {
  mockFetch.mockReset()
  global.fetch = mockFetch
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

it('keeps the winning copy’s origin through de-duplication', async () => {
  routeTo({
    '/api/v1/characters/char-1/wardrobe': {
      wardrobeItems: [{ id: 'coat', title: 'My coat', origin: CHARACTER }],
    },
    '/api/v1/characters/char-1/wardrobe?scope=group': {
      wardrobeItems: [{ id: 'shawl', title: 'Shawl', origin: SISTERS }],
    },
    '/api/v1/wardrobe': {
      wardrobeItems: [
        { id: 'coat', title: 'House coat', origin: GENERAL },
        { id: 'hat', title: 'Hat', origin: GENERAL },
      ],
    },
  })

  const { result } = renderHook(() => useCharacterWardrobeItems('char-1'))

  await waitFor(() => expect(result.current.fetched).toBe(true))
  const byId = Object.fromEntries(result.current.items.map((i) => [i.id, i]))
  expect(Object.keys(byId).sort()).toEqual(['coat', 'hat', 'shawl'])
  expect(byId.coat.title).toBe('My coat')
  expect(byId.coat.origin).toEqual(CHARACTER)
  expect(byId.shawl.origin).toEqual(SISTERS)
  expect(byId.hat.origin).toEqual(GENERAL)
})
