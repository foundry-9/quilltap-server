/**
 * An in-memory stand-in for the repositories the scenario location reads:
 * document-store files by `(mountPointId, relativePath)`, plus the raw owner
 * rows (characters, projects, groups) that point at those mounts.
 *
 * The location's own logic — path validation, parsing, default resolution,
 * classification, the character tier's id derivation — runs for real on top;
 * only storage is faked. File writes (`writeDatabaseDocument` and friends) are
 * module-mocked by each suite and routed into `files` with `applyWrite`.
 */

import type { RepositoryContainer } from '@/lib/repositories/factory'

export interface FakeOwner {
  id: string
  name: string
  officialMountPointId?: string | null
}

export interface FakeCharacter {
  id: string
  name: string
  userId: string
  characterDocumentMountPointId: string | null
  archivedAt?: string | null
  defaultScenarioId?: string | null
}

export interface FakeScenarioStores {
  /** `mountPointId|relativePath` → content. */
  files: Map<string, string>
  characters: FakeCharacter[]
  projects: FakeOwner[]
  groups: FakeOwner[]
  repos: RepositoryContainer
  put(mountPointId: string, relativePath: string, content: string): void
  calls: {
    findManyByMountPointsInFolder: jest.Mock
    addScenario: jest.Mock
    updateScenario: jest.Mock
    removeScenario: jest.Mock
    characterUpdate: jest.Mock
  }
}

const STAMP = '2026-10-12T00:00:00.000Z'

function docFor(mountPointId: string, relativePath: string, content: string) {
  return {
    id: `doc:${mountPointId}:${relativePath}`,
    fileId: `file:${mountPointId}:${relativePath}`,
    content,
    contentSha256: '',
    plainTextLength: content.length,
    createdAt: STAMP,
    updatedAt: STAMP,
    linkId: `link:${mountPointId}:${relativePath}`,
    mountPointId,
    relativePath,
    fileName: relativePath.split('/').pop() ?? relativePath,
    folderId: null,
    lastModified: STAMP,
    linkGroupId: null,
    fileType: 'markdown' as const,
  }
}

export function makeScenarioStores(seed: {
  characters?: FakeCharacter[]
  projects?: FakeOwner[]
  groups?: FakeOwner[]
} = {}): FakeScenarioStores {
  const files = new Map<string, string>()
  const characters = seed.characters ?? []
  const projects = seed.projects ?? []
  const groups = seed.groups ?? []

  const findManyByMountPointsInFolder = jest.fn(async (mountPointIds: string[], folder: string) => {
    const prefix = `${folder}/`.toLowerCase()
    const docs = []
    for (const [key, content] of files) {
      const [mountPointId, relativePath] = key.split('|')
      if (!mountPointIds.includes(mountPointId)) continue
      if (!relativePath.toLowerCase().startsWith(prefix)) continue
      if (relativePath.slice(prefix.length).includes('/')) continue
      docs.push(docFor(mountPointId, relativePath, content))
    }
    return docs
  })

  const addScenario = jest.fn(async () => ({ id: 'transient' }))
  const updateScenario = jest.fn(async () => ({ id: 'updated' }))
  const removeScenario = jest.fn(async () => true)
  const characterUpdate = jest.fn(async () => ({}))

  const repos = {
    docMountDocuments: {
      findByMountPointAndPath: jest.fn(async (mountPointId: string, relativePath: string) => {
        const content = files.get(`${mountPointId}|${relativePath}`)
        return content === undefined ? null : docFor(mountPointId, relativePath, content)
      }),
      findManyByMountPointsInFolder,
    },
    characters: {
      findByIdRaw: jest.fn(async (id: string) => characters.find((c) => c.id === id) ?? null),
      findAllRaw: jest.fn(async () => characters),
      findByDocumentMountPointIdRaw: jest.fn(
        async (mountPointId: string) =>
          characters.find((c) => c.characterDocumentMountPointId === mountPointId) ?? null,
      ),
      addScenario,
      updateScenario,
      removeScenario,
      update: characterUpdate,
    },
    projects: {
      findByIdRaw: jest.fn(async (id: string) => projects.find((p) => p.id === id) ?? null),
      findAllRaw: jest.fn(async () => projects),
      findByOfficialMountPointIdRaw: jest.fn(
        async (mountPointId: string) => projects.find((p) => p.officialMountPointId === mountPointId) ?? null,
      ),
    },
    groups: {
      findByIdRaw: jest.fn(async (id: string) => groups.find((g) => g.id === id) ?? null),
      findAllRaw: jest.fn(async () => groups),
      findByOfficialMountPointIdRaw: jest.fn(
        async (mountPointId: string) => groups.find((g) => g.officialMountPointId === mountPointId) ?? null,
      ),
    },
  } as unknown as RepositoryContainer

  return {
    files,
    characters,
    projects,
    groups,
    repos,
    put(mountPointId, relativePath, content) {
      files.set(`${mountPointId}|${relativePath}`, content)
    },
    calls: { findManyByMountPointsInFolder, addScenario, updateScenario, removeScenario, characterUpdate },
  }
}
