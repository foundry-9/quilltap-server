/**
 * Turn holds: when an operator's post is recorded and nobody answers it.
 *
 * `resolveTurnHold` / `qualifiesForFairRotationCheck` are the pure rules; the
 * fair-rotation pause is exercised with its collaborators mocked, to pin that
 * it records the post through the one recorder — staged tool results and all
 * (bug 262) — rather than a thinner copy of its own.
 */

jest.mock('@/lib/logging/create-logger', () => {
  const logger = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() })
  return { createServiceLogger: jest.fn(logger), createLogger: jest.fn(logger) }
})

jest.mock('@/lib/services/chat-message/operator-post.service', () => ({
  recordOperatorPost: jest.fn(async () => ({ userMessageId: 'msg-user' })),
}))

jest.mock('@/lib/services/chat-message/context-builder.service', () => ({
  findAttachedFiles: jest.fn(async (_repos: unknown, _chatId: string, ids?: string[]) =>
    (ids ?? []).map(id => ({ id, filename: `${id}.png`, mimeType: 'image/png' }))),
}))

jest.mock('@/lib/chat/turn-manager', () => ({
  ...jest.requireActual('@/lib/chat/turn-manager'),
  loadRoomCharacters: jest.fn(async () => new Map()),
  selectNextSpeakerAfterUserMessage: jest.fn(),
}))

import {
  finishHeldPost,
  maybePauseForUserSeatTurn,
  qualifiesForFairRotationCheck,
  resolveTurnHold,
} from '@/lib/services/chat-message/turn-holds.service'
import { recordOperatorPost } from '@/lib/services/chat-message/operator-post.service'
import { selectNextSpeakerAfterUserMessage } from '@/lib/chat/turn-manager'
import { newSubmissionLedger } from '@/lib/services/chat-message/turn-stream'

const seat = (id: string, controlledBy: 'user' | 'llm') => ({
  id,
  type: 'CHARACTER',
  characterId: `char-${id}`,
  controlledBy,
  isActive: true,
  status: 'active',
})

describe('resolveTurnHold', () => {
  const open = { isPaused: false, turnMode: undefined } as never

  it('answers an ordinary post', () => {
    expect(resolveTurnHold(open, { content: 'hi' })).toBeNull()
  })

  it('holds a post in a paused chat', () => {
    expect(resolveTurnHold({ isPaused: true } as never, { content: 'hi' })).toBe('paused')
  })

  it('never holds a continue-mode summons', () => {
    expect(resolveTurnHold({ isPaused: true, turnMode: 'storyteller' } as never, { continueMode: true })).toBeNull()
  })

  it('opens a storyteller round for a public post', () => {
    expect(resolveTurnHold({ isPaused: false, turnMode: 'storyteller' } as never, { content: 'hi' })).toBe('storyteller')
  })

  it('lets a storyteller whisper draw its one reply (bug 258)', () => {
    expect(resolveTurnHold(
      { isPaused: false, turnMode: 'storyteller' } as never,
      { content: 'psst', targetParticipantIds: ['p1'] },
    )).toBeNull()
  })

  it('the pause outranks the storyteller round', () => {
    expect(resolveTurnHold({ isPaused: true, turnMode: 'storyteller' } as never, { content: 'hi' })).toBe('paused')
  })

  it('an autonomous room is never held', () => {
    expect(resolveTurnHold(
      { isPaused: true, turnMode: 'storyteller' } as never,
      { content: 'hi', neverPauseForUser: true },
    )).toBeNull()
  })
})

describe('qualifiesForFairRotationCheck', () => {
  const room = { participants: [seat('a', 'user'), seat('b', 'llm'), seat('c', 'user')] } as never

  it('looks at a plain post in a multi-character room', () => {
    expect(qualifiesForFairRotationCheck(room, { content: 'hi' }, null)).toBe(true)
  })

  it.each([
    ['a whisper', { content: 'hi', targetParticipantIds: ['b'] }],
    ['a nudge', { content: 'hi', nudge: true }],
    ['a named responder', { content: 'hi', respondingParticipantId: 'b' }],
    ['continue mode', { continueMode: true }],
    ['a post with no words', { content: '' }],
  ])('skips %s', (_label, options) => {
    expect(qualifiesForFairRotationCheck(room, options as never, null)).toBe(false)
  })

  it('skips a post that is already held', () => {
    expect(qualifiesForFairRotationCheck(room, { content: 'hi' }, 'paused')).toBe(false)
  })
})

describe('maybePauseForUserSeatTurn', () => {
  const chat = {
    id: 'chat-1',
    isPaused: false,
    participants: [seat('a', 'user'), seat('b', 'llm'), seat('c', 'user')],
    impersonatingParticipantIds: [],
    spokenThisCycleParticipantIds: [],
    cycleOrderParticipantIds: [],
    turnQueue: [],
  } as never

  const repos = {
    chats: { update: jest.fn() },
    chatSettings: { findByUserId: jest.fn(async () => ({ autoDetectRng: true })) },
  }
  const controller = { enqueue: jest.fn(), close: jest.fn() } as never

  beforeEach(() => jest.clearAllMocks())

  it('records the whole post — staged tool results included — and hands the floor to the other seat', async () => {
    jest.mocked(selectNextSpeakerAfterUserMessage).mockReturnValue({ nextSpeakerId: 'c', reason: 'rotation' } as never)
    const pendingToolResults = [{ tool: 'rng', success: true, result: '4', prompt: '1d6', arguments: {}, createdAt: 'now' }]

    const result = await maybePauseForUserSeatTurn({
      repos: repos as never,
      chatId: 'chat-1',
      chat,
      userId: 'user-1',
      options: { content: 'I roll 1d20', fileIds: ['f1'], pendingToolResults },
      speakingAsParticipantId: 'a',
      ledger: newSubmissionLedger(),
      controller,
      encoder: new TextEncoder(),
    })

    expect(recordOperatorPost).toHaveBeenCalledTimes(1)
    expect(jest.mocked(recordOperatorPost).mock.calls[0][0]).toMatchObject({
      content: 'I roll 1d20',
      fileIds: ['f1'],
      attachedFiles: [{ id: 'f1' }],
      pendingToolResults,
      poster: { participantId: 'a' },
      chatSettings: { autoDetectRng: true },
    })
    expect(repos.chats.update).toHaveBeenCalledWith('chat-1', { lastTurnParticipantId: 'c' })
    expect(result).toMatchObject({ hasContent: false, messageId: 'msg-user', userParticipantId: 'a' })
  })

  it('records nothing when an LLM is up next', async () => {
    jest.mocked(selectNextSpeakerAfterUserMessage).mockReturnValue({ nextSpeakerId: 'b', reason: 'rotation' } as never)
    const result = await maybePauseForUserSeatTurn({
      repos: repos as never,
      chatId: 'chat-1',
      chat,
      userId: 'user-1',
      options: { content: 'hello' },
      speakingAsParticipantId: 'a',
      ledger: newSubmissionLedger(),
      controller,
      encoder: new TextEncoder(),
    })
    expect(result).toBeNull()
    expect(recordOperatorPost).not.toHaveBeenCalled()
  })
})

describe('finishHeldPost', () => {
  const repos = { chats: { update: jest.fn() } }
  const frames = (controller: { enqueue: jest.Mock }) =>
    controller.enqueue.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes as Uint8Array))

  beforeEach(() => jest.clearAllMocks())

  it('a paused hold clears the pending seat and says the room is paused', async () => {
    const controller = { enqueue: jest.fn() }
    const result = await finishHeldPost({
      repos: repos as never,
      chatId: 'chat-1',
      hold: 'paused',
      isMultiCharacter: true,
      userMessageId: 'm1',
      userParticipantId: 'p1',
      content: 'hi',
      controller: controller as never,
      encoder: new TextEncoder(),
    })
    expect(repos.chats.update).toHaveBeenCalledWith('chat-1', { lastTurnParticipantId: null })
    expect(frames(controller).join('')).toContain('"heldUserTurn":true')
    expect(result).toMatchObject({ isPaused: true, hasContent: false, messageId: 'm1' })
  })

  it('a storyteller hold emits nothing and asks for a round', async () => {
    const controller = { enqueue: jest.fn() }
    const result = await finishHeldPost({
      repos: repos as never,
      chatId: 'chat-1',
      hold: 'storyteller',
      isMultiCharacter: true,
      userMessageId: 'm1',
      userParticipantId: 'p1',
      content: 'The door creaks open.',
      controller: controller as never,
      encoder: new TextEncoder(),
    })
    expect(controller.enqueue).not.toHaveBeenCalled()
    expect(result.storytellerHold).toEqual({ triggerMessageId: 'm1', carina: false })
  })
})
