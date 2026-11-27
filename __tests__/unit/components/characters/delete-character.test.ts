/**
 * `deleteCharacter` / `deletionSummary` — the one client delete request and the
 * toast that says what went with it (the Aurora shelf and the character page).
 */
import { deleteCharacter, deletionSummary } from '@/components/characters/delete-character'

const mockFetch = global.fetch as jest.Mock

beforeEach(() => {
  mockFetch.mockReset()
})

describe('deleteCharacter', () => {
  it('sends the cascade choices as query flags', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ deletedChats: 2 }) })
    const result = await deleteCharacter('c1', { cascadeChats: true, cascadeImages: false }, 'nope')
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/characters/c1?cascadeChats=true', { method: 'DELETE' })
    expect(result).toEqual({ deletedChats: 2 })
  })

  it('sends no query string when nothing cascades', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    await deleteCharacter('c1', { cascadeChats: false, cascadeImages: false }, 'nope')
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/characters/c1', { method: 'DELETE' })
  })

  it('throws the caller’s message on a failed answer', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) })
    await expect(deleteCharacter('c1', { cascadeChats: true, cascadeImages: true }, 'Could not delete')).rejects.toThrow(
      'Could not delete',
    )
  })

  it('reads an unparseable success body as nothing else removed', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json') } })
    await expect(deleteCharacter('c1', { cascadeChats: false, cascadeImages: false }, 'nope')).resolves.toEqual({})
  })
})

describe('deletionSummary', () => {
  it('names the character and only the counts above zero, singular and plural', () => {
    expect(deletionSummary({}, 'Gatsby')).toBe('Gatsby deleted')
    expect(deletionSummary({ deletedChats: 1, deletedImages: 0, deletedMemories: 3 }, 'Gatsby')).toBe(
      'Gatsby deleted. 1 chat deleted. 3 memories deleted',
    )
    expect(deletionSummary({ deletedChats: 2, deletedImages: 1, deletedMemories: 1 }, 'Character')).toBe(
      'Character deleted. 2 chats deleted. 1 image deleted. 1 memory deleted',
    )
  })
})
