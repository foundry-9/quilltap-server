/**
 * WARDROBE_ITEM_IMAGE_GENERATION (lib/background-jobs/handlers/wardrobe-item-image.ts).
 *
 * The handler draws through `generateWardrobeItemImage` against the owner's
 * wardrobe, and never retries a spend: a vanished or archived item, a missing
 * profile, an archived owner and a refusal all end the job quietly.
 */


jest.mock('@/lib/logger', () => {
  const base: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  base.child = jest.fn(() => base)
  return { logger: base }
})

const mockResolveHome = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@/lib/wardrobe/item-images', () => ({
  resolveWardrobeItemHome: (...args: unknown[]) => mockResolveHome(...args),
}))

const mockGenerate = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@/lib/wardrobe/item-image-generation', () => {
  class NoWardrobeImageProfileError extends Error {}
  class WardrobeImageGenerationError extends Error {
    constructor(message: string, readonly trail: unknown[] | null, readonly refused: boolean) {
      super(message)
    }
  }
  return {
    generateWardrobeItemImage: (...args: unknown[]) => mockGenerate(...args),
    NoWardrobeImageProfileError,
    WardrobeImageGenerationError,
  }
})

jest.mock('@/lib/database/repositories/characters.repository', () => ({
  CharacterArchivedError: class CharacterArchivedError extends Error {},
}))

import { handleWardrobeItemImageGeneration } from '@/lib/background-jobs/handlers/wardrobe-item-image'
import {
  NoWardrobeImageProfileError,
  WardrobeImageGenerationError,
} from '@/lib/wardrobe/item-image-generation'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'
import { getRepositories } from '@/lib/repositories/factory'

const repos = { sentinel: 'repos' }

const job = {
  id: 'job-1',
  userId: 'user-1',
  type: 'WARDROBE_ITEM_IMAGE_GENERATION',
  payload: { chatId: 'chat-1', characterId: 'char-1', itemId: 'item-1' },
} as never

const home = { scope: 'character', characterId: 'char-1', item: { id: 'item-1', archivedAt: null } }

describe('handleWardrobeItemImageGeneration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getRepositories).mockReturnValue(repos as never)
    mockResolveHome.mockResolvedValue(home)
    mockGenerate.mockResolvedValue({
      fileId: 'file-1',
      subject: 'worn',
      profile: { id: 'profile-1', name: 'Desk' },
      rerouted: false,
    })
  })

  it("draws the item from its owner's wardrobe", async () => {
    await handleWardrobeItemImageGeneration(job)
    expect(mockResolveHome).toHaveBeenCalledWith(repos, 'user-1', 'character', 'char-1', 'item-1')
    expect(mockGenerate).toHaveBeenCalledWith(repos, {
      userId: 'user-1',
      home,
      containerId: 'char-1',
    })
  })

  it('does nothing when the item is gone', async () => {
    mockResolveHome.mockResolvedValue(null)
    await handleWardrobeItemImageGeneration(job)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('does nothing when the item has been archived', async () => {
    mockResolveHome.mockResolvedValue({ ...home, item: { id: 'item-1', archivedAt: '2026-10-07T00:00:00Z' } })
    await handleWardrobeItemImageGeneration(job)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it.each([
    ['no usable profile', () => new NoWardrobeImageProfileError('none')],
    ['an archived owner', () => new CharacterArchivedError('archived')],
    ['a refusal', () => new WardrobeImageGenerationError('refused', [], true)],
  ])('ends quietly on %s', async (_label, makeError) => {
    mockGenerate.mockRejectedValue(makeError())
    await expect(handleWardrobeItemImageGeneration(job)).resolves.toBeUndefined()
  })

  it('surfaces an unexpected failure', async () => {
    mockGenerate.mockRejectedValue(new Error('disk on fire'))
    await expect(handleWardrobeItemImageGeneration(job)).rejects.toThrow('disk on fire')
  })
})
