import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { resolveImageProfileForChat, resolveWardrobeImageProfile } from '@/lib/image-gen/profile-resolution'

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

describe('resolveWardrobeImageProfile', () => {
  type Profile = { id: string; userId: string; apiKeyId: string | null }
  let profiles: Record<string, Profile>
  let repos: {
    imageProfiles: { findById: jest.Mock; findDefault: jest.Mock }
    chatSettings: { findByUserId: jest.Mock }
  }

  const good = (id: string): Profile => ({ id, userId: 'user-1', apiKeyId: `key-${id}` })

  beforeEach(() => {
    profiles = {
      override: good('override'),
      designated: good('designated'),
      lantern: good('lantern'),
    }
    repos = {
      imageProfiles: {
        findById: jest.fn(async (id: string) => profiles[id] ?? null),
        findDefault: jest.fn().mockResolvedValue(good('default')),
      },
      chatSettings: {
        findByUserId: jest.fn().mockResolvedValue({
          wardrobeImageSettings: { imageProfileId: 'designated' },
          storyBackgroundsSettings: { enabled: true, defaultImageProfileId: 'lantern' },
        }),
      },
    }
  })

  it('prefers the per-generation override', async () => {
    const result = await resolveWardrobeImageProfile('user-1', repos as any, 'override')
    expect(result?.id).toBe('override')
    expect(repos.chatSettings.findByUserId).not.toHaveBeenCalled()
    expect(repos.imageProfiles.findDefault).not.toHaveBeenCalled()
  })

  it('falls to the designated wardrobe profile without an override', async () => {
    const result = await resolveWardrobeImageProfile('user-1', repos as any)
    expect(result?.id).toBe('designated')
    expect(repos.imageProfiles.findDefault).not.toHaveBeenCalled()
  })

  it('falls to the default profile when nothing is designated', async () => {
    repos.chatSettings.findByUserId.mockResolvedValue({ wardrobeImageSettings: { imageProfileId: null } })
    const result = await resolveWardrobeImageProfile('user-1', repos as any)
    expect(result?.id).toBe('default')
  })

  it('rejects an override without an API key and moves on', async () => {
    profiles.override = { ...good('override'), apiKeyId: null }
    const result = await resolveWardrobeImageProfile('user-1', repos as any, 'override')
    expect(result?.id).toBe('designated')
  })

  it('rejects an override that belongs to another user', async () => {
    profiles.override = { ...good('override'), userId: 'user-2' }
    const result = await resolveWardrobeImageProfile('user-1', repos as any, 'override')
    expect(result?.id).toBe('designated')
  })

  it('rejects a designated profile without an API key, or of another user', async () => {
    profiles.designated = { ...good('designated'), apiKeyId: null }
    expect((await resolveWardrobeImageProfile('user-1', repos as any))?.id).toBe('default')

    profiles.designated = { ...good('designated'), userId: 'user-2' }
    expect((await resolveWardrobeImageProfile('user-1', repos as any))?.id).toBe('default')
  })

  it('rejects a default profile without an API key, returning null', async () => {
    profiles.designated = { ...good('designated'), apiKeyId: null }
    repos.imageProfiles.findDefault.mockResolvedValue({ ...good('default'), apiKeyId: null })
    expect(await resolveWardrobeImageProfile('user-1', repos as any)).toBeNull()
  })

  it('never consults the Lantern\'s storyBackgroundsSettings profile', async () => {
    repos.chatSettings.findByUserId.mockResolvedValue({
      storyBackgroundsSettings: { enabled: true, defaultImageProfileId: 'lantern' },
    })
    repos.imageProfiles.findDefault.mockResolvedValue(null)

    const result = await resolveWardrobeImageProfile('user-1', repos as any)
    expect(result).toBeNull()
    expect(repos.imageProfiles.findById).not.toHaveBeenCalledWith('lantern')
  })
})
