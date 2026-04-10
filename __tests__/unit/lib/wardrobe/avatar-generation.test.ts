import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockEnqueueCharacterAvatarGeneration = jest.fn()
const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
}

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueCharacterAvatarGeneration: (...args: unknown[]) => mockEnqueueCharacterAvatarGeneration(...args),
}))

jest.mock('@/lib/logger', () => ({
  logger: mockLogger,
}))

const { triggerAvatarGenerationIfEnabled } = require('@/lib/wardrobe/avatar-generation') as {
  triggerAvatarGenerationIfEnabled: typeof import('@/lib/wardrobe/avatar-generation').triggerAvatarGenerationIfEnabled
}

describe('triggerAvatarGenerationIfEnabled', () => {
  let repos: {
    chats: { findById: jest.Mock }
    imageProfiles: { findById: jest.Mock; findAll: jest.Mock }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockEnqueueCharacterAvatarGeneration.mockResolvedValue(undefined)

    repos = {
      chats: {
        findById: jest.fn(),
      },
      imageProfiles: {
        findById: jest.fn(),
        findAll: jest.fn(),
      },
    }
  })

  it('skips enqueueing when avatar generation is disabled for the chat', async () => {
    repos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      avatarGenerationEnabled: false,
    })

    await triggerAvatarGenerationIfEnabled(repos as never, {
      userId: 'user-1',
      chatId: 'chat-1',
      characterId: 'char-1',
      callerContext: 'wardrobe-update-outfit-handler',
    })

    expect(mockEnqueueCharacterAvatarGeneration).not.toHaveBeenCalled()
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Avatar generation not enabled for chat, skipping',
      expect.objectContaining({ chatId: 'chat-1' })
    )
  })

  it('uses the chat-specific image profile when it exists', async () => {
    repos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      avatarGenerationEnabled: true,
      imageProfileId: 'profile-chat',
    })
    repos.imageProfiles.findById.mockResolvedValue({ id: 'profile-chat' })

    await triggerAvatarGenerationIfEnabled(repos as never, {
      userId: 'user-1',
      chatId: 'chat-1',
      characterId: 'char-1',
      callerContext: 'wardrobe-update-outfit-handler',
    })

    expect(mockEnqueueCharacterAvatarGeneration).toHaveBeenCalledWith('user-1', {
      chatId: 'chat-1',
      characterId: 'char-1',
      imageProfileId: 'profile-chat',
    })
    expect(repos.imageProfiles.findAll).not.toHaveBeenCalled()
  })

  it('falls back to the default image profile when the chat profile is missing', async () => {
    repos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      avatarGenerationEnabled: true,
      imageProfileId: 'profile-missing',
    })
    repos.imageProfiles.findById.mockResolvedValue(null)
    repos.imageProfiles.findAll.mockResolvedValue([
      { id: 'profile-a', isDefault: false },
      { id: 'profile-default', isDefault: true },
    ])

    await triggerAvatarGenerationIfEnabled(repos as never, {
      userId: 'user-1',
      chatId: 'chat-1',
      characterId: 'char-1',
      callerContext: 'wardrobe-update-outfit-handler',
    })

    expect(mockEnqueueCharacterAvatarGeneration).toHaveBeenCalledWith('user-1', {
      chatId: 'chat-1',
      characterId: 'char-1',
      imageProfileId: 'profile-default',
    })
  })

  it('swallows repository failures and logs a warning', async () => {
    repos.chats.findById.mockRejectedValue(new Error('database unavailable'))

    await expect(
      triggerAvatarGenerationIfEnabled(repos as never, {
        userId: 'user-1',
        chatId: 'chat-1',
        characterId: 'char-1',
        callerContext: 'wardrobe-update-outfit-handler',
      })
    ).resolves.toBeUndefined()

    expect(mockEnqueueCharacterAvatarGeneration).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to enqueue avatar generation after outfit change',
      expect.objectContaining({
        chatId: 'chat-1',
        characterId: 'char-1',
        error: 'database unavailable',
      })
    )
  })
})
