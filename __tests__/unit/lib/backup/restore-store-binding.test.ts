/**
 * Bug 185 — a restore must bind each character, project and group to the store
 * the archive carries for it, not mint a fresh one beside it.
 *
 * The archive carries every vault and official store (22a–22f). Before the fix
 * the restore went through the entities' create paths, which drop the archived
 * pointer and provision a fresh store, so every restored entity pointed at an
 * empty store and the archive's own sat beside it, unreferenced — in both
 * modes. These tests drive `restore()` over mocked repositories and assert the
 * contract the bug calls for: each restored entity points at the store the
 * archive gave it, nothing is minted for it, a damaged archive cannot
 * cross-link two entities, and in `new-account` mode the pointer follows the
 * store through the UUID remap.
 */

import { restore } from '@/lib/backup/restore/restore';
import { parseBackupZip } from '@/lib/backup/restore/archive';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { writeLibraryFileBytes } from '@/lib/file-storage/library-file-writer';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';

jest.mock('@/lib/backup/restore/archive', () => ({
  parseBackupZip: jest.fn(),
  getFileFromExtractedBackup: jest.fn(),
  cleanupDir: jest.fn(),
}))

jest.mock('@/lib/backup/restore/delete-service', () => ({
  deleteUserData: jest.fn(),
}))

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: jest.fn(),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/file-storage/library-file-writer', () => ({
  writeLibraryFileBytes: jest.fn(),
}))

jest.mock('@/lib/mount-index/character-vault', () => ({
  ensureCharacterVault: jest.fn(),
}))

jest.mock('@/lib/paths', () => ({
  getNpmPluginsDir: jest.fn(() => '/tmp/qt-test-plugins'),
  getThemesDir: jest.fn(() => '/tmp/qt-test-themes'),
}))

jest.mock('@/lib/database/backends/sqlite/llm-logs-client', () => ({
  isLLMLogsDegraded: jest.fn(() => true),
}))

jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  isMountIndexDegraded: jest.fn(() => true),
  getRawMountIndexDatabase: jest.fn(() => null),
}))

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
}))

jest.mock('@/lib/llm/connection-profile-names', () => ({
  normalizeProfileName: jest.fn((n: string) => n),
  makeUniqueProfileName: jest.fn((n: string) => n),
}))

const { getFileFromExtractedBackup } = jest.requireMock('@/lib/backup/restore/archive')
const mockedParseBackupZip = parseBackupZip as jest.MockedFunction<typeof parseBackupZip>
const mockedGetUserRepositories = getUserRepositories as jest.MockedFunction<typeof getUserRepositories>
const mockedGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockedWriteLibraryFileBytes = writeLibraryFileBytes as jest.MockedFunction<typeof writeLibraryFileBytes>
const mockedEnsureCharacterVault = ensureCharacterVault as jest.MockedFunction<typeof ensureCharacterVault>

const EMPTY_COLLECTIONS = [
  'characters', 'tags', 'connectionProfiles', 'imageProfiles', 'embeddingProfiles',
  'files', 'promptTemplates', 'roleplayTemplates', 'providerModels', 'projects',
  'groups', 'llmLogs', 'pluginConfigs', 'folders', 'wardrobeItems',
  'characterPluginData', 'conversationAnnotations', 'chatDocuments',
  'instanceSettings', 'embeddingStatus', 'conversationChunks', 'tfidfVocabularies',
  'vectorIndexMetas', 'textReplacementRules', 'docMountPoints', 'docMountFiles',
  'docMountDocuments', 'docMountChunks', 'docMountFileLinks', 'docMountFolders',
  'docMountBlobs', 'projectDocMountLinks', 'groupDocMountLinks',
  'groupCharacterMembers', 'vectorEntries', 'chats', 'memories', 'chatSettings',
] as const

const VAULT = '11111111-1111-4111-8111-111111111111'
const PROJECT_STORE = '22222222-2222-4222-8222-222222222222'
const GROUP_STORE = '33333333-3333-4333-8333-333333333333'
const MISSING_STORE = '44444444-4444-4444-8444-444444444444'
const CHAR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CHAR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const GROUP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function makeBackupData(overrides: Record<string, unknown>) {
  const base: Record<string, unknown> = { manifest: { backupFormat: 3 } }
  for (const key of EMPTY_COLLECTIONS) base[key] = []
  return { ...base, ...overrides }
}

function mountPoint(id: string, storeType: string, name = `store ${id.slice(0, 4)}`) {
  return {
    id,
    name,
    basePath: '',
    mountType: 'database',
    storeType,
    includePatterns: '[]',
    excludePatterns: '[]',
    enabled: 1,
    lastScannedAt: null,
    scanStatus: 'idle',
    lastScanError: null,
    conversionStatus: 'idle',
    conversionError: null,
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function character(id: string, name: string, vault: string | null) {
  return {
    id,
    userId: 'source-user',
    name,
    characterDocumentMountPointId: vault,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function primeArchive(data: Record<string, unknown>) {
  mockedParseBackupZip.mockResolvedValue({
    data: data as never,
    extractDir: '/tmp/qt-test-extract',
    rootFolder: '',
  })
}

/** A repo stand-in whose unlisted methods are auto-created jest.fns. */
function repoStub(overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>()
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      if (!cache.has(prop)) cache.set(prop, jest.fn().mockResolvedValue([]))
      return cache.get(prop)
    },
  })
}

const echo = () =>
  jest.fn().mockImplementation((data: Record<string, unknown>, ...rest: unknown[]) => {
    const opts = rest[rest.length - 1] as { id?: string } | undefined
    return Promise.resolve({ ...data, id: opts?.id ?? 'generated' })
  })

function buildRepoMocks() {
  const order: string[] = []
  const track = <T extends jest.Mock>(label: string, fn: T): T => {
    const wrapped = jest.fn((...args: unknown[]) => {
      order.push(label)
      return fn(...args)
    })
    return wrapped as unknown as T
  }

  const characterCreate = echo()
  const characterCreateBound = echo()
  const projectCreate = echo()
  const projectCreateBound = echo()
  const projectProvision = jest.fn().mockResolvedValue('fresh-project-store')
  const groupCreate = echo()
  const groupCreateBound = echo()
  const groupProvision = jest.fn().mockResolvedValue('fresh-group-store')
  const memoriesCreate = echo()
  const filesCreate = echo()
  const docMountPointsCreate = echo()
  const docMountPointsFindAll = jest.fn().mockResolvedValue([])
  const projectDocMountLinksCreate = track('projectDocMountLinks.create', echo())

  const userRepos = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'characters') return repoStub({ create: characterCreate })
      if (prop === 'projects') return repoStub({ create: projectCreate })
      if (prop === 'groups') return repoStub({ create: groupCreate })
      if (prop === 'files') return repoStub({ create: filesCreate })
      if (prop === 'connections') return repoStub({ findAll: jest.fn().mockResolvedValue([]) })
      return repoStub()
    },
  })

  const globalRepos = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'characters')
        return repoStub({ createBoundToVault: characterCreateBound, findByIdRaw: jest.fn().mockResolvedValue(null) })
      if (prop === 'projects') return repoStub({ createBoundToStore: projectCreateBound, provisionOfficialStore: projectProvision })
      if (prop === 'groups') return repoStub({ createBoundToStore: groupCreateBound, provisionOfficialStore: groupProvision })
      if (prop === 'memories') return repoStub({ create: memoriesCreate })
      if (prop === 'docMountPoints') return repoStub({ create: docMountPointsCreate, findAll: docMountPointsFindAll })
      if (prop === 'projectDocMountLinks') return repoStub({ create: projectDocMountLinksCreate })
      return repoStub()
    },
  })

  mockedGetUserRepositories.mockReturnValue(userRepos as never)
  mockedGetRepositories.mockReturnValue(globalRepos as never)

  mockedWriteLibraryFileBytes.mockImplementation(async () => {
    order.push('writeLibraryFileBytes')
    return { storageKey: 'mount-blob:fresh:blob', storedMimeType: 'image/webp', sizeBytes: 3, sha256: 'abc' }
  })
  getFileFromExtractedBackup.mockResolvedValue(Buffer.from('abc'))

  return {
    order,
    characterCreate,
    characterCreateBound,
    projectCreate,
    projectCreateBound,
    projectProvision,
    groupCreate,
    groupCreateBound,
    groupProvision,
    memoriesCreate,
    filesCreate,
    docMountPointsCreate,
    docMountPointsFindAll,
  }
}

describe('restore binds entities to their archived stores (bug 185)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('replace mode: a character, project and group keep their archived stores and nothing is minted', async () => {
    const mocks = buildRepoMocks()
    primeArchive(
      makeBackupData({
        docMountPoints: [
          mountPoint(VAULT, 'character'),
          mountPoint(PROJECT_STORE, 'documents'),
          mountPoint(GROUP_STORE, 'documents'),
        ],
        characters: [character(CHAR_A, 'Friday', VAULT)],
        projects: [{ id: PROJECT, name: 'Severed', officialMountPointId: PROJECT_STORE }],
        groups: [{ id: GROUP, name: 'The Household', officialMountPointId: GROUP_STORE }],
      })
    )

    const summary = await restore('/tmp/backup.zip', { mode: 'replace', targetUserId: 'user-1' })

    expect(mocks.characterCreate).not.toHaveBeenCalled()
    expect(mocks.projectCreate).not.toHaveBeenCalled()
    expect(mocks.groupCreate).not.toHaveBeenCalled()

    expect(mocks.characterCreateBound).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Friday', userId: 'user-1' }),
      VAULT,
      { id: CHAR_A }
    )
    expect(mocks.projectCreateBound).toHaveBeenCalledWith(expect.objectContaining({ name: 'Severed' }), PROJECT_STORE, { id: PROJECT })
    expect(mocks.groupCreateBound).toHaveBeenCalledWith(expect.objectContaining({ name: 'The Household' }), GROUP_STORE, { id: GROUP })

    // The stores arrived, so none was re-provisioned.
    expect(mockedEnsureCharacterVault).not.toHaveBeenCalled()
    expect(mocks.projectProvision).not.toHaveBeenCalled()
    expect(mocks.groupProvision).not.toHaveBeenCalled()
    expect(summary.warnings.filter((w) => /fresh/.test(w))).toEqual([])
  })

  it('new-account mode: the pointer follows its store through the UUID remap', async () => {
    const mocks = buildRepoMocks()
    primeArchive(
      makeBackupData({
        docMountPoints: [mountPoint(VAULT, 'character'), mountPoint(PROJECT_STORE, 'documents'), mountPoint(GROUP_STORE, 'documents')],
        characters: [character(CHAR_A, 'Friday', VAULT)],
        projects: [{ id: PROJECT, name: 'Severed', officialMountPointId: PROJECT_STORE }],
        groups: [{ id: GROUP, name: 'The Household', officialMountPointId: GROUP_STORE }],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'new-account', targetUserId: 'user-2' })

    // Each store's row is restored under a new id …
    const restoredStoreIds = mocks.docMountPointsCreate.mock.calls.map((call) => (call[1] as { id: string }).id)
    expect(restoredStoreIds).toHaveLength(3)
    expect(restoredStoreIds).not.toContain(VAULT)
    const [newVault, newProjectStore, newGroupStore] = restoredStoreIds

    // … and each entity is bound to exactly that id, not the stale original.
    expect(mocks.characterCreate).not.toHaveBeenCalled()
    expect(mocks.characterCreateBound.mock.calls[0][1]).toBe(newVault)
    expect(mocks.projectCreateBound.mock.calls[0][1]).toBe(newProjectStore)
    expect(mocks.groupCreateBound.mock.calls[0][1]).toBe(newGroupStore)
    expect(mocks.characterCreateBound.mock.calls[0][0]).toMatchObject({ characterDocumentMountPointId: newVault, userId: 'user-2' })
  })

  it('new-account mode: a store whose name the instance already uses arrives under a free name (bug 186)', async () => {
    const mocks = buildRepoMocks()
    mocks.docMountPointsFindAll.mockResolvedValue([{ id: 'existing', name: 'Friday Character Vault' }])
    primeArchive(
      makeBackupData({
        docMountPoints: [mountPoint(VAULT, 'character', 'friday character vault'), mountPoint(PROJECT_STORE, 'documents', 'Severed Papers')],
        characters: [character(CHAR_A, 'Friday', VAULT)],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'new-account', targetUserId: 'user-2' })

    expect(mocks.docMountPointsCreate.mock.calls.map((call) => (call[0] as { name: string }).name)).toEqual([
      'friday character vault (2)',
      'Severed Papers',
    ])
    // The archive's createdAt rides along: a retired vault is stamped with it.
    expect(mocks.docMountPointsCreate.mock.calls[0][1]).toMatchObject({ createdAt: '2026-01-01T00:00:00.000Z' })
  })

  it('first claim wins: a second entity naming the same store falls back to a fresh one with a warning', async () => {
    const mocks = buildRepoMocks()
    primeArchive(
      makeBackupData({
        docMountPoints: [mountPoint(VAULT, 'character')],
        characters: [character(CHAR_A, 'Friday', VAULT), character(CHAR_B, 'Laura', VAULT)],
      })
    )

    const summary = await restore('/tmp/backup.zip', { mode: 'replace', targetUserId: 'user-1' })

    expect(mocks.characterCreateBound).toHaveBeenCalledTimes(1)
    expect(mocks.characterCreateBound.mock.calls[0][2]).toEqual({ id: CHAR_A })
    expect(mocks.characterCreate).toHaveBeenCalledTimes(1)
    expect(mocks.characterCreate.mock.calls[0][1]).toEqual({ id: CHAR_B })
    expect(summary.warnings.some((w) => w.includes('"Laura"') && w.includes('already claimed'))).toBe(true)
  })

  it('falls back to a fresh store when the archive does not carry the one pointed at, or it is the wrong kind', async () => {
    const mocks = buildRepoMocks()
    primeArchive(
      makeBackupData({
        docMountPoints: [mountPoint(PROJECT_STORE, 'documents')],
        characters: [character(CHAR_A, 'Friday', MISSING_STORE), character(CHAR_B, 'Laura', PROJECT_STORE)],
        projects: [{ id: PROJECT, name: 'Severed', officialMountPointId: null }],
      })
    )

    const summary = await restore('/tmp/backup.zip', { mode: 'replace', targetUserId: 'user-1' })

    expect(mocks.characterCreateBound).not.toHaveBeenCalled()
    expect(mocks.characterCreate).toHaveBeenCalledTimes(2)
    // A project with no pointer at all is an ordinary create, and no warning.
    expect(mocks.projectCreate).toHaveBeenCalledTimes(1)
    expect(summary.warnings.filter((w) => /fresh, empty store/.test(w))).toEqual([
      'The character "Friday" was given a fresh, empty store because the backup does not carry the store it pointed at',
      'The character "Laura" was given a fresh, empty store because the store it pointed at is the wrong kind',
    ])
  })

  it('re-provisions a bound entity whose archived store row failed to restore', async () => {
    const mocks = buildRepoMocks()
    mocks.docMountPointsCreate.mockRejectedValue(new Error('schema says no'))
    primeArchive(
      makeBackupData({
        docMountPoints: [mountPoint(VAULT, 'character'), mountPoint(PROJECT_STORE, 'documents'), mountPoint(GROUP_STORE, 'documents')],
        characters: [character(CHAR_A, 'Friday', VAULT)],
        projects: [{ id: PROJECT, name: 'Severed', officialMountPointId: PROJECT_STORE }],
        groups: [{ id: GROUP, name: 'The Household', officialMountPointId: GROUP_STORE }],
      })
    )

    const summary = await restore('/tmp/backup.zip', { mode: 'replace', targetUserId: 'user-1' })

    expect(mockedEnsureCharacterVault).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAR_A, characterDocumentMountPointId: null })
    )
    expect(mocks.projectProvision).toHaveBeenCalledWith(expect.objectContaining({ id: PROJECT }))
    expect(mocks.groupProvision).toHaveBeenCalledWith(expect.objectContaining({ id: GROUP }))
    expect(summary.warnings).toEqual(
      expect.arrayContaining([
        'The character "Friday" was given a fresh vault because its own could not be restored',
        'The project "Severed" was given a fresh store because its own could not be restored',
        'The group "The Household" was given a fresh store because its own could not be restored',
      ])
    )
  })

  it('never provisions a vault for an archived character whose vault failed to restore', async () => {
    const mocks = buildRepoMocks()
    mocks.docMountPointsCreate.mockRejectedValue(new Error('schema says no'))
    primeArchive(
      makeBackupData({
        docMountPoints: [mountPoint(VAULT, 'character')],
        characters: [{ ...character(CHAR_A, 'Friday', VAULT), archivedAt: '2026-08-10T00:00:00.000Z' }],
      })
    )

    const summary = await restore('/tmp/backup.zip', { mode: 'replace', targetUserId: 'user-1' })

    expect(mocks.characterCreateBound).toHaveBeenCalledTimes(1)
    expect(mockedEnsureCharacterVault).not.toHaveBeenCalled()
    expect(summary.warnings.some((w) => w.includes('archived character "Friday"'))).toBe(true)
  })

  it('restores memories of a bound character without reading it through the vault overlay', async () => {
    const mocks = buildRepoMocks()
    primeArchive(
      makeBackupData({
        docMountPoints: [mountPoint(VAULT, 'character')],
        characters: [character(CHAR_A, 'Friday', VAULT)],
        memories: [
          { id: 'mem-1', characterId: CHAR_A, content: 'Tea at four.', tags: [], keywords: [], relatedMemoryIds: [] },
          { id: 'mem-2', characterId: CHAR_B, content: 'A stranger.', tags: [], keywords: [], relatedMemoryIds: [] },
        ],
      })
    )

    const summary = await restore('/tmp/backup.zip', { mode: 'replace', targetUserId: 'user-1' })

    expect(mocks.memoriesCreate).toHaveBeenCalledTimes(1)
    expect(mocks.memoriesCreate.mock.calls[0][1]).toEqual({ id: 'mem-1' })
    expect(summary.memories).toBe(1)
    expect(summary.warnings.some((w) => w.includes('Character not found or access denied'))).toBe(true)
  })

  it('keeps a bound project\'s carried file rows, and replays the rest only after its links are restored', async () => {
    const mocks = buildRepoMocks()
    const blobId = '55555555-5555-4555-8555-555555555555'
    const carriedKey = `mount-blob:${PROJECT_STORE}:${blobId}`
    primeArchive(
      makeBackupData({
        docMountPoints: [mountPoint(PROJECT_STORE, 'documents')],
        docMountBlobs: [{ id: blobId, fileId: 'df-1', sha256: 'carried-sha', sizeBytes: 3, storedMimeType: 'image/webp' }],
        projects: [{ id: PROJECT, name: 'Severed', officialMountPointId: PROJECT_STORE }],
        projectDocMountLinks: [{ id: 'pl-1', projectId: PROJECT, mountPointId: PROJECT_STORE }],
        files: [
          { id: 'file-carried', projectId: PROJECT, originalFilename: 'map.webp', mimeType: 'image/webp', storageKey: carriedKey },
          { id: 'file-loose', projectId: PROJECT, originalFilename: 'notes.txt', mimeType: 'text/plain', storageKey: 'legacy/notes.txt' },
        ],
      })
    )

    const summary = await restore('/tmp/backup.zip', { mode: 'replace', targetUserId: 'user-1' })

    // The carried file is recorded against the archived blob, never re-ingested.
    const carriedRow = mocks.filesCreate.mock.calls.find((call) => (call[1] as { id: string }).id === 'file-carried')
    expect(carriedRow?.[0]).toMatchObject({ storageKey: carriedKey, sha256: 'carried-sha' })

    // The other is replayed once, after the project's link exists.
    expect(mockedWriteLibraryFileBytes).toHaveBeenCalledTimes(1)
    expect(mockedWriteLibraryFileBytes).toHaveBeenCalledWith(expect.objectContaining({ filename: 'notes.txt', projectId: PROJECT }))
    expect(mocks.order).toEqual(['projectDocMountLinks.create', 'writeLibraryFileBytes'])
    expect(summary.files).toBe(2)
  })
})
