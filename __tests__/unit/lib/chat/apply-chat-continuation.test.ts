/**
 * applyChatContinuation — the left-behind notice (bug 171).
 *
 * "Continue Elsewhere" replays the source chat's carryover into the new chat
 * but drops the lines of anyone not seated there, while keeping everyone
 * else's lines *to* them. Without a notice the cast reads the missing person
 * as present and silent. The continuation now names them through the Host's
 * off-scene announcement with `reason: 'left-behind'`.
 *
 * The persona half (bug 172): the operator's unseated persona stays "in the
 * room" in a Salon chat (it voices the USER messages) and is not named, but in
 * an autonomous room it is as absent as anyone.
 */

// Use the global `jest` (not @jest/globals) so jest.mock(...) calls are
// hoisted above the ES module imports by the SWC transform.

import { applyChatContinuation } from '@/lib/chat/apply-chat-continuation'
import {
  postHostContinuationFromAnnouncement,
  postHostContinuationToAnnouncement,
  postHostOffSceneCharactersAnnouncement,
} from '@/lib/services/host-notifications/writer'

jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostContinuationFromAnnouncement: jest.fn(),
  postHostContinuationToAnnouncement: jest.fn(),
  postHostOffSceneCharactersAnnouncement: jest.fn(),
}))

const mockedFrom = postHostContinuationFromAnnouncement as jest.Mock
const mockedTo = postHostContinuationToAnnouncement as jest.Mock
const mockedOffScene = postHostOffSceneCharactersAnnouncement as jest.Mock

const seat = (id: string, characterId: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'CHARACTER',
  characterId,
  controlledBy: 'llm',
  status: 'active',
  isActive: true,
  displayOrder: 0,
  ...extra,
})

const characters: Record<string, { id: string; name: string; identity?: string }> = {
  'char-charlie': { id: 'char-charlie', name: 'Charlie', identity: 'The proprietor.' },
  'char-friday': { id: 'char-friday', name: 'Friday' },
  'char-amy': { id: 'char-amy', name: 'Amy' },
  'char-ariel': { id: 'char-ariel', name: 'Ariel' },
}

function buildRepos(opts: {
  sourceParticipants: unknown[]
  newParticipants: unknown[]
  newChatType: 'salon' | 'autonomous'
  userControlled?: string[]
}) {
  const sourceChat = { id: 'src', title: 'The Cottage', participants: opts.sourceParticipants }
  const newChat = {
    id: 'new',
    title: 'The Sunroom',
    chatType: opts.newChatType,
    participants: opts.newParticipants,
  }
  return {
    chats: {
      findById: jest.fn(async (id: string) => (id === 'src' ? sourceChat : id === 'new' ? newChat : null)),
      getMessages: jest.fn(async () => [
        { type: 'message', id: 'm1', role: 'ASSISTANT', participantId: 'src-charlie', content: 'I will think on it.' },
        { type: 'message', id: 'm2', role: 'ASSISTANT', participantId: 'src-friday', content: 'Charlie, answer her.' },
      ]),
      addMessage: jest.fn(),
      update: jest.fn(),
    },
    characters: {
      findById: jest.fn(async (id: string) => characters[id] ?? null),
      findUserControlled: jest.fn(async () => (opts.userControlled ?? []).map((id) => characters[id])),
    },
    users: {
      findById: jest.fn(async () => ({ id: 'user', name: 'Charles Sebold' })),
    },
  }
}

describe('applyChatContinuation — left-behind notice', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedFrom.mockResolvedValue({ id: 'from' })
    mockedTo.mockResolvedValue({ id: 'to' })
    mockedOffScene.mockResolvedValue({ id: 'offscene' })
  })

  it('names a character who was seated in the source chat but not brought along', async () => {
    const repos = buildRepos({
      sourceParticipants: [seat('src-charlie', 'char-charlie'), seat('src-friday', 'char-friday')],
      newParticipants: [seat('new-friday', 'char-friday')],
      newChatType: 'salon',
    })

    const result = await applyChatContinuation({ newChatId: 'new', sourceChatId: 'src', userId: 'user', repos: repos as any })

    expect(mockedOffScene).toHaveBeenCalledTimes(1)
    const call = mockedOffScene.mock.calls[0][0]
    expect(call.chatId).toBe('new')
    expect(call.reason).toBe('left-behind')
    expect(call.characters.map((c: { name: string }) => c.name)).toEqual(['Charlie'])
    expect(result.leftBehindCharacterIds).toEqual(['char-charlie'])
    // Charlie's own line is dropped; Friday's line to him is kept.
    expect(repos.chats.addMessage).toHaveBeenCalledTimes(1)
  })

  it('posts the notice after the carryover, so it is the last word before the new scene', async () => {
    const repos = buildRepos({
      sourceParticipants: [seat('src-charlie', 'char-charlie'), seat('src-friday', 'char-friday')],
      newParticipants: [seat('new-friday', 'char-friday')],
      newChatType: 'salon',
    })

    await applyChatContinuation({ newChatId: 'new', sourceChatId: 'src', userId: 'user', repos: repos as any })

    const replayOrder = repos.chats.addMessage.mock.invocationCallOrder[0]
    const noticeOrder = mockedOffScene.mock.invocationCallOrder[0]
    expect(noticeOrder).toBeGreaterThan(replayOrder)
  })

  it('posts nothing when everyone came along', async () => {
    const repos = buildRepos({
      sourceParticipants: [seat('src-friday', 'char-friday')],
      newParticipants: [seat('new-friday', 'char-friday'), seat('new-amy', 'char-amy')],
      newChatType: 'salon',
    })

    const result = await applyChatContinuation({ newChatId: 'new', sourceChatId: 'src', userId: 'user', repos: repos as any })

    expect(mockedOffScene).not.toHaveBeenCalled()
    expect(result.leftBehindCharacterIds).toEqual([])
  })

  it('does not name a participant already removed from the source chat', async () => {
    const repos = buildRepos({
      sourceParticipants: [seat('src-ariel', 'char-ariel', { status: 'removed' }), seat('src-friday', 'char-friday')],
      newParticipants: [seat('new-friday', 'char-friday')],
      newChatType: 'salon',
    })

    await applyChatContinuation({ newChatId: 'new', sourceChatId: 'src', userId: 'user', repos: repos as any })

    expect(mockedOffScene).not.toHaveBeenCalled()
  })

  it('does not name the unseated persona in a Salon chat, where it voices the operator', async () => {
    const repos = buildRepos({
      sourceParticipants: [
        seat('src-charlie', 'char-charlie', { controlledBy: 'user' }),
        seat('src-friday', 'char-friday'),
      ],
      newParticipants: [seat('new-friday', 'char-friday')],
      newChatType: 'salon',
      userControlled: ['char-charlie'],
    })

    await applyChatContinuation({ newChatId: 'new', sourceChatId: 'src', userId: 'user', repos: repos as any })

    expect(mockedOffScene).not.toHaveBeenCalled()
  })

  it('names the unseated persona when the continuation is an autonomous room (bug 172)', async () => {
    const repos = buildRepos({
      sourceParticipants: [
        seat('src-charlie', 'char-charlie', { controlledBy: 'user' }),
        seat('src-friday', 'char-friday'),
      ],
      newParticipants: [seat('new-friday', 'char-friday')],
      newChatType: 'autonomous',
      userControlled: ['char-charlie'],
    })

    const result = await applyChatContinuation({ newChatId: 'new', sourceChatId: 'src', userId: 'user', repos: repos as any })

    expect(mockedOffScene).toHaveBeenCalledTimes(1)
    expect(mockedOffScene.mock.calls[0][0].characters.map((c: { id: string }) => c.id)).toEqual(['char-charlie'])
    expect(result.leftBehindCharacterIds).toEqual(['char-charlie'])
  })

  it('skips a character whose vault cannot be read without failing the continuation', async () => {
    const repos = buildRepos({
      sourceParticipants: [
        seat('src-charlie', 'char-charlie'),
        seat('src-ariel', 'char-ariel'),
        seat('src-friday', 'char-friday'),
      ],
      newParticipants: [seat('new-friday', 'char-friday')],
      newChatType: 'autonomous',
    })
    repos.characters.findById.mockImplementation(async (id: string) => {
      if (id === 'char-ariel') throw new Error('vault unavailable')
      return characters[id] ?? null
    })

    const result = await applyChatContinuation({ newChatId: 'new', sourceChatId: 'src', userId: 'user', repos: repos as any })

    expect(mockedOffScene.mock.calls[0][0].characters.map((c: { id: string }) => c.id)).toEqual(['char-charlie'])
    expect(result.postedSourceTailBubble).toBe(true)
  })
})
