/**
 * The instance-wide scenario catalogue behind the browser.
 *
 * What matters: one document query however many owners there are (bucketed by
 * mount afterwards), owners without a store skipped and never provisioned,
 * empty shelves still listed, the browser's order (General, projects,
 * groups, characters — each A–Z), archived characters left out, an excerpt in
 * place of the body, and a character row carrying the id `scenarioId` uses.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = jest.fn(() => logger)
  return { logger }
})

const mockGetGeneralMountPointId = jest.fn()
jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: () => mockGetGeneralMountPointId(),
}))
const mockEnsureOwnerOfficialStore = jest.fn()
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({
  ensureOwnerOfficialStore: (...args: unknown[]) => mockEnsureOwnerOfficialStore(...args),
}))
jest.mock('@/lib/mount-index/folder-paths', () => ({ ensureFolderPath: jest.fn() }))
jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(),
  deleteDatabaseDocument: jest.fn(),
  moveDatabaseDocument: jest.fn(),
  readDatabaseDocument: jest.fn(),
}))

import { listScenariosEverywhere, scenarioExcerpt, SCENARIO_EXCERPT_LENGTH } from '@/lib/scenarios/everywhere'
import { characterScenarioIdForPath } from '@/lib/scenarios/location'
import { makeScenarioStores } from '../../../__tests__/helpers/scenario-stores'

const USER = 'user-1'

beforeEach(() => {
  jest.clearAllMocks()
  mockGetGeneralMountPointId.mockResolvedValue('general-mount')
})

function seeded() {
  const stores = makeScenarioStores({
    characters: [
      { id: 'c-zed', name: 'Zed', userId: USER, characterDocumentMountPointId: 'vault-zed' },
      { id: 'c-ada', name: 'Ada', userId: USER, characterDocumentMountPointId: 'vault-ada' },
      { id: 'c-old', name: 'Old', userId: USER, characterDocumentMountPointId: 'vault-old', archivedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'c-none', name: 'Vaultless', userId: USER, characterDocumentMountPointId: null },
    ],
    projects: [
      { id: 'p-w', name: 'Wren', officialMountPointId: 'proj-wren' },
      { id: 'p-b', name: 'Blackwood', officialMountPointId: 'proj-blackwood' },
      { id: 'p-x', name: 'Storeless', officialMountPointId: null },
    ],
    groups: [{ id: 'g-1', name: 'The Club', officialMountPointId: 'group-club' }],
  })
  stores.put('general-mount', 'Scenarios/tea.md', 'Tea on the lawn.')
  stores.put('proj-blackwood', 'Scenarios/reading-room.md', '---\nname: The Reading Room\ndescription: Lamplit\n---\nDust\n\nand   lamplight.')
  stores.put('proj-blackwood', 'Scenarios/old.md', '---\narchived: true\n---\nOld.')
  stores.put('vault-ada', 'Scenarios/Tavern.md', '# Tavern\n\nA tavern at dusk.')
  stores.put('vault-old', 'Scenarios/Ghost.md', '# Ghost\n\nShould never show.')
  return stores
}

describe('listScenariosEverywhere', () => {
  it('reads every shelf in a single document query', async () => {
    const stores = seeded()
    await listScenariosEverywhere(stores.repos, USER)
    expect(stores.calls.findManyByMountPointsInFolder).toHaveBeenCalledTimes(1)
    expect(stores.calls.findManyByMountPointsInFolder.mock.calls[0][0].sort()).toEqual(
      ['general-mount', 'group-club', 'proj-blackwood', 'proj-wren', 'vault-ada', 'vault-zed'].sort(),
    )
  })

  it('orders owners General, projects, groups, characters — each A to Z — and skips the storeless', async () => {
    const stores = seeded()
    const sources = await listScenariosEverywhere(stores.repos, USER)
    expect(sources.map((s) => `${s.scope}:${s.name}`)).toEqual([
      'general:Quilltap General',
      'project:Blackwood',
      'project:Wren',
      'group:The Club',
      'character:Ada',
      'character:Zed',
    ])
    expect(mockEnsureOwnerOfficialStore).not.toHaveBeenCalled()
  })

  it('lists an empty shelf rather than hiding it', async () => {
    const stores = seeded()
    const sources = await listScenariosEverywhere(stores.repos, USER)
    expect(sources.find((s) => s.name === 'Wren')?.scenarios).toEqual([])
  })

  it('carries an excerpt, never the body, and hides archived scenarios unless asked', async () => {
    const stores = seeded()
    const blackwood = (await listScenariosEverywhere(stores.repos, USER)).find((s) => s.name === 'Blackwood')!
    expect(blackwood.scenarios).toHaveLength(1)
    expect(blackwood.scenarios[0]).toMatchObject({
      path: 'Scenarios/reading-room.md',
      name: 'The Reading Room',
      description: 'Lamplit',
      excerpt: 'Dust and lamplight.',
    })
    expect(blackwood.scenarios[0]).not.toHaveProperty('body')

    const withArchived = (await listScenariosEverywhere(stores.repos, USER, { includeArchived: true })).find(
      (s) => s.name === 'Blackwood',
    )!
    expect(withArchived.scenarios).toHaveLength(2)
  })

  it('gives a character row the id a scenarioId pick carries', async () => {
    const stores = seeded()
    const ada = (await listScenariosEverywhere(stores.repos, USER)).find((s) => s.name === 'Ada')!
    expect(ada.scenarios[0]).toMatchObject({
      name: 'Tavern',
      scenarioId: characterScenarioIdForPath('vault-ada', 'Scenarios/Tavern.md'),
    })
  })
})

describe('scenarioExcerpt', () => {
  it('collapses whitespace and cuts long bodies', () => {
    const long = 'word '.repeat(200)
    const excerpt = scenarioExcerpt(long)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(SCENARIO_EXCERPT_LENGTH + 1)
  })
})
