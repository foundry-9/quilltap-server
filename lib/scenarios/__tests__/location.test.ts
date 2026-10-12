/**
 * The scenario location — the one address for "a scenario somewhere".
 *
 * Pinned here: every scope resolves to its mount; `ensure` provisions a store
 * only for a writer (a read probe never does); the archived-character
 * tombstone holds for both resolution and classification; a mount that is not
 * one of the four kinds of owner is refused, as is a path outside
 * `Scenarios/` (before any store is read); and the character tier's path →
 * id derivation agrees with the vault overlay's own file naming, which is
 * what lets a `{ mountPointId, path }` ref name a character scenario at all.
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

const mockEnsureFolderPath = jest.fn()
jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: (...args: unknown[]) => mockEnsureFolderPath(...args),
}))

const mockEnsureOwnerOfficialStore = jest.fn()
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({
  ensureOwnerOfficialStore: (...args: unknown[]) => mockEnsureOwnerOfficialStore(...args),
}))

const mockWrite = jest.fn()
jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: (...args: unknown[]) => mockWrite(...args),
  deleteDatabaseDocument: jest.fn(async () => true),
  moveDatabaseDocument: jest.fn(),
  readDatabaseDocument: jest.fn(),
}))

let mockRepos: unknown
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => mockRepos,
}))

import {
  characterScenarioIdForPath,
  characterScenarioPathForTitle,
  classifyScenarioMount,
  lookupScenarioRef,
  resolveScenarioLocation,
  ScenarioConflictError,
} from '@/lib/scenarios/location'
import { parseScenarioFile } from '@/lib/database/repositories/vault-overlay/parsers'
import { isScenarioContentArchived } from '@/lib/mount-index/scenarios-common'
import { makeScenarioStores, type FakeScenarioStores } from '../../../__tests__/helpers/scenario-stores'

const USER = 'user-1'
const GENERAL_MOUNT = '00000000-0000-4000-8000-000000000001'
const PROJECT_MOUNT = '00000000-0000-4000-8000-000000000002'
const GROUP_MOUNT = '00000000-0000-4000-8000-000000000003'
const VAULT = '00000000-0000-4000-8000-000000000004'
const ARCHIVED_VAULT = '00000000-0000-4000-8000-000000000005'
const LINKED_STORE = '00000000-0000-4000-8000-000000000006'

let stores: FakeScenarioStores

beforeEach(() => {
  jest.clearAllMocks()
  mockGetGeneralMountPointId.mockResolvedValue(GENERAL_MOUNT)
  mockEnsureFolderPath.mockResolvedValue('folder-1')
  mockEnsureOwnerOfficialStore.mockImplementation(async () => ({ mountPointId: 'fresh-mount', created: true }))
  mockWrite.mockImplementation(async (mountPointId: string, path: string, content: string) => {
    stores.put(mountPointId, path, content)
  })
  stores = makeScenarioStores({
    characters: [
      { id: 'char-1', name: 'Ada', userId: USER, characterDocumentMountPointId: VAULT },
      { id: 'char-old', name: 'Retired', userId: USER, characterDocumentMountPointId: ARCHIVED_VAULT, archivedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'char-theirs', name: 'Stranger', userId: 'someone-else', characterDocumentMountPointId: 'their-vault' },
    ],
    projects: [
      { id: 'proj-1', name: 'Blackwood', officialMountPointId: PROJECT_MOUNT },
      { id: 'proj-bare', name: 'Storeless', officialMountPointId: null },
    ],
    groups: [{ id: 'group-1', name: 'The Club', officialMountPointId: GROUP_MOUNT }],
  })
  mockRepos = stores.repos
})

describe('resolveScenarioLocation', () => {
  it.each([
    ['general', null, GENERAL_MOUNT, 'Quilltap General'],
    ['project', 'proj-1', PROJECT_MOUNT, 'Blackwood'],
    ['group', 'group-1', GROUP_MOUNT, 'The Club'],
    ['character', 'char-1', VAULT, 'Ada'],
  ] as const)('resolves the %s scope to its mount', async (scope, id, mountPointId, ownerName) => {
    const location = await resolveScenarioLocation(scope, id, stores.repos, USER)
    expect(location).toMatchObject({ scope, id, mountPointId, ownerName })
  })

  it('answers null for a non-General scope without an id', async () => {
    await expect(resolveScenarioLocation('project', null, stores.repos, USER)).resolves.toBeNull()
  })

  it('never provisions on a read probe', async () => {
    const location = await resolveScenarioLocation('project', 'proj-bare', stores.repos, USER)
    expect(location).toBeNull()
    expect(mockEnsureOwnerOfficialStore).not.toHaveBeenCalled()
    expect(mockEnsureFolderPath).not.toHaveBeenCalled()
  })

  it('provisions the store and heals the folder when a writer asks', async () => {
    const location = await resolveScenarioLocation('project', 'proj-bare', stores.repos, USER, { ensure: true })
    expect(mockEnsureOwnerOfficialStore).toHaveBeenCalledWith('project', 'proj-bare', 'Storeless')
    expect(mockEnsureFolderPath).toHaveBeenCalledWith('fresh-mount', 'Scenarios')
    expect(location?.mountPointId).toBe('fresh-mount')
  })

  it('treats an archived character as a tombstone', async () => {
    await expect(resolveScenarioLocation('character', 'char-old', stores.repos, USER)).resolves.toBeNull()
  })

  it("refuses another user's character", async () => {
    await expect(resolveScenarioLocation('character', 'char-theirs', stores.repos, USER)).resolves.toBeNull()
  })
})

describe('classifyScenarioMount', () => {
  it.each([
    [GENERAL_MOUNT, { scope: 'general', id: null }],
    [PROJECT_MOUNT, { scope: 'project', id: 'proj-1' }],
    [GROUP_MOUNT, { scope: 'group', id: 'group-1' }],
    [VAULT, { scope: 'character', id: 'char-1' }],
  ])('classifies %s', async (mountPointId, expected) => {
    await expect(classifyScenarioMount(mountPointId, stores.repos, USER)).resolves.toEqual(expected)
  })

  it('classifies an archived character’s vault as nothing', async () => {
    await expect(classifyScenarioMount(ARCHIVED_VAULT, stores.repos, USER)).resolves.toBeNull()
  })

  it('classifies a linked (non-official) store as nothing', async () => {
    await expect(classifyScenarioMount(LINKED_STORE, stores.repos, USER)).resolves.toBeNull()
  })
})

describe('lookupScenarioRef', () => {
  it('refuses a path outside Scenarios/ before reading any store', async () => {
    const lookup = await lookupScenarioRef({ mountPointId: PROJECT_MOUNT, path: 'Scenarios/../secrets.md' }, stores.repos, USER)
    expect(lookup.status).toBe('refused')
    expect(stores.repos.docMountDocuments.findByMountPointAndPath).not.toHaveBeenCalled()
    expect(stores.repos.projects.findByOfficialMountPointIdRaw).not.toHaveBeenCalled()
  })

  it('refuses a nested path', async () => {
    const lookup = await lookupScenarioRef({ mountPointId: PROJECT_MOUNT, path: 'Scenarios/deep/x.md' }, stores.repos, USER)
    expect(lookup.status).toBe('refused')
  })

  it('refuses a mount that holds no scenarios', async () => {
    const lookup = await lookupScenarioRef({ mountPointId: LINKED_STORE, path: 'Scenarios/x.md' }, stores.repos, USER)
    expect(lookup.status).toBe('refused')
  })

  it('reports a missing file as missing, not refused', async () => {
    const lookup = await lookupScenarioRef({ mountPointId: PROJECT_MOUNT, path: 'Scenarios/gone.md' }, stores.repos, USER)
    expect(lookup.status).toBe('missing')
  })

  it('resolves a project scenario by ref', async () => {
    stores.put(PROJECT_MOUNT, 'Scenarios/reading-room.md', '---\nname: The Reading Room\n---\nDust and lamplight.')
    const lookup = await lookupScenarioRef({ mountPointId: PROJECT_MOUNT, path: 'Scenarios/reading-room.md' }, stores.repos, USER)
    expect(lookup).toMatchObject({
      status: 'ok',
      location: { scope: 'project', id: 'proj-1' },
      scenario: { name: 'The Reading Room', body: 'Dust and lamplight.' },
    })
  })
})

describe('the character tier', () => {
  it("derives a scenario's id from its path the way the vault overlay does", async () => {
    const path = characterScenarioPathForTitle('A Tavern: at Dusk')
    expect(path).toBe('Scenarios/A Tavern_ at Dusk.md')
    stores.put(VAULT, path, '# A Tavern: at Dusk\n\nSmoke and fiddles.')

    const location = await resolveScenarioLocation('character', 'char-1', stores.repos, USER)
    const { scenarios } = await location!.list()
    expect(scenarios).toHaveLength(1)
    expect(scenarios[0]).toMatchObject({ path, name: 'A Tavern: at Dusk', body: 'Smoke and fiddles.' })

    const overlayDoc = { content: stores.files.get(`${VAULT}|${path}`)!, mountPointId: VAULT, relativePath: path, fileName: 'A Tavern_ at Dusk.md', createdAt: '', updatedAt: '' }
    const overlayId = parseScenarioFile(overlayDoc as never, 'char-1')!.id
    expect(location!.idForPath(path)).toBe(overlayId)
    expect(characterScenarioIdForPath(VAULT, path)).toBe(overlayId)
  })

  it("reads the character's default from the column", async () => {
    const path = 'Scenarios/Rooftop.md'
    stores.put(VAULT, path, '# Rooftop\n\nRain.')
    stores.characters[0].defaultScenarioId = characterScenarioIdForPath(VAULT, path)
    const location = await resolveScenarioLocation('character', 'char-1', stores.repos, USER)
    const { scenarios } = await location!.list()
    expect(scenarios[0].isDefault).toBe(true)
  })

  it('writes through the characters repository, never the files', async () => {
    const location = await resolveScenarioLocation('character', 'char-1', stores.repos, USER)
    // The repository's projection would write the file; emulate it.
    stores.calls.addScenario.mockImplementation(async (_id: string, data: { title: string; content: string }) => {
      stores.put(VAULT, characterScenarioPathForTitle(data.title), `# ${data.title}\n\n${data.content}`)
      return { id: 'x' }
    })
    const created = await location!.create({ filename: 'ignored', name: 'Harbour', body: 'Gulls.' })
    expect(stores.calls.addScenario).toHaveBeenCalledWith('char-1', { title: 'Harbour', content: 'Gulls.' })
    expect(mockWrite).not.toHaveBeenCalled()
    expect(created.path).toBe('Scenarios/Harbour.md')
  })
})

describe('the store tiers', () => {
  it('refuses to create over an existing file', async () => {
    stores.put(GROUP_MOUNT, 'Scenarios/tea.md', 'Tea.')
    const location = await resolveScenarioLocation('group', 'group-1', stores.repos, USER)
    await expect(location!.create({ filename: 'tea', body: 'More tea.' })).rejects.toBeInstanceOf(ScenarioConflictError)
  })

  it('keeps an archived flag an update never mentions', async () => {
    stores.put(GENERAL_MOUNT, 'Scenarios/tea.md', '---\narchived: true\n---\nTea.')
    const location = await resolveScenarioLocation('general', null, stores.repos, USER)
    await location!.update('Scenarios/tea.md', { body: 'Stronger tea.' })
    expect(isScenarioContentArchived(stores.files.get(`${GENERAL_MOUNT}|Scenarios/tea.md`)!)).toBe(true)
  })

  it('clears the default when asked for none', async () => {
    stores.put(GENERAL_MOUNT, 'Scenarios/a.md', '---\nisDefault: true\n---\nA.')
    const location = await resolveScenarioLocation('general', null, stores.repos, USER)
    await location!.setDefault(null)
    const { scenarios } = await location!.list()
    expect(scenarios[0].isDefault).toBe(false)
  })
})
