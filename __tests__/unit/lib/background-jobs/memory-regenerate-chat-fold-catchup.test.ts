/**
 * Chat memory regenerate × the extraction pipeline.
 *
 * A regenerate wipes the chat's memories (`retireChatMemories`), clears both
 * fold passes' cursors (their rows went with the wipe, bug 207), enqueues one
 * turn job per `listExtractionTurns` entry, then the fold catch-ups with the
 * idle check skipped: `other-fold` only in the `hybrid` / `fold` modes (where
 * it owns most observations of others), `episode-fold` in every mode.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/retire', () => ({
  retireChatMemories: jest.fn(async () => ({ retired: 3, spared: 0, vectorsRemoved: 3 })),
}))
jest.mock('@/lib/background-jobs/queue-service', () => ({ enqueueMemoryExtraction: jest.fn(async () => 'job') }))
jest.mock('@/lib/instance-settings', () => ({ getMemoryExtractionModeSettings: jest.fn() }))
jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { handleMemoryRegenerateChat } from '@/lib/background-jobs/handlers/memory-regenerate-chat'
import { getRepositories } from '@/lib/repositories/factory'
import { enqueueMemoryExtraction } from '@/lib/background-jobs/queue-service'
import { getMemoryExtractionModeSettings } from '@/lib/instance-settings'
import { retireChatMemories } from '@/lib/memory/retire'

const clearForChat = jest.fn(async () => 2)
const findChat = jest.fn()
const findProfile = jest.fn()

const SALON_MESSAGES = [
  { id: 'u1', type: 'message', role: 'USER' },
  { id: 'a1', type: 'message', role: 'ASSISTANT', participantId: 'p-ai' },
  { id: 'u2', type: 'message', role: 'USER' },
  { id: 'a2', type: 'message', role: 'ASSISTANT', participantId: 'p-ai' },
]

function setup(otherPass: 'turn' | 'fold' | 'hybrid', opts: { chatType?: string; messages?: unknown[] } = {}) {
  ;(getMemoryExtractionModeSettings as jest.Mock).mockResolvedValue({
    otherPass,
    perTurnOtherFloor: 0.75,
    foldCandidatesPerSubject: 3,
  })
  findChat.mockResolvedValue({ id: 'chat-1', chatType: opts.chatType ?? 'salon' })
  findProfile.mockResolvedValue({ id: 'profile-1' })
  ;(getRepositories as jest.Mock).mockReturnValue({
    chats: {
      findById: findChat,
      getMessages: jest.fn(async () => opts.messages ?? SALON_MESSAGES),
    },
    connections: { findById: findProfile },
    memoryExtractionCursors: { clearForChat },
  })
}

const job = { id: 'job-9', userId: 'user-1', payload: { chatId: 'chat-1', connectionProfileId: 'profile-1' } }
const payloads = () => (enqueueMemoryExtraction as jest.Mock).mock.calls.map(c => c[1] as Record<string, unknown>)
const catchups = () => payloads().filter(p => p.pass && p.pass !== 'turn')

beforeEach(() => {
  jest.clearAllMocks()
})

describe('memory regenerate — the wipe', () => {
  it('wipes the chat through retireChatMemories and clears its cursors', async () => {
    setup('turn')
    await handleMemoryRegenerateChat(job as never)
    expect(retireChatMemories).toHaveBeenCalledWith('chat-1')
    expect(clearForChat).toHaveBeenCalledWith('chat-1')
  })

  it('wipes orphans and enqueues nothing when the chat is gone', async () => {
    setup('hybrid')
    findChat.mockResolvedValue(null)
    await handleMemoryRegenerateChat(job as never)
    expect(retireChatMemories).toHaveBeenCalledWith('chat-1')
    expect(clearForChat).not.toHaveBeenCalled()
    expect(enqueueMemoryExtraction).not.toHaveBeenCalled()
  })

  it('fails loud, before wiping, when the connection profile is gone', async () => {
    setup('hybrid')
    findProfile.mockResolvedValue(null)
    await expect(handleMemoryRegenerateChat(job as never)).rejects.toThrow('Connection profile not found')
    expect(retireChatMemories).not.toHaveBeenCalled()
  })
})

describe('memory regenerate — turn jobs', () => {
  it('enqueues one turn job per USER opener, without the dedupe scan', async () => {
    setup('turn')
    await handleMemoryRegenerateChat(job as never)
    const turns = payloads().filter(p => !p.pass)
    expect(turns).toEqual([
      { chatId: 'chat-1', turnOpenerMessageId: 'u1', extractionAnchorMessageId: null, connectionProfileId: 'profile-1' },
      { chatId: 'chat-1', turnOpenerMessageId: 'u2', extractionAnchorMessageId: null, connectionProfileId: 'profile-1' },
    ])
    expect((enqueueMemoryExtraction as jest.Mock).mock.calls.every(c => c[2]?.skipDedupCheck === true)).toBe(true)
  })

  it('gives an autonomous room one anchored turn per closing ASSISTANT line', async () => {
    setup('turn', {
      chatType: 'autonomous',
      messages: [
        { id: 'a1', type: 'message', role: 'ASSISTANT', participantId: 'p-1', content: 'one' },
        { id: 'a2', type: 'message', role: 'ASSISTANT', participantId: 'p-2', content: 'two' },
      ],
    })
    await handleMemoryRegenerateChat(job as never)
    const turns = payloads().filter(p => !p.pass)
    expect(turns.map(t => [t.turnOpenerMessageId, t.extractionAnchorMessageId])).toEqual([
      [null, 'a1'],
      [null, 'a2'],
    ])
  })
})

describe('memory regenerate — fold catch-ups', () => {
  it.each(['hybrid', 'fold'] as const)('enqueues idle-skipping other-fold and episode-fold catch-ups in %s mode', async mode => {
    setup(mode)
    await handleMemoryRegenerateChat(job as never)
    expect(catchups()).toEqual([
      expect.objectContaining({ chatId: 'chat-1', turnOpenerMessageId: null, pass: 'other-fold', ignoreIdle: true }),
      expect.objectContaining({ chatId: 'chat-1', turnOpenerMessageId: null, pass: 'episode-fold', ignoreIdle: true }),
    ])
    // Keyed on the regenerate job, so a sweep's own catch-up never swallows it.
    expect(catchups().every(p => p.extractionAnchorMessageId === 'regenerate:job-9')).toBe(true)
  })

  it('enqueues only the episode-fold catch-up in turn mode', async () => {
    setup('turn')
    await handleMemoryRegenerateChat(job as never)
    expect(catchups().map(p => p.pass)).toEqual(['episode-fold'])
  })

  it('enqueues the catch-ups after every turn job', async () => {
    setup('hybrid')
    await handleMemoryRegenerateChat(job as never)
    expect(payloads().map(p => p.pass ?? 'turn')).toEqual(['turn', 'turn', 'other-fold', 'episode-fold'])
  })
})
