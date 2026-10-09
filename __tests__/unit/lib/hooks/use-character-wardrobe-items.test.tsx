/**
 * The character wardrobe loader keeps the origin each endpoint attached.
 *
 * The server tags every item with the wardrobe it was read from; the hook's
 * only job is not to lose that tag. De-duplication keeps the first (winning)
 * copy, so a personal garment that shadows a General archetype of the same id
 * must surface as `character`, not as `Shared · Quilltap General`.
 */

import { renderHook as rtlRenderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'

import { useCharacterWardrobeItems } from '@/lib/hooks/use-character-wardrobe-items'

/** Every hook here reads through TanStack Query; each render gets a fresh client. */
const renderHook = ((callback: never, options?: object) =>
  rtlRenderHook(callback, { wrapper: createQueryWrapper().wrapper, ...options })) as typeof rtlRenderHook

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

describe('the merge rule (mergeWearableTiers)', () => {
  it('drops an archived personal copy before shadowing, so the shared item stays visible', async () => {
    routeTo({
      '/api/v1/characters/char-1/wardrobe': {
        wardrobeItems: [
          { id: 'coat', title: 'My old coat', origin: CHARACTER, archivedAt: '2026-10-01T00:00:00.000Z' },
        ],
      },
      '/api/v1/characters/char-1/wardrobe?scope=group': { wardrobeItems: [] },
      '/api/v1/wardrobe': { wardrobeItems: [{ id: 'coat', title: 'House coat', origin: GENERAL }] },
    })

    const { result } = renderHook(() => useCharacterWardrobeItems('char-1'))

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].title).toBe('House coat')
    expect(result.current.items[0].origin).toEqual(GENERAL)
  })

  it('with includeArchived, shadows over the full per-tier lists', async () => {
    routeTo({
      '/api/v1/characters/char-1/wardrobe?includeArchived=true': {
        wardrobeItems: [
          { id: 'coat', title: 'My old coat', origin: CHARACTER, archivedAt: '2026-10-01T00:00:00.000Z' },
        ],
      },
      '/api/v1/characters/char-1/wardrobe?scope=group&includeArchived=true': { wardrobeItems: [] },
      '/api/v1/wardrobe?includeArchived=true': {
        wardrobeItems: [{ id: 'coat', title: 'House coat', origin: GENERAL }],
      },
    })

    const { result } = renderHook(() =>
      useCharacterWardrobeItems('char-1', { includeArchived: true }),
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(result.current.items.map((i) => i.title)).toEqual(['My old coat'])
  })

  it('ranks group over project over General, and derives the project tier from the chat', async () => {
    const PROJECT = { scope: 'project', id: 'P1', name: 'Thornfield' }
    routeTo({
      '/api/v1/chats/chat-1': { chat: { id: 'chat-1', projectId: 'P1' } },
      '/api/v1/characters/char-1/wardrobe': { wardrobeItems: [] },
      '/api/v1/characters/char-1/wardrobe?scope=group': {
        wardrobeItems: [{ id: 'livery', title: 'Group livery', origin: SISTERS }],
      },
      '/api/v1/projects/P1/wardrobe': {
        wardrobeItems: [
          { id: 'livery', title: 'Project livery', origin: PROJECT },
          { id: 'apron', title: 'Apron', origin: PROJECT },
        ],
      },
      '/api/v1/wardrobe': {
        wardrobeItems: [{ id: 'apron', title: 'General apron', origin: GENERAL }],
      },
    })

    const { result } = renderHook(() => useCharacterWardrobeItems('char-1', { chatId: 'chat-1' }))

    await waitFor(() => expect(result.current.items).toHaveLength(2))
    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(result.current.projectId).toBe('P1')
    const byId = Object.fromEntries(result.current.items.map((i) => [i.id, i]))
    expect(byId.livery.title).toBe('Group livery')
    expect(byId.apron.title).toBe('Apron')
  })
})
