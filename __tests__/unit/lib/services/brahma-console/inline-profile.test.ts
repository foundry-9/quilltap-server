/**
 * Unit tests for `resolveInlineBrahmaConnectionProfile` — the one place the
 * inline `@Brahma` profile order lives: project override → global instance
 * setting → the user's default. A stale id falls through to the next step.
 */

jest.mock('@/lib/instance-settings', () => ({
  getBrahmaConsoleSettings: jest.fn(),
}))

import { getBrahmaConsoleSettings } from '@/lib/instance-settings'
import { resolveInlineBrahmaConnectionProfile } from '@/lib/services/brahma-console/inline-profile'

const getSettings = getBrahmaConsoleSettings as jest.MockedFunction<typeof getBrahmaConsoleSettings>

const USER = 'user-1'
const CHAT = 'chat-1'
const PROJECT = 'project-1'

const profile = (id: string, userId = USER) => ({ id, userId, name: id })

function makeRepos(opts: {
  chat?: { projectId?: string | null } | null
  project?: { brahmaConnectionProfileId?: string | null } | null
  profiles?: Array<{ id: string; userId: string; name: string }>
  defaultProfile?: { id: string; userId: string; name: string } | null
}) {
  const profiles = opts.profiles ?? []
  return {
    chats: { findById: jest.fn().mockResolvedValue(opts.chat ?? null) },
    projects: { findById: jest.fn().mockResolvedValue(opts.project ?? null) },
    connections: {
      findById: jest.fn(async (id: string) => profiles.find((p) => p.id === id) ?? null),
      findDefault: jest.fn().mockResolvedValue(opts.defaultProfile ?? null),
    },
  } as any
}

describe('resolveInlineBrahmaConnectionProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getSettings.mockResolvedValue({ maxAgentTurns: 50, inlineConnectionProfileId: null })
  })

  it('uses the project override when it names an existing profile', async () => {
    getSettings.mockResolvedValue({ maxAgentTurns: 50, inlineConnectionProfileId: 'global-p' })
    const repos = makeRepos({
      chat: { projectId: PROJECT },
      project: { brahmaConnectionProfileId: 'project-p' },
      profiles: [profile('project-p'), profile('global-p')],
      defaultProfile: profile('default-p'),
    })

    const result = await resolveInlineBrahmaConnectionProfile(repos, USER, CHAT)

    expect(result?.id).toBe('project-p')
    expect(repos.projects.findById).toHaveBeenCalledWith(PROJECT)
    expect(repos.connections.findDefault).not.toHaveBeenCalled()
  })

  it('falls through a stale project id to the global setting', async () => {
    getSettings.mockResolvedValue({ maxAgentTurns: 50, inlineConnectionProfileId: 'global-p' })
    const repos = makeRepos({
      chat: { projectId: PROJECT },
      project: { brahmaConnectionProfileId: 'deleted-p' },
      profiles: [profile('global-p')],
      defaultProfile: profile('default-p'),
    })

    const result = await resolveInlineBrahmaConnectionProfile(repos, USER, CHAT)

    expect(result?.id).toBe('global-p')
  })

  it('uses the global setting for a chat outside any project', async () => {
    getSettings.mockResolvedValue({ maxAgentTurns: 50, inlineConnectionProfileId: 'global-p' })
    const repos = makeRepos({
      chat: { projectId: null },
      profiles: [profile('global-p')],
      defaultProfile: profile('default-p'),
    })

    const result = await resolveInlineBrahmaConnectionProfile(repos, USER, CHAT)

    expect(result?.id).toBe('global-p')
    expect(repos.projects.findById).not.toHaveBeenCalled()
  })

  it('uses the global setting when the project names no profile', async () => {
    getSettings.mockResolvedValue({ maxAgentTurns: 50, inlineConnectionProfileId: 'global-p' })
    const repos = makeRepos({
      chat: { projectId: PROJECT },
      project: { brahmaConnectionProfileId: null },
      profiles: [profile('global-p')],
      defaultProfile: profile('default-p'),
    })

    await expect(resolveInlineBrahmaConnectionProfile(repos, USER, CHAT)).resolves.toMatchObject({ id: 'global-p' })
  })

  it('falls through a stale global id to the default profile', async () => {
    getSettings.mockResolvedValue({ maxAgentTurns: 50, inlineConnectionProfileId: 'deleted-p' })
    const repos = makeRepos({
      chat: { projectId: null },
      profiles: [],
      defaultProfile: profile('default-p'),
    })

    const result = await resolveInlineBrahmaConnectionProfile(repos, USER, CHAT)

    expect(result?.id).toBe('default-p')
    expect(repos.connections.findDefault).toHaveBeenCalledWith(USER)
  })

  it('ignores a configured profile owned by another user', async () => {
    getSettings.mockResolvedValue({ maxAgentTurns: 50, inlineConnectionProfileId: 'foreign-p' })
    const repos = makeRepos({
      chat: { projectId: null },
      profiles: [profile('foreign-p', 'someone-else')],
      defaultProfile: profile('default-p'),
    })

    await expect(resolveInlineBrahmaConnectionProfile(repos, USER, CHAT)).resolves.toMatchObject({ id: 'default-p' })
  })

  it('uses the default profile when nothing is configured', async () => {
    const repos = makeRepos({
      chat: { projectId: null },
      defaultProfile: profile('default-p'),
    })

    await expect(resolveInlineBrahmaConnectionProfile(repos, USER, CHAT)).resolves.toMatchObject({ id: 'default-p' })
  })

  it('still reaches the default when the settings read throws', async () => {
    getSettings.mockRejectedValue(new Error('settings db unreadable'))
    const repos = makeRepos({
      chat: { projectId: null },
      defaultProfile: profile('default-p'),
    })

    await expect(resolveInlineBrahmaConnectionProfile(repos, USER, CHAT)).resolves.toMatchObject({ id: 'default-p' })
  })

  it('returns null when the user has no profiles at all', async () => {
    const repos = makeRepos({ chat: null, defaultProfile: null })

    await expect(resolveInlineBrahmaConnectionProfile(repos, USER, CHAT)).resolves.toBeNull()
  })
})
