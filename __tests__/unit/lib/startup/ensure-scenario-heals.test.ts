/**
 * The boot-time scenario heals count honestly: a store assigned where none
 * was recorded is "provisioned", a stale pointer replaced is "healed", and a
 * store or folder that could not be ensured is "failed" — never reported as
 * healthy.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = jest.fn(() => logger)
  return { logger }
})

const mockResolveScenarioLocation = jest.fn()
jest.mock('@/lib/scenarios/location', () => ({
  resolveScenarioLocation: (...args: unknown[]) => mockResolveScenarioLocation(...args),
}))
const mockEnsureKnowledge = jest.fn()
jest.mock('@/lib/mount-index/group-knowledge', () => ({
  ensureGroupKnowledgeFolder: (...args: unknown[]) => mockEnsureKnowledge(...args),
}))
const mockFindAllRaw = jest.fn()
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({ projects: { findAllRaw: mockFindAllRaw }, groups: { findAllRaw: mockFindAllRaw } }),
}))

import { ensureProjectScenariosForAllProjects } from '@/lib/startup/ensure-project-scenarios'
import { ensureGroupScenariosForAllGroups } from '@/lib/startup/ensure-group-scenarios'

beforeEach(() => {
  jest.clearAllMocks()
  mockFindAllRaw.mockResolvedValue([
    { id: 'a', name: 'Fresh', officialMountPointId: null },
    { id: 'b', name: 'Stale', officialMountPointId: 'gone' },
    { id: 'c', name: 'Fine', officialMountPointId: 'mount-c' },
    { id: 'd', name: 'Broken', officialMountPointId: 'mount-d' },
  ])
  mockResolveScenarioLocation.mockImplementation(async (_scope: string, id: string) => {
    if (id === 'd') throw new Error('folder create failed')
    return { mountPointId: id === 'a' ? 'mount-a' : id === 'b' ? 'mount-b' : 'mount-c' }
  })
})

it.each([
  ['projects', ensureProjectScenariosForAllProjects],
  ['groups', ensureGroupScenariosForAllGroups],
])('counts provisioned, healed and failed %s separately', async (_label, heal) => {
  await expect(heal()).resolves.toEqual({ total: 4, provisioned: 1, healed: 1, failed: 1 })
  expect(mockResolveScenarioLocation).toHaveBeenCalledWith(expect.any(String), 'a', expect.anything(), expect.any(String), { ensure: true })
})
