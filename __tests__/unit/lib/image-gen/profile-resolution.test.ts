import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { resolveImageProfileForChat } from '@/lib/image-gen/profile-resolution'

describe('resolveImageProfileForChat', () => {
  let repos: {
    imageProfiles: {
      findById: jest.Mock
      findDefault: jest.Mock
    }
    projects: {
      findById: jest.Mock
    }
  }

  beforeEach(() => {
    repos = {
      imageProfiles: {
        findById: jest.fn(),
        findDefault: jest.fn().mockResolvedValue(null),
      },
      projects: {
        findById: jest.fn().mockResolvedValue(null),
      },
    }
  })

  it('prefers a valid chat-level image profile', async () => {
    repos.imageProfiles.findById.mockResolvedValue({
      id: 'profile-chat',
      userId: 'user-1',
      apiKeyId: 'api-key-1',
    })

    const result = await resolveImageProfileForChat(
      'user-1',
      { id: 'chat-1', imageProfileId: 'profile-chat' } as any,
      null,
      repos as any,
    )

    expect(result).toBe('profile-chat')
    expect(repos.projects.findById).not.toHaveBeenCalled()
    expect(repos.imageProfiles.findDefault).not.toHaveBeenCalled()
  })

  it('falls back to story background settings when the chat-level profile is unusable', async () => {
    repos.imageProfiles.findById
      .mockResolvedValueOnce({
        id: 'profile-chat',
        userId: 'someone-else',
        apiKeyId: 'wrong-user-key',
      })
      .mockResolvedValueOnce({
        id: 'profile-settings',
        userId: 'user-1',
        apiKeyId: 'api-key-2',
      })

    const result = await resolveImageProfileForChat(
      'user-1',
      { id: 'chat-1', imageProfileId: 'profile-chat' } as any,
      {
        storyBackgroundsSettings: {
          enabled: true,
          defaultImageProfileId: 'profile-settings',
        },
      } as any,
      repos as any,
    )

    expect(result).toBe('profile-settings')
    expect(repos.projects.findById).not.toHaveBeenCalled()
  })

  it('uses the project default image profile before the global default', async () => {
    repos.projects.findById.mockResolvedValue({ defaultImageProfileId: 'profile-project' })
    repos.imageProfiles.findById.mockResolvedValue({
      id: 'profile-project',
      userId: 'user-1',
      apiKeyId: 'api-key-3',
    })

    const result = await resolveImageProfileForChat(
      'user-1',
      { id: 'chat-1', projectId: 'project-1' } as any,
      null,
      repos as any,
    )

    expect(result).toBe('profile-project')
    expect(repos.projects.findById).toHaveBeenCalledWith('project-1')
    expect(repos.imageProfiles.findDefault).not.toHaveBeenCalled()
  })

  it('falls back to the user default profile when project-scoped options are unavailable', async () => {
    repos.projects.findById.mockResolvedValue({ defaultImageProfileId: 'profile-project' })
    repos.imageProfiles.findById.mockResolvedValue({
      id: 'profile-project',
      userId: 'user-1',
      apiKeyId: null,
    })
    repos.imageProfiles.findDefault.mockResolvedValue({
      id: 'profile-default',
      userId: 'user-1',
      apiKeyId: 'api-key-4',
    })

    const result = await resolveImageProfileForChat(
      'user-1',
      { id: 'chat-1', projectId: 'project-1' } as any,
      null,
      repos as any,
    )

    expect(result).toBe('profile-default')
    expect(repos.imageProfiles.findDefault).toHaveBeenCalledWith('user-1')
  })

  it('returns null when no usable profile exists anywhere in the chain', async () => {
    repos.imageProfiles.findDefault.mockResolvedValue({
      id: 'profile-default',
      userId: 'user-1',
      apiKeyId: null,
    })

    const result = await resolveImageProfileForChat(
      'user-1',
      { id: 'chat-1', projectId: 'project-1' } as any,
      null,
      repos as any,
    )

    expect(result).toBeNull()
  })
})
