/**
 * Chat memory regenerate × fold-grain OTHER pass.
 *
 * In `hybrid` / `fold` extraction modes most observations of other characters
 * come from the fold-grain pass, so a regenerate must reset the chat's
 * watermark and enqueue one catch-up (idle check skipped) alongside the
 * per-turn extractions. In `turn` mode it must do neither.
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

const chatsUpdate = jest.fn()

function setup(otherPass: 'turn' | 'fold' | 'hybrid', watermark: string | null, episodeWatermark: string | null = null) {
  ;(getMemoryExtractionModeSettings as jest.Mock).mockResolvedValue({
    otherPass,
    perTurnOtherFloor: 0.75,
    foldCandidatesPerSubject: 3,
  })
  ;(getRepositories as jest.Mock).mockReturnValue({
    chats: {
      findById: jest.fn(async () => ({
        id: 'chat-1',
        otherExtractionWatermarkMessageId: watermark,
        episodeExtractionWatermarkMessageId: episodeWatermark,
      })),
      getMessages: jest.fn(async () => [
        { id: 'u1', type: 'message', role: 'USER' },
        { id: 'a1', type: 'message', role: 'ASSISTANT' },
      ]),
      update: chatsUpdate,
    },
    connections: { findById: jest.fn(async () => ({ id: 'profile-1' })) },
  })
}

const job = { id: 'job-9', userId: 'user-1', payload: { chatId: 'chat-1', connectionProfileId: 'profile-1' } }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('memory regenerate — the wipe', () => {
  it('wipes the chat through retireChatMemories', async () => {
    setup('turn', null)
    await handleMemoryRegenerateChat(job as never)
    expect(retireChatMemories).toHaveBeenCalledWith('chat-1')
  })
})

describe('memory regenerate — fold-grain OTHER rebuild', () => {
  it('resets the watermark and enqueues an idle-skipping catch-up in hybrid mode', async () => {
    setup('hybrid', 'm-40')
    await handleMemoryRegenerateChat(job as never)

    expect(chatsUpdate).toHaveBeenCalledWith('chat-1', { otherExtractionWatermarkMessageId: null })
    const calls = (enqueueMemoryExtraction as jest.Mock).mock.calls.map((c) => c[1])
    expect(calls).toContainEqual(
      expect.objectContaining({ chatId: 'chat-1', foldOtherCatchup: true, foldOtherIgnoreIdle: true }),
    )
    expect(calls).toContainEqual(expect.objectContaining({ turnOpenerMessageId: 'u1' }))
  })

  it('skips the watermark write when there is none, but still enqueues the catch-up', async () => {
    setup('fold', null)
    await handleMemoryRegenerateChat(job as never)
    expect(chatsUpdate).not.toHaveBeenCalled()
    const calls = (enqueueMemoryExtraction as jest.Mock).mock.calls.map((c) => c[1])
    expect(calls.filter((p) => p.foldOtherCatchup)).toHaveLength(1)
  })

  it('does neither in turn mode', async () => {
    setup('turn', 'm-40')
    await handleMemoryRegenerateChat(job as never)
    expect(chatsUpdate).not.toHaveBeenCalled()
    const calls = (enqueueMemoryExtraction as jest.Mock).mock.calls.map((c) => c[1])
    expect(calls.some((p) => p.foldOtherCatchup)).toBe(false)
  })
})

describe('memory regenerate — episode watermark (bug 207)', () => {
  it('clears the episode watermark, whose episodes the wipe removed, in every mode', async () => {
    for (const mode of ['turn', 'fold', 'hybrid'] as const) {
      chatsUpdate.mockClear()
      setup(mode, null, 'm-30')
      await handleMemoryRegenerateChat(job as never)
      expect(chatsUpdate).toHaveBeenCalledWith('chat-1', { episodeExtractionWatermarkMessageId: null })
    }
  })

  it('leaves a chat with no episode watermark alone', async () => {
    setup('turn', null, null)
    await handleMemoryRegenerateChat(job as never)
    expect(chatsUpdate).not.toHaveBeenCalled()
  })
})
