/**
 * @jest-environment node
 *
 * Bug 256 — an address must not depend on who is reading it.
 *
 * `qtap://self/…` means the vault of whoever follows it. The URI producers
 * used to hand one character's own-vault documents out as `qtap://self/…` in
 * tool results and Librarian announcements the whole chat reads, so a second
 * character following one opened their OWN file of the same name — a complete,
 * plausible `metadata.json` belonging to the wrong person, with no error.
 *
 * Pinned here: producers name the vault; an address one character produces
 * resolves to the same vault for any other reader; five vaults with one
 * `metadata.json` each never answer for each other; an unknown store and a
 * bare filename are errors that say so; and `self` typed by a character for
 * its own vault still works.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))
jest.mock('@/lib/paths', () => ({ getFilesDir: () => '/nonexistent' }))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn(),
  writeDatabaseDocument: jest.fn(),
  DatabaseStoreError: class extends Error {
    constructor(message: string, public code: string) {
      super(message)
    }
  },
}))

import { getRepositories } from '@/lib/repositories/factory'
import { resolveDocEditPath, PathResolutionError } from '@/lib/doc-edit/path-resolver'
import { docStoreUriFor, uriForResolvedPath, buildDocStoreUriResolver } from '@/lib/doc-edit/uri-producers'
import { parseQtapUri } from '@/lib/doc-edit/qtap-uri'
import { buildOpenContent } from '@/lib/services/librarian-notifications/writer'
import type { TieredMountPool } from '@/lib/mount-index/tiered-mount-pool'

const CARRIERS = ['Friday', 'Abigail', 'Amy', 'Laura', 'Charlie'] as const
const vaultId = (name: string) => `mp-${name.toLowerCase()}`
const vaultName = (name: string) => `${name} Character Vault`
const charId = (name: string) => `char-${name.toLowerCase()}`

/** One `metadata.json` per vault, each its own bytes. */
const metadataBytes = (name: string) => JSON.stringify({ carrier: name, flag: CARRIERS.indexOf(name as never) })

const vaults = CARRIERS.map((name) => ({
  id: vaultId(name),
  name: vaultName(name),
  mountType: 'database',
  storeType: 'character',
  enabled: true,
  basePath: '',
}))

/** The chat's cast: every vault in the participant tier (cross-character reads on). */
const castPool: TieredMountPool = {
  characterMountPointId: null,
  participantMountPointIds: vaults.map((v) => v.id),
  groupMountPointIds: [],
  projectMountPointIds: [],
  globalMountPointId: null,
}

beforeEach(() => {
  ;(getRepositories as jest.Mock).mockReturnValue({
    docMountPoints: {
      findById: jest.fn(async (id: string) => vaults.find((v) => v.id === id) ?? null),
      findEnabled: jest.fn(async () => vaults),
      countByName: jest.fn(async (name: string) => vaults.filter((v) => v.name.toLowerCase() === name.toLowerCase()).length),
    },
    characters: {
      findByIdRaw: jest.fn(async (id: string) => {
        const name = CARRIERS.find((n) => charId(n) === id)
        return name ? { id, name, characterDocumentMountPointId: vaultId(name) } : null
      }),
    },
    projects: { findById: jest.fn(async () => null) },
  })
})

/** Read `metadata.json` as `reader` from the store `mountPoint` names: the vault that answered and its bytes. */
async function readMetadataAs(reader: string, mountPoint: string | undefined, path = 'metadata.json') {
  const resolved = await resolveDocEditPath('document_store', path, {
    characterId: charId(reader),
    mountPool: castPool,
    mountPoint,
  })
  const owner = CARRIERS.find((n) => vaultId(n) === resolved.mountPointId)!
  return { mountPointId: resolved.mountPointId, bytes: metadataBytes(owner), resolved }
}

describe('producers name the vault', () => {
  it("never print qtap://self, even for the acting character's own vault", async () => {
    const single = await docStoreUriFor({ mountPointId: vaultId('Abigail'), mountPointName: vaultName('Abigail'), relativePath: 'metadata.json' })
    expect(single).toBe('qtap://Abigail%20Character%20Vault/metadata.json')

    const { resolved } = await readMetadataAs('Abigail', 'self')
    expect(await uriForResolvedPath(resolved)).toBe(single)

    const rows = await buildDocStoreUriResolver()
    expect(rows.uriForMount(vaultName('Abigail'), vaultId('Abigail'), 'metadata.json')).toBe(single)
  })

  it('the Librarian never announces a self address, even when the caller typed self', () => {
    const named = buildOpenContent({
      chatId: 'c', displayTitle: 'metadata.json', filePath: 'metadata.json', scope: 'document_store',
      mountPoint: vaultName('Abigail'), isNew: false, origin: { kind: 'opened-by-character', characterName: 'Abigail' },
    })
    expect(named).toContain('qtap://Abigail%20Character%20Vault/metadata.json')

    const legacy = buildOpenContent({
      chatId: 'c', displayTitle: 'metadata.json', filePath: 'metadata.json', scope: 'document_store',
      mountPoint: 'self', isNew: false, origin: { kind: 'opened-by-character', characterName: 'Abigail' },
    })
    expect(legacy).not.toContain('qtap://self')
    expect(legacy).not.toContain('"self"')
  })
})

describe('an address reads the same whoever follows it', () => {
  it("Abigail's own-vault address, followed by Friday, opens Abigail's file", async () => {
    const { resolved } = await readMetadataAs('Abigail', 'self')
    const published = parseQtapUri(await uriForResolvedPath(resolved))
    const followed = await readMetadataAs('Friday', published.mountPoint, published.path)
    expect(followed.mountPointId).toBe(vaultId('Abigail'))
    expect(followed.bytes).toBe(metadataBytes('Abigail'))
  })

  it('self typed by a character for her own vault still means her own vault', async () => {
    for (const reader of CARRIERS) {
      expect((await readMetadataAs(reader, 'self')).mountPointId).toBe(vaultId(reader))
    }
  })
})

describe('five vaults, one metadata.json each', () => {
  it("a read for carrier X returns X's file, never another's, never the same bytes for two carriers", async () => {
    const seen = new Map<string, string>()
    for (const reader of CARRIERS) {
      for (const carrier of CARRIERS) {
        const { mountPointId, bytes } = await readMetadataAs(reader, vaultName(carrier))
        expect(mountPointId).toBe(vaultId(carrier))
        expect(bytes).toBe(metadataBytes(carrier))
        const prior = seen.get(bytes)
        if (prior) expect(prior).toBe(carrier)
        seen.set(bytes, carrier)
      }
    }
    expect(seen.size).toBe(CARRIERS.length)
  })

  it('a wrong id is an error naming the id, and nothing is read', async () => {
    const attempt = readMetadataAs('Friday', 'mp-nobody')
    await expect(attempt).rejects.toBeInstanceOf(PathResolutionError)
    await expect(readMetadataAs('Friday', 'mp-nobody')).rejects.toThrow('No document store "mp-nobody" is reachable in this context')
  })

  it('a filename alone is refused: it is in every vault, so it names no carrier', async () => {
    await expect(readMetadataAs('Friday', undefined)).rejects.toMatchObject({ code: 'MISSING_CONTEXT' })
    await expect(readMetadataAs('Friday', undefined)).rejects.toThrow('every character vault has a metadata.json')
  })
})
