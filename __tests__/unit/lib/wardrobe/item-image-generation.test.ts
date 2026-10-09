/**
 * Wardrobe item picture generation (lib/wardrobe/item-image-generation.ts).
 *
 * The Concierge's image failover is the chokepoint — called with purpose
 * 'wardrobe', and with the chat a tool-queued picture was asked for in
 * (bug 189), or none from the editor. A reroute is reported; a refusal throws the trail and
 * writes nothing; the stored file carries the prompt on record.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

jest.mock('@/lib/logger', () => {
  const base: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  base.child = jest.fn(() => base)
  return { logger: base }
})

const mockGenerateImage = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const mockCreateImageProvider = jest.fn((..._args: unknown[]) => ({ generateImage: mockGenerateImage }))
jest.mock('@/lib/llm/plugin-factory', () => ({
  createImageProvider: (...args: unknown[]) => mockCreateImageProvider(...args),
}))

const mockLogLLMCall = jest.fn<(...args: unknown[]) => Promise<void>>()
jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: (...args: unknown[]) => mockLogLLMCall(...args),
}))

jest.mock('@/lib/image-gen/params-builder', () => ({
  buildImageGenParams: jest.fn(({ prompt, orientation }: { prompt: string; orientation: string }) => ({
    params: { prompt, orientation },
  })),
}))

const mockGetProjectOfficialMountPointId = jest.fn<(...args: unknown[]) => Promise<string | null>>()
jest.mock('@/lib/image-gen/aesthetic', () => ({
  resolveAesthetic: jest.fn(async () => null),
  getProjectOfficialMountPointId: (...args: unknown[]) => mockGetProjectOfficialMountPointId(...args),
}))

const mockResolveProfile = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@/lib/image-gen/profile-resolution', () => ({
  resolveWardrobeImageProfile: (...args: unknown[]) => mockResolveProfile(...args),
}))

const mockConvertToWebP = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@/lib/files/webp-conversion', () => ({
  convertToWebP: (...args: unknown[]) => mockConvertToWebP(...args),
}))

const mockResolveConcierge = jest.fn<(...args: unknown[]) => unknown>()
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveConciergeSettings: (...args: unknown[]) => mockResolveConcierge(...args),
}))

const mockRouteDirect = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  resolveImageProviderForDangerousContent: (...args: unknown[]) => mockRouteDirect(...args),
}))

const mockFailover = jest.fn<(...args: any[]) => Promise<any>>()
jest.mock('@/lib/services/dangerous-content/image-failover', () => {
  const actual = jest.requireActual('@/lib/services/dangerous-content/image-failover') as Record<string, unknown>
  return {
    ...actual,
    generateImageWithConciergeFailover: (...args: unknown[]) => mockFailover(...args),
  }
})

jest.mock('@/lib/mount-index/general-wardrobe', () => ({
  readGeneralWardrobe: jest.fn(async () => []),
}))
jest.mock('@/lib/wardrobe/pool', () => ({
  loadWearablePool: jest.fn(async () => ({})),
  componentGraph: jest.fn(() => new Map()),
}))
jest.mock('@/lib/wardrobe/resolve-equipped', () => ({
  resolveEquippedOutfitForCharacter: jest.fn(),
}))

const mockAddImage = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@/lib/wardrobe/item-images', () => ({
  addWardrobeItemImage: (...args: unknown[]) => mockAddImage(...args),
  wardrobeImageUrl: (id: string) => `/api/v1/files/${id}`,
}))

const {
  generateWardrobeItemImage,
  NoWardrobeImageProfileError,
  WardrobeImageGenerationError,
} = require('@/lib/wardrobe/item-image-generation') as typeof import('@/lib/wardrobe/item-image-generation')

const NOW = '2026-01-01T00:00:00.000Z'

const garment: WardrobeItem = {
  id: '11111111-1111-4111-8111-111111111111',
  characterId: 'char-1',
  title: 'Opera coat',
  description: null,
  imagePrompt: 'emerald velvet opera coat',
  types: ['top'],
  componentItemIds: [],
  appropriateness: null,
  isDefault: false,
  replace: false,
  migratedFromClothingRecordId: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
} as WardrobeItem

const primary = { id: 'prof-primary', name: 'Primary', provider: 'OPENAI', modelName: 'gpt-image-1', apiKeyId: 'key-1', userId: 'user-1' }
const understudy = { id: 'prof-understudy', name: 'Understudy', provider: 'GROK', modelName: 'grok-image', apiKeyId: 'key-2', userId: 'user-1' }

function trailRow(profile: typeof primary, outcome: 'refused' | 'answered' | 'failed', via: string) {
  return {
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    via,
    outcome,
  }
}

function makeHome(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'character' as const,
    characterId: 'char-1',
    item: garment,
    containerItems: [garment],
    resolveMount: jest.fn(async () => 'vault-1'),
    update: jest.fn(async () => null),
    ...overrides,
  }
}

let repos: any

beforeEach(() => {
  jest.clearAllMocks()
  repos = {
    connections: { findApiKeyByIdAndUserId: jest.fn(async () => ({ key_value: 'sk-test' })) },
    characters: {
      findById: jest.fn(async () => ({
        id: 'char-1',
        name: 'Lady Agatha',
        pronouns: { subject: 'she', object: 'her', possessive: 'her' },
        physicalDescription: { id: 'pd', completePrompt: 'Tall woman with silver hair' },
        archivedAt: null,
      })),
    },
    chatSettings: { findByUserId: jest.fn(async () => ({})) },
    chats: { findById: jest.fn(async () => null) },
  }
  mockResolveConcierge.mockReturnValue({ state: 'moderated', routeDirect: false })
  mockResolveProfile.mockResolvedValue(primary)
  mockGetProjectOfficialMountPointId.mockResolvedValue(null)
  mockGenerateImage.mockResolvedValue({ images: [{ data: Buffer.from('png-bytes').toString('base64'), mimeType: 'image/png' }] })
  mockConvertToWebP.mockResolvedValue({ buffer: Buffer.from('webp'), mimeType: 'image/webp', width: 768, height: 1024 })
  mockAddImage.mockResolvedValue({ file: { id: 'file-new', size: 4 }, item: { ...garment, imageFileId: 'file-new' } })
  // Default: the primary answers first time — run the real attempt closure.
  mockFailover.mockImplementation(async (prim: any, attempt: any) => ({
    result: await attempt(prim.profile, prim.apiKey),
    profile: prim.profile,
    apiKey: prim.apiKey,
    rerouted: false,
    trail: [],
  }))
})

describe('generateWardrobeItemImage', () => {
  it('calls the failover chokepoint with no chat and purpose "wardrobe"', async () => {
    const home = makeHome()
    await generateWardrobeItemImage(repos, { userId: 'user-1', home: home as any, containerId: 'char-1' })

    expect(mockFailover).toHaveBeenCalledTimes(1)
    const [prim, , ctx] = mockFailover.mock.calls[0]
    expect(prim).toEqual({ profile: primary, apiKey: 'sk-test' })
    expect(ctx).toMatchObject({ userId: 'user-1', chatId: null, purpose: 'wardrobe' })
    expect(mockCreateImageProvider).toHaveBeenCalledWith('OPENAI')
    expect(mockLogLLMCall).toHaveBeenCalledWith(expect.objectContaining({ type: 'WARDROBE_ITEM_IMAGE', characterId: 'char-1' }))
  })

  it('resolves the Concierge against the chat a tool-queued picture came from (bug 189)', async () => {
    const lockedChat = { id: 'chat-1', conciergeMode: 'locked' }
    repos.chats.findById.mockResolvedValue(lockedChat)
    mockResolveConcierge.mockReturnValue({ state: 'locked', routeDirect: false })

    await generateWardrobeItemImage(repos, {
      userId: 'user-1',
      home: makeHome() as any,
      containerId: 'char-1',
      chatId: 'chat-1',
    })

    expect(repos.chats.findById).toHaveBeenCalledWith('chat-1')
    expect(mockResolveConcierge).toHaveBeenCalledWith({}, lockedChat)
    const [, , ctx] = mockFailover.mock.calls[0]
    expect(ctx).toMatchObject({ chatId: 'chat-1', chat: lockedChat, purpose: 'wardrobe', primaryVia: 'primary' })
    expect(mockRouteDirect).not.toHaveBeenCalled()
  })

  it('routes an Unmoderated chat direct to the uncensored desk', async () => {
    repos.chats.findById.mockResolvedValue({ id: 'chat-1', conciergeMode: 'unmoderated' })
    mockResolveConcierge.mockReturnValue({ state: 'unmoderated', routeDirect: true })
    mockRouteDirect.mockResolvedValue({ rerouted: true, imageProfile: understudy, apiKey: 'sk-understudy' })

    await generateWardrobeItemImage(repos, {
      userId: 'user-1',
      home: makeHome() as any,
      containerId: 'char-1',
      chatId: 'chat-1',
    })

    const [prim, , ctx] = mockFailover.mock.calls[0]
    expect(prim).toEqual({ profile: understudy, apiKey: 'sk-understudy' })
    expect(ctx).toMatchObject({ primaryVia: 'concierge' })
  })

  it('stores the picture with the prompt on record and reports the primary', async () => {
    const home = makeHome()
    const result = await generateWardrobeItemImage(repos, {
      userId: 'user-1',
      home: home as any,
      containerId: 'char-1',
      imageProfileId: 'prof-primary',
    })

    expect(mockResolveProfile).toHaveBeenCalledWith('user-1', repos, 'prof-primary')
    expect(result.subject).toBe('worn')
    expect(result.prompt).toContain('emerald velvet opera coat')
    expect(result.prompt).toContain('Lady Agatha')
    expect(mockAddImage).toHaveBeenCalledTimes(1)
    const [, addHome, input] = mockAddImage.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
    expect(addHome).toBe(home)
    expect(input).toMatchObject({
      userId: 'user-1',
      kind: 'generated',
      contentType: 'image/webp',
      width: 768,
      height: 1024,
      generationPrompt: result.prompt,
      generationModel: 'gpt-image-1',
    })
    expect(result).toMatchObject({
      fileId: 'file-new',
      url: '/api/v1/files/file-new',
      rerouted: false,
      trail: null,
      profile: { id: 'prof-primary', name: 'Primary' },
    })
  })

  it('reports a Concierge reroute: rerouted, the understudy as profile, and the trail', async () => {
    const trail = [trailRow(primary, 'refused', 'primary'), trailRow(understudy, 'answered', 'concierge')]
    mockFailover.mockImplementation(async (_prim: any, attempt: any) => ({
      result: await attempt(understudy, 'sk-understudy'),
      profile: understudy,
      apiKey: 'sk-understudy',
      rerouted: true,
      trail,
    }))

    const result = await generateWardrobeItemImage(repos, { userId: 'user-1', home: makeHome() as any, containerId: 'char-1' })

    expect(result.rerouted).toBe(true)
    expect(result.profile).toEqual({ id: 'prof-understudy', name: 'Understudy' })
    expect(result.trail).toEqual(trail)
    expect((mockAddImage.mock.calls[0][2] as Record<string, unknown>).generationModel).toBe('grok-image')
    expect(mockLogLLMCall).toHaveBeenCalledWith(expect.objectContaining({
      imageProfileId: 'prof-understudy',
      response: expect.objectContaining({ content: expect.stringContaining('Concierge reroute') }),
    }))
  })

  it('throws WardrobeImageGenerationError with the trail on a refusal, and writes nothing', async () => {
    const trail = [trailRow(primary, 'refused', 'primary')]
    const refusal = Object.assign(new Error('Content policy violation'), { conciergeTrail: trail })
    mockFailover.mockRejectedValue(refusal)

    const promise = generateWardrobeItemImage(repos, { userId: 'user-1', home: makeHome() as any, containerId: 'char-1' })
    await expect(promise).rejects.toBeInstanceOf(WardrobeImageGenerationError)
    const error = (await promise.catch((e) => e)) as InstanceType<typeof WardrobeImageGenerationError>
    expect(error.trail).toEqual(trail)
    expect(error.refused).toBe(true)
    expect(error.message).toBe('Content policy violation')
    expect(mockAddImage).not.toHaveBeenCalled()
    expect(mockConvertToWebP).not.toHaveBeenCalled()
  })

  it('a plain failure without a trail is not reported as a refusal', async () => {
    mockFailover.mockRejectedValue(new Error('socket hang up'))
    const error = (await generateWardrobeItemImage(repos, {
      userId: 'user-1',
      home: makeHome() as any,
      containerId: 'char-1',
    }).catch((e) => e)) as InstanceType<typeof WardrobeImageGenerationError>
    expect(error).toBeInstanceOf(WardrobeImageGenerationError)
    expect(error.trail).toBeNull()
    expect(error.refused).toBe(false)
    expect(mockAddImage).not.toHaveBeenCalled()
  })

  it('throws NoWardrobeImageProfileError when no profile resolves', async () => {
    mockResolveProfile.mockResolvedValue(null)
    await expect(
      generateWardrobeItemImage(repos, { userId: 'user-1', home: makeHome() as any, containerId: 'char-1' }),
    ).rejects.toBeInstanceOf(NoWardrobeImageProfileError)
    expect(mockFailover).not.toHaveBeenCalled()
  })

  it('throws NoWardrobeImageProfileError when the profile\'s key cannot be read', async () => {
    repos.connections.findApiKeyByIdAndUserId.mockResolvedValue(null)
    await expect(
      generateWardrobeItemImage(repos, { userId: 'user-1', home: makeHome() as any, containerId: 'char-1' }),
    ).rejects.toBeInstanceOf(NoWardrobeImageProfileError)
    expect(mockFailover).not.toHaveBeenCalled()
  })

  it('refuses a tombstone before spending a provider call', async () => {
    const archived = Object.assign(new Error('archived'), { name: 'CharacterArchivedError' })
    const home = makeHome({ resolveMount: jest.fn(async () => { throw archived }) })
    await expect(
      generateWardrobeItemImage(repos, { userId: 'user-1', home: home as any, containerId: 'char-1' }),
    ).rejects.toBe(archived)
    expect(mockResolveProfile).not.toHaveBeenCalled()
    expect(mockFailover).not.toHaveBeenCalled()
  })

  it('falls back to a catalogue shot when the owner\'s vault is unreadable', async () => {
    repos.characters.findById.mockRejectedValue(new Error('vault broken'))
    const result = await generateWardrobeItemImage(repos, { userId: 'user-1', home: makeHome() as any, containerId: 'char-1' })
    expect(result.subject).toBe('catalogue')
    expect(result.prompt).not.toContain('Lady Agatha')
  })

  it('draws a shared (general) item as a catalogue shot without looking up a character', async () => {
    const shared = { ...garment, characterId: null }
    const home = makeHome({ scope: 'general', characterId: null, item: shared, containerItems: [shared] })
    const result = await generateWardrobeItemImage(repos, { userId: 'user-1', home: home as any, containerId: null })
    expect(result.subject).toBe('catalogue')
    expect(repos.characters.findById).not.toHaveBeenCalled()
  })

  it('throws when the provider returns no picture, without writing', async () => {
    mockGenerateImage.mockResolvedValue({ images: [] })
    await expect(
      generateWardrobeItemImage(repos, { userId: 'user-1', home: makeHome() as any, containerId: 'char-1' }),
    ).rejects.toBeInstanceOf(WardrobeImageGenerationError)
    expect(mockAddImage).not.toHaveBeenCalled()
  })
})
