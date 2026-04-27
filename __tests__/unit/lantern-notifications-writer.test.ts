/**
 * Unit tests for postLanternImageNotification — the writer that injects a
 * synthetic ASSISTANT message into a chat when an image is generated.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { getRepositories } from '@/lib/repositories/factory'
import { postLanternImageNotification } from '@/lib/services/lantern-notifications/writer'

jest.mock('@/lib/repositories/factory')
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

const mockGetRepositories = jest.mocked(getRepositories)

function makeRepos(opts: {
  chat?: Record<string, unknown> | null
  project?: Record<string, unknown> | null
  file?: Record<string, unknown> | null
  addMessage?: jest.Mock
  addLink?: jest.Mock
}) {
  return {
    chats: {
      findById: jest.fn().mockResolvedValue(opts.chat ?? null),
      addMessage: opts.addMessage ?? jest.fn().mockResolvedValue(undefined),
    },
    projects: {
      findById: jest.fn().mockResolvedValue(opts.project ?? null),
    },
    files: {
      findById: jest.fn().mockResolvedValue(opts.file ?? null),
      addLink: opts.addLink ?? jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as ReturnType<typeof getRepositories>
}

describe('postLanternImageNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does nothing when chat is missing', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({ chat: null, addMessage }))
    await postLanternImageNotification({
      chatId: 'c1',
      fileId: 'f1',
      kind: { kind: 'background' },
    })
    expect(addMessage).not.toHaveBeenCalled()
  })

  it('does nothing when both chat and project say disabled', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1', projectId: null, alertCharactersOfLanternImages: null },
      project: null,
      addMessage,
    }))
    await postLanternImageNotification({
      chatId: 'c1',
      fileId: 'f1',
      kind: { kind: 'background' },
    })
    expect(addMessage).not.toHaveBeenCalled()
  })

  it('writes an ASSISTANT message with the file attached when enabled on the chat', async () => {
    const addMessage = jest.fn()
    const addLink = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1', projectId: null, alertCharactersOfLanternImages: true },
      project: null,
      addMessage,
      addLink,
    }))

    await postLanternImageNotification({
      chatId: 'c1',
      fileId: 'f1',
      kind: { kind: 'avatar', characterName: 'Algernon' },
    })

    expect(addMessage).toHaveBeenCalledTimes(1)
    const [chatIdArg, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
    expect(chatIdArg).toBe('c1')
    expect(message.type).toBe('message')
    expect(message.role).toBe('ASSISTANT')
    expect(message.participantId).toBeNull()
    expect(message.attachments).toEqual(['f1'])
    expect(typeof message.content).toBe('string')
    expect(message.content as string).toContain('Algernon')
    expect(addLink).toHaveBeenCalledWith('f1', message.id)
  })

  it('inherits from project default when chat setting is null', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1', projectId: 'p1', alertCharactersOfLanternImages: null },
      project: { id: 'p1', defaultAlertCharactersOfLanternImages: true },
      addMessage,
    }))

    await postLanternImageNotification({
      chatId: 'c1',
      fileId: 'f1',
      kind: { kind: 'background' },
    })

    expect(addMessage).toHaveBeenCalledTimes(1)
  })

  it('character-image kind includes the requester name in content', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1', projectId: null, alertCharactersOfLanternImages: true },
      project: null,
      addMessage,
    }))

    await postLanternImageNotification({
      chatId: 'c1',
      fileId: 'f1',
      kind: { kind: 'character-image', requesterName: 'Bertie Wooster' },
    })

    const [, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
    expect(message.content as string).toContain('Bertie Wooster')
  })

  it('includes the generation prompt in avatar announcements when available', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1', projectId: null, alertCharactersOfLanternImages: true },
      project: null,
      file: { id: 'f1', generationPrompt: 'Algernon in a velvet smoking jacket' },
      addMessage,
    }))

    await postLanternImageNotification({
      chatId: 'c1',
      fileId: 'f1',
      kind: { kind: 'avatar', characterName: 'Algernon' },
    })

    const [, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
    expect(message.content as string).toContain('aiming for')
    expect(message.content as string).toContain('velvet smoking jacket')
  })

  it('includes the generation prompt in background announcements when available', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1', projectId: null, alertCharactersOfLanternImages: true },
      project: null,
      file: { id: 'f1', generationPrompt: 'a moonlit conservatory in bloom' },
      addMessage,
    }))

    await postLanternImageNotification({
      chatId: 'c1',
      fileId: 'f1',
      kind: { kind: 'background' },
    })

    const [, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
    expect(message.content as string).toContain('aiming for')
    expect(message.content as string).toContain('moonlit conservatory')
  })

  it('falls back to the plain wording when no generation prompt is on the file', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1', projectId: null, alertCharactersOfLanternImages: true },
      project: null,
      file: { id: 'f1', generationPrompt: null },
      addMessage,
    }))

    await postLanternImageNotification({
      chatId: 'c1',
      fileId: 'f1',
      kind: { kind: 'background' },
    })

    const [, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
    expect(message.content as string).not.toContain('aiming for')
    expect(message.content as string).toContain('projected a new backdrop')
  })

  it('does not throw when addMessage fails', async () => {
    const addMessage = jest.fn().mockRejectedValue(new Error('DB offline'))
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1', projectId: null, alertCharactersOfLanternImages: true },
      project: null,
      addMessage,
    }))

    await expect(
      postLanternImageNotification({
        chatId: 'c1',
        fileId: 'f1',
        kind: { kind: 'background' },
      })
    ).resolves.toBeUndefined()
  })
})
