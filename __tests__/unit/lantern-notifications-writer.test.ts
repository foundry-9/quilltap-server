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
    // Spec: every image announcement must carry the file UUID inline so any
    // character reading the message in chat history has the handle required
    // to call keep_image / attach_image on it.
    expect(message.content as string).toContain('f1')
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

  it('includes the generation prompt in avatar announcements when passed in', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1', projectId: null, alertCharactersOfLanternImages: true },
      project: null,
      addMessage,
    }))

    await postLanternImageNotification({
      chatId: 'c1',
      fileId: 'f1',
      kind: { kind: 'avatar', characterName: 'Algernon' },
      prompt: 'Algernon in a velvet smoking jacket',
    })

    const [, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
    expect(message.content as string).toContain('is requesting a new portrait be commissioned')
    expect(message.content as string).toContain('omits unnecessary detail')
    expect(message.content as string).toContain('velvet smoking jacket')
  })

  it('includes the generation prompt in background announcements when passed in', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1', projectId: null, alertCharactersOfLanternImages: true },
      project: null,
      addMessage,
    }))

    await postLanternImageNotification({
      chatId: 'c1',
      fileId: 'f1',
      kind: { kind: 'background' },
      prompt: 'a moonlit conservatory in bloom',
    })

    const [, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
    expect(message.content as string).toContain('aiming for')
    expect(message.content as string).toContain('moonlit conservatory')
  })

  it('falls back to the plain wording when no prompt is passed', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1', projectId: null, alertCharactersOfLanternImages: true },
      project: null,
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
    expect(message.content as string).toContain('f1')
  })

  it('includes the file UUID in every announcement variant', async () => {
    const cases: Array<{ kind: Parameters<typeof postLanternImageNotification>[0]['kind']; prompt?: string }> = [
      { kind: { kind: 'avatar', characterName: 'Algernon' } },
      { kind: { kind: 'avatar', characterName: 'Algernon' }, prompt: 'velvet jacket' },
      { kind: { kind: 'background' } },
      { kind: { kind: 'background' }, prompt: 'moonlit conservatory' },
      { kind: { kind: 'character-image', requesterName: 'Bertie' } },
    ]
    for (const c of cases) {
      const addMessage = jest.fn()
      mockGetRepositories.mockReturnValue(makeRepos({
        chat: { id: 'c1', projectId: null, alertCharactersOfLanternImages: true },
        project: null,
        addMessage,
      }))
      await postLanternImageNotification({
        chatId: 'c1',
        fileId: 'photo-uuid-xyz',
        kind: c.kind,
        prompt: c.prompt,
      })
      const [, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
      expect(message.content as string).toContain('photo-uuid-xyz')
    }
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
