jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

// The regeneration reads its one provider call as a stream, so the fake
// provider hands back chunks: prose in pieces, then a terminal chunk carrying
// the usage/raw/reasoning the swipe persists.
const streamChunks: Array<Record<string, unknown>> = [
  { content: 'A freshly ', done: false },
  { content: 'regenerated line.', done: false },
  {
    content: '',
    done: true,
    usage: { totalTokens: 12, promptTokens: 8, completionTokens: 4 },
    rawResponse: {},
  },
]

const streamMessage = jest.fn(async function* () {
  for (const chunk of streamChunks) yield chunk
})

jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(async () => ({ streamMessage })),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  deleteMemoriesBySourceMessageWithVectors: jest.fn(),
}))

jest.mock('@/lib/services/chat-message/participant-resolver.service', () => ({
  resolveRespondingParticipant: jest.fn(async () => ({
    characterParticipant: { id: 'p-abigail', status: 'active' },
    character: { id: 'char-abigail', name: 'Abigail' },
    connectionProfile: { provider: 'openai', modelName: 'gpt-x', baseUrl: null, parameters: {} },
    apiKey: 'key',
    isMultiCharacter: true,
  })),
  loadAllParticipantData: jest.fn(async () => ({ participantCharacters: new Map() })),
  getRoleplayTemplate: jest.fn(async () => null),
}))

jest.mock('@/lib/services/chat-message/context-builder.service', () => ({
  buildMessageContext: jest.fn(async () => ({
    formattedMessages: [{ role: 'system', content: 'system prompt for Abigail' }],
    builtContext: {},
    isInitialMessage: false,
  })),
}))

jest.mock('@/lib/services/chat-message/user-identity-resolver.service', () => ({
  resolveUserIdentity: jest.fn(async () => ({ name: 'Revenant', description: '' })),
}))

import { regenerateMessageAsSwipe } from '@/lib/services/chat-message/regenerate-swipe.service'
import { resolveRespondingParticipant } from '@/lib/services/chat-message/participant-resolver.service'
import type { MessageEvent, ChatMetadataBase } from '@/lib/schemas/types'

const now = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()

const buildRepos = (overrides: Record<string, unknown> = {}) => ({
  chats: {
    addMessage: jest.fn(async () => {}),
    updateMessage: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
  },
  chatSettings: {
    findByUserId: jest.fn(async () => ({ memoryCascadePreferences: { onSwipeRegenerate: 'DELETE_MEMORIES' } })),
  },
  memories: {
    countBySourceMessageId: jest.fn(async () => 0),
  },
  ...overrides,
}) as never

const chat = {
  id: 'chat-1',
  participants: [],
  activeTypingParticipantId: null,
} as unknown as ChatMetadataBase

const makeMessage = (id: string, role: 'USER' | 'ASSISTANT', createdMs: number, participantId: string | null, extra: Partial<MessageEvent> = {}): MessageEvent => ({
  type: 'message',
  id,
  role,
  content: `${role} content`,
  attachments: [],
  createdAt: iso(createdMs),
  participantId,
  ...extra,
}) as MessageEvent

beforeEach(() => {
  jest.clearAllMocks()
})

describe('regenerateMessageAsSwipe', () => {
  // Informs re-apply on a swipe and are never consumed by one. A swipe re-rolls
  // a line that was already spoken, so it must see exactly the passages that
  // line's generation saw — and it must not spend a brand-new passage that was
  // meant for the character's next real turn.
  describe('inform re-apply', () => {
    it('passes the target and its whole swipe group to the context builder', async () => {
      const { buildMessageContext } = require('@/lib/services/chat-message/context-builder.service')
      const repos = buildRepos()
      const target = makeMessage('msg-abigail', 'ASSISTANT', now + 100, 'p-abigail', {
        swipeGroupId: 'swipe-msg-abigail',
        swipeIndex: 0,
      })
      const sibling = makeMessage('msg-abigail-2', 'ASSISTANT', now + 100, 'p-abigail', {
        swipeGroupId: 'swipe-msg-abigail',
        swipeIndex: 1,
      })
      const allMessages = [makeMessage('msg-user', 'USER', now, 'p-revenant'), target, sibling]

      await regenerateMessageAsSwipe({ repos, userId: 'user-1', chat, targetMessage: target, allMessages })

      const passedOptions = buildMessageContext.mock.calls[0][0]
      expect(passedOptions.regenerationOfMessageIds).toEqual(
        expect.arrayContaining(['msg-abigail', 'msg-abigail-2']),
      )
      expect(passedOptions.regenerationOfMessageIds).toHaveLength(2)
    })

    it('passes just the target when it has no group yet', async () => {
      const { buildMessageContext } = require('@/lib/services/chat-message/context-builder.service')
      const repos = buildRepos()
      const target = makeMessage('msg-abigail', 'ASSISTANT', now + 100, 'p-abigail')
      const allMessages = [makeMessage('msg-user', 'USER', now, 'p-revenant'), target]

      await regenerateMessageAsSwipe({ repos, userId: 'user-1', chat, targetMessage: target, allMessages })

      expect(buildMessageContext.mock.calls[0][0].regenerationOfMessageIds).toEqual(['msg-abigail'])
    })

    it('never consumes an inform', async () => {
      const markConsumed = jest.fn()
      const repos = buildRepos({ chatInforms: { markConsumed } })
      const target = makeMessage('msg-abigail', 'ASSISTANT', now + 100, 'p-abigail')
      const allMessages = [makeMessage('msg-user', 'USER', now, 'p-revenant'), target]

      await regenerateMessageAsSwipe({ repos, userId: 'user-1', chat, targetMessage: target, allMessages })

      expect(markConsumed).not.toHaveBeenCalled()
    })
  })

  it('attributes the new swipe to the original message participant and groups it in place', async () => {
    const repos = buildRepos()
    const target = makeMessage('msg-abigail', 'ASSISTANT', now + 100, 'p-abigail')
    const allMessages = [
      makeMessage('msg-user', 'USER', now, 'p-revenant'),
      target,
    ]

    const newSwipe = await regenerateMessageAsSwipe({
      repos,
      userId: 'user-1',
      chat,
      targetMessage: target,
      allMessages,
    })

    // Attributed to Abigail (the original's participant), not the user / first participant.
    expect(newSwipe.participantId).toBe('p-abigail')
    expect(newSwipe.content).toBe('A freshly regenerated line.')
    expect(newSwipe.swipeGroupId).toBe('swipe-msg-abigail')
    expect(newSwipe.swipeIndex).toBe(1)
    // Same timestamp as the original so it stays in place.
    expect(newSwipe.createdAt).toBe(target.createdAt)

    // The responder was resolved from the target's own participant.
    expect(resolveRespondingParticipant).toHaveBeenCalledWith(
      repos, chat, 'user-1', 'p-abigail', true
    )

    // The original is anchored at index 0 of the new group (persisted, not just in-memory).
    expect((repos as any).chats.updateMessage).toHaveBeenCalledWith(
      'chat-1', 'msg-abigail', { swipeGroupId: 'swipe-msg-abigail', swipeIndex: 0 }
    )
    expect((repos as any).chats.addMessage).toHaveBeenCalledTimes(1)
  })

  it('appends to an existing swipe group without re-anchoring the original', async () => {
    const repos = buildRepos()
    const target = makeMessage('msg-abigail', 'ASSISTANT', now + 100, 'p-abigail', { swipeGroupId: 'swipe-msg-abigail', swipeIndex: 0 })
    const sibling = makeMessage('msg-swipe-1', 'ASSISTANT', now + 100, 'p-abigail', { swipeGroupId: 'swipe-msg-abigail', swipeIndex: 1 })
    const allMessages = [makeMessage('msg-user', 'USER', now, 'p-revenant'), target, sibling]

    const newSwipe = await regenerateMessageAsSwipe({
      repos, userId: 'user-1', chat, targetMessage: target, allMessages,
    })

    expect(newSwipe.swipeIndex).toBe(2) // max(0,1) + 1
    expect(newSwipe.participantId).toBe('p-abigail')
    // Original already grouped → no re-anchor write.
    expect((repos as any).chats.updateMessage).not.toHaveBeenCalled()
  })

  it('reports each step to onProgress and streams the new line in pieces', async () => {
    const repos = buildRepos()
    const target = makeMessage('msg-abigail', 'ASSISTANT', now + 100, 'p-abigail')
    const allMessages = [makeMessage('msg-user', 'USER', now, 'p-revenant'), target]
    const events: Array<Record<string, unknown>> = []

    const newSwipe = await regenerateMessageAsSwipe({
      repos,
      userId: 'user-1',
      chat,
      targetMessage: target,
      allMessages,
      onProgress: (e) => { events.push(e as unknown as Record<string, unknown>) },
    })

    // The prose arrives as deltas, in order, and concatenates to the saved line.
    const deltas = events.filter(e => e.kind === 'delta').map(e => e.content)
    expect(deltas).toEqual(['A freshly ', 'regenerated line.'])
    expect(newSwipe.content).toBe('A freshly regenerated line.')

    // Every status the Salon narrates says "Regenerating", so the strip above
    // the composer never reads like an ordinary first-time turn.
    const statuses = events.filter(e => e.kind === 'status')
    expect(statuses.length).toBeGreaterThan(0)
    for (const status of statuses) {
      expect(String(status.message)).toMatch(/regenerating/i)
    }
    expect(statuses.map(s => s.stage)).toContain('regenerating')
  })

  it('refuses to regenerate staff/system messages', async () => {
    const repos = buildRepos()
    const staff = makeMessage('msg-host', 'ASSISTANT', now + 100, null, { systemSender: 'host' } as Partial<MessageEvent>)

    await expect(regenerateMessageAsSwipe({
      repos, userId: 'user-1', chat, targetMessage: staff, allMessages: [staff],
    })).rejects.toThrow(/staff and system/i)
    expect((repos as any).chats.addMessage).not.toHaveBeenCalled()
  })
})
