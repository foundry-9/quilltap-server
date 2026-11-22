/**
 * `lookup_chat_state` reads what a person carries and wears from the chat's
 * equipped records — never from an object's own file — and defaults to the
 * conversation the call came from.
 *
 * @jest-environment node
 */

const mockFindChat = jest.fn()
const mockOutfit = jest.fn()
const mockEquippedSet = jest.fn()
const mockDescribe = jest.fn()
const mockResolveRef = jest.fn()

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    chats: {
      findById: (...a: unknown[]) => mockFindChat(...a),
      getEquippedOutfitForCharacter: (...a: unknown[]) => mockOutfit(...a),
    },
  }),
}))
jest.mock('@/lib/chat/speaker-names', () => ({
  resolveSpeakerNames: async () => new Map([['p-riya', 'Riya'], ['p-amy', 'Amy']]),
}))
jest.mock('@/lib/mount-index/reach', () => ({ resolveProjectMountPointIds: async () => [] }))
jest.mock('@/lib/inventory/equipped-set', () => ({ loadEquippedSet: (...a: unknown[]) => mockEquippedSet(...a) }))
jest.mock('@/lib/wardrobe/resolve-equipped', () => ({
  describeEquippedOutfitTitleOnly: (...a: unknown[]) => mockDescribe(...a),
}))
jest.mock('../conversations', () => ({
  CONVERSATION_CHAT_TYPES: new Set(['salon', 'autonomous']),
  resolveConversationRef: (...a: unknown[]) => mockResolveRef(...a),
}))

import { lookupChatState } from '../chat-state'

const CHAT = {
  id: 'chat-1',
  title: 'The Lantern and the Lock',
  chatType: 'salon',
  projectId: null,
  conciergeMode: null,
  equippedInventory: { 'char-riya': ['obj-1'] },
  sceneState: JSON.stringify({
    location: 'A lamplit study',
    characters: [{ characterId: 'char-riya', characterName: 'Riya', action: 'Riya says she has put the candle away.', appearance: '', clothing: '' }],
    updatedAt: '2026-11-22T20:00:00.000Z',
    updatedAtMessageCount: 10,
  }),
  participants: [
    { id: 'p-amy', type: 'CHARACTER', characterId: 'char-amy', controlledBy: 'llm', status: 'removed', displayOrder: 0 },
    { id: 'p-riya', type: 'CHARACTER', characterId: 'char-riya', controlledBy: 'llm', status: 'active', displayOrder: 1 },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindChat.mockResolvedValue(CHAT)
  mockOutfit.mockImplementation(async (_chat: string, characterId: string) => (characterId === 'char-riya' ? { top: ['g1'] } : null))
  mockDescribe.mockResolvedValue('Workshop Shirt, Worn Jeans')
  mockEquippedSet.mockImplementation(async (_repos: unknown, _chat: unknown, characterId: string) =>
    characterId === 'char-riya' ? [{ id: 'obj-1', name: 'brass lantern', title: 'Stub Candle', emoji: '🕯️', kind: 'item' }] : [],
  )
})

describe('lookupChatState', () => {
  it('defaults to the calling chat and reports the equipped set, present seats first', async () => {
    const r = await lookupChatState({}, { userId: 'u', chatId: 'chat-1' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(mockFindChat).toHaveBeenCalledWith('chat-1')
    expect(r.text).toContain('"The Lantern and the Lock" (chat-1)')
    expect(r.text).toContain('Carrying (equipped in this chat): 🕯️ Stub Candle (brass lantern) [obj-1]')
    expect(r.text).toContain('Wearing (equipped in this chat): Workshop Shirt, Worn Jeans')
    expect(r.text).toContain('Location (scene tracker): A lamplit study')
    expect(r.text).toMatch(/Action, as the story tells it \(the scene tracker's note, not a record\): Riya says/)
    expect(r.text).toContain('equippedByDefault')
    expect(r.text.indexOf('- Riya')).toBeLessThan(r.text.indexOf('- Amy'))
    expect(r.text).toContain('Amy (character, played by a model; not present: removed)')
    expect(r.text).toMatch(/- Amy[^\n]*\n  Carrying \(equipped in this chat\): nothing/)
    expect(r.data.seats).toBe(2)
  })

  it('resolves a named conversation through the conversation resolver', async () => {
    mockResolveRef.mockResolvedValue(CHAT)
    const r = await lookupChatState({ conversation: 'The Lantern and the Lock' }, { userId: 'u' })
    expect(r.ok).toBe(true)
    expect(mockResolveRef).toHaveBeenCalledWith('The Lantern and the Lock')
  })

  it('asks for a conversation when called from outside one', async () => {
    mockFindChat.mockResolvedValue({ ...CHAT, chatType: 'brahma' })
    const r = await lookupChatState({}, { userId: 'u', chatId: 'console-1' })
    expect(r).toEqual({ ok: false, error: expect.stringContaining('pass `conversation`') })
  })

  it('lists an ambiguous title and an unknown one as errors', async () => {
    mockResolveRef.mockResolvedValueOnce({ ambiguous: [CHAT, { ...CHAT, id: 'chat-2' }] })
    const amb = await lookupChatState({ conversation: 'x' }, { userId: 'u' })
    expect(amb).toEqual({ ok: false, error: expect.stringContaining('chat-2') })
    mockResolveRef.mockResolvedValueOnce(null)
    const none = await lookupChatState({ conversation: 'y' }, { userId: 'u' })
    expect(none).toEqual({ ok: false, error: expect.stringContaining('lookup_conversations') })
  })

  it('a failed read costs one line, not the answer', async () => {
    mockEquippedSet.mockRejectedValue(new Error('vault unreadable'))
    const r = await lookupChatState({}, { userId: 'u', chatId: 'chat-1' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toContain('Carrying: could not be read (vault unreadable)')
  })
})
