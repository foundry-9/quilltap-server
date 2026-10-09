import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: (() => { const l: Record<string, unknown> = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }; l.child = jest.fn(() => l); return l })(),
}))

const handleAddParticipant = jest.fn()
jest.mock('@/app/api/v1/chats/[id]/helpers', () => ({
  enrichParticipant: jest.fn(async (p: unknown) => p),
  handleAddParticipant: (...args: unknown[]) => handleAddParticipant(...args),
  handleParticipantUpdate: jest.fn(),
  handleRemoveParticipant: jest.fn(),
  resolveParticipantCharacterName: jest.fn(async () => 'Echo'),
}))

jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostAddAnnouncement: jest.fn(),
  postHostRemoveAnnouncement: jest.fn(),
  postHostJoinScenarioAnnouncement: jest.fn(),
}))

jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileIdentityStackForParticipant: jest.fn(),
}))

const applyOutfitSelections = jest.fn()
jest.mock('@/lib/wardrobe/apply-outfit-selections', () => ({
  applyOutfitSelections: (...args: unknown[]) => applyOutfitSelections(...args),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  buildCheapLLMConfig: jest.fn(() => ({})),
}))

jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveProjectMountPointIds: jest.fn(async () => []),
}))

const triggerAvatarGenerationIfEnabled = jest.fn()
jest.mock('@/lib/wardrobe/avatar-generation', () => ({
  triggerAvatarGenerationIfEnabled: (...args: unknown[]) => triggerAvatarGenerationIfEnabled(...args),
}))

const { handleAddParticipantAction } = require('@/app/api/v1/chats/[id]/actions/participants')

const chatId = '33333333-3333-4333-8333-333333333333'
const partA = '11111111-1111-4111-8111-111111111111'
const partB = '22222222-2222-4222-8222-222222222222'
const charA = '44444444-4444-4444-8444-444444444444'
const charB = '55555555-5555-4555-8555-555555555555'
const userId = 'user-1'

function makeRequest(body: unknown): any {
  return { json: async () => body }
}

const equipped = { top: ['shirt-1'], bottom: [], footwear: [], accessories: [] }

function makeRepos(overrides: Record<string, unknown> = {}): any {
  return {
    chats: {
      getEquippedOutfitForCharacter: jest.fn(async () => equipped),
      updateParticipant: jest.fn(),
      ...overrides,
    },
    characters: { findById: jest.fn(async (id: string) => ({ id, name: 'Echo' })) },
    chatSettings: { findByUserId: jest.fn(async () => null) },
  }
}

describe('arriving characters get their outfit avatar (join mid-chat)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('requests an avatar refresh for a newly added character after dressing them', async () => {
    const chat = {
      id: chatId,
      projectId: null,
      participants: [{ id: partA, type: 'CHARACTER', characterId: charA, controlledBy: 'llm', status: 'active' }],
    }
    const newChat = {
      ...chat,
      participants: [
        ...chat.participants,
        { id: partB, type: 'CHARACTER', characterId: charB, controlledBy: 'llm', status: 'active' },
      ],
    }
    handleAddParticipant.mockResolvedValue({ chat: newChat })
    const repos = makeRepos()

    const res = await handleAddParticipantAction(
      makeRequest({ type: 'CHARACTER', characterId: charB }),
      chatId,
      chat,
      { user: { id: userId }, repos },
    )

    expect(res.status).toBe(201)
    expect(applyOutfitSelections).toHaveBeenCalled()
    expect(triggerAvatarGenerationIfEnabled).toHaveBeenCalledTimes(1)
    expect(triggerAvatarGenerationIfEnabled).toHaveBeenCalledWith(repos, expect.objectContaining({
      userId,
      chatId,
      characterId: charB,
    }))
    // Dressed first, then the portrait — the avatar must see the outfit.
    expect(applyOutfitSelections.mock.invocationCallOrder[0])
      .toBeLessThan(triggerAvatarGenerationIfEnabled.mock.invocationCallOrder[0])
  })

  it('requests an avatar refresh for a reactivated character even without a new outfit', async () => {
    const removed = { id: partB, type: 'CHARACTER', characterId: charB, controlledBy: 'llm', status: 'removed' }
    const chat = {
      id: chatId,
      projectId: null,
      participants: [
        { id: partA, type: 'CHARACTER', characterId: charA, controlledBy: 'llm', status: 'active' },
        removed,
      ],
    }
    const updatedChat = {
      ...chat,
      participants: [chat.participants[0], { ...removed, status: 'active' }],
    }
    const repos = makeRepos({ updateParticipant: jest.fn(async () => updatedChat) })

    const res = await handleAddParticipantAction(
      makeRequest({ type: 'CHARACTER', characterId: charB }),
      chatId,
      chat,
      { user: { id: userId }, repos },
    )

    expect(res.status).toBe(200)
    expect(applyOutfitSelections).not.toHaveBeenCalled()
    expect(triggerAvatarGenerationIfEnabled).toHaveBeenCalledWith(repos, expect.objectContaining({
      chatId,
      characterId: charB,
    }))
  })

  it('leaves the avatar alone when the character has nothing equipped', async () => {
    const chat = { id: chatId, projectId: null, participants: [] }
    handleAddParticipant.mockResolvedValue({
      chat: { ...chat, participants: [{ id: partB, type: 'CHARACTER', characterId: charB, status: 'active' }] },
    })
    const repos = makeRepos({ getEquippedOutfitForCharacter: jest.fn(async () => null) })

    await handleAddParticipantAction(
      makeRequest({ type: 'CHARACTER', characterId: charB }),
      chatId,
      chat,
      { user: { id: userId }, repos },
    )

    expect(triggerAvatarGenerationIfEnabled).not.toHaveBeenCalled()
  })

  it('never fails the join when the avatar request throws', async () => {
    const chat = { id: chatId, projectId: null, participants: [] }
    handleAddParticipant.mockResolvedValue({
      chat: { ...chat, participants: [{ id: partB, type: 'CHARACTER', characterId: charB, status: 'active' }] },
    })
    triggerAvatarGenerationIfEnabled.mockImplementationOnce(async () => { throw new Error('boom') })
    const repos = makeRepos()

    const res = await handleAddParticipantAction(
      makeRequest({ type: 'CHARACTER', characterId: charB }),
      chatId,
      chat,
      { user: { id: userId }, repos },
    )

    expect(res.status).toBe(201)
  })
})
