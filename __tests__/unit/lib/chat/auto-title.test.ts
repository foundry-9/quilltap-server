/**
 * applyAutoTitle — the one gate an automatic chat title passes through.
 *
 * Bug 163: a rename from the context-summary fold never queued a story
 * background. Bug 164: the same rename overwrote a title the user had set by
 * hand. Both rules now live here, so both rename paths obey them.
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/image-gen/profile-resolution', () => ({
  resolveImageProfileForChat: jest.fn(async () => 'image-profile-1'),
}))
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueStoryBackgroundGeneration: jest.fn(async () => ({ jobId: 'bg-1', isNew: true })),
}))

import { applyAutoTitle } from '@/lib/chat/auto-title'
import { getRepositories } from '@/lib/repositories/factory'
import { enqueueStoryBackgroundGeneration } from '@/lib/background-jobs/queue-service'
import type { ChatSettings } from '@/lib/schemas/types'

const mockRepos = getRepositories as jest.Mock
const mockEnqueue = enqueueStoryBackgroundGeneration as jest.Mock

const chatSettings = { storyBackgroundsSettings: { enabled: true } } as unknown as ChatSettings

function prime(chatOver: Record<string, unknown> = {}) {
  const chat = {
    id: 'chat-1',
    chatType: 'salon',
    title: 'Flying Above the Clouds',
    isManuallyRenamed: false,
    projectId: 'proj-1',
    participants: [{ id: 'p-1', characterId: 'char-amy', status: 'active' }],
    ...chatOver,
  }
  const update = jest.fn(async () => undefined)
  mockRepos.mockReturnValue({ chats: { findById: jest.fn(async () => chat), update } })
  return update
}

const call = (over: Record<string, unknown> = {}) => applyAutoTitle({
  userId: 'user-1',
  chatId: 'chat-1',
  title: 'Stars Over Bear Lodge',
  chatSettings,
  source: 'summary-fold',
  ...over,
})

beforeEach(() => jest.clearAllMocks())

describe('applyAutoTitle', () => {
  it('writes a changed title and queues a story background (bug 163)', async () => {
    const update = prime()
    expect(await call()).toBe('applied')

    expect(update).toHaveBeenCalledWith('chat-1', expect.objectContaining({ title: 'Stars Over Bear Lodge' }))
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', expect.objectContaining({
      chatId: 'chat-1',
      characterIds: ['char-amy'],
      sceneContext: 'Stars Over Bear Lodge',
      projectId: 'proj-1',
    }))
  })

  it('leaves a hand-renamed chat alone but still writes the extra patch (bug 164)', async () => {
    const update = prime({ isManuallyRenamed: true, title: 'Mine' })
    expect(await call({ extraPatch: { lastRenameCheckInterchange: 5 } })).toBe('manually-renamed')

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][1]).not.toHaveProperty('title')
    expect(update.mock.calls[0][1]).toMatchObject({ lastRenameCheckInterchange: 5 })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('writes nothing for a hand-renamed chat with no extra patch', async () => {
    const update = prime({ isManuallyRenamed: true })
    expect(await call()).toBe('manually-renamed')
    expect(update).not.toHaveBeenCalled()
  })

  it('does not queue a background when the title did not change', async () => {
    const update = prime({ title: 'Stars Over Bear Lodge' })
    expect(await call()).toBe('unchanged')
    expect(update).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('does not queue a background for a help chat', async () => {
    prime({ chatType: 'help' })
    expect(await call()).toBe('applied')
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('does not queue a background without chat settings', async () => {
    prime()
    expect(await call({ chatSettings: null })).toBe('applied')
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('overrules a hand rename when the user asks to regenerate', async () => {
    const update = prime({ isManuallyRenamed: true, title: 'Mine' })
    expect(await call({ clearManualRename: true, source: 'regenerate' })).toBe('applied')

    expect(update).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      title: 'Stars Over Bear Lodge',
      isManuallyRenamed: false,
    }))
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })

  it('reports a chat that vanished', async () => {
    mockRepos.mockReturnValue({ chats: { findById: jest.fn(async () => null), update: jest.fn() } })
    expect(await call()).toBe('missing')
  })
})
