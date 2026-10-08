/**
 * Tests for the Commonplace digest vault bridge (memory-consolidation-and-tiers.md §C6):
 * the archived-character tombstone, the job-child host-RPC short-circuit, and
 * the skip-when-unchanged rewrite.
 *
 * `@/lib/repositories/factory` and `@/lib/file-storage/character-vault-bridge`
 * are mocked app-wide in jest.setup.ts — configured per-test here.
 */

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn().mockResolvedValue({ mtime: 0 }),
  readDatabaseDocumentIfExists: jest.fn().mockResolvedValue(null),
}))

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue('folder-id'),
}))

jest.mock('@/lib/background-jobs/child/host-rpc-client', () => ({
  callHost: jest.fn().mockResolvedValue({ written: 0, unchanged: 0, skipped: 0 }),
}))

import { writeCommonplaceDigestsToVault, type WriteCommonplaceDigestsInput } from '@/lib/file-storage/commonplace-digest-vault-bridge'
import { getRepositories } from '@/lib/repositories/factory'
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge'
import { readDatabaseDocumentIfExists, writeDatabaseDocument } from '@/lib/mount-index/database-store'
import { ensureFolderPath } from '@/lib/mount-index/folder-paths'
import { callHost } from '@/lib/background-jobs/child/host-rpc-client'

const mockGetRepositories = jest.mocked(getRepositories)
const mockVault = jest.mocked(getCharacterVaultStore)
const mockRead = jest.mocked(readDatabaseDocumentIfExists)
const mockWrite = jest.mocked(writeDatabaseDocument)
const mockCallHost = jest.mocked(callHost)

const input: WriteCommonplaceDigestsInput = {
  holderCharacterId: 'friday-1',
  updatedAt: '2026-10-08T00:00:00.000Z',
  files: [
    {
      subjectCharacterId: 'laura-1',
      subjectName: 'Laura',
      isSelf: false,
      digests: [{ content: 'Laura keeps the charts.', kind: 'semantic', occurredAt: null, reinforcedImportance: 0.8 }],
    },
    {
      subjectCharacterId: 'friday-1',
      subjectName: 'Friday',
      isSelf: true,
      digests: [{ content: 'I keep the ledgers.', kind: 'semantic', occurredAt: null, reinforcedImportance: 0.7 }],
    },
  ],
}

function withHolder(holder: Record<string, unknown> | null): void {
  mockGetRepositories.mockReturnValue({
    characters: { findByIdRaw: jest.fn(async () => holder) },
  } as unknown as ReturnType<typeof getRepositories>)
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.QUILLTAP_JOB_CHILD
  withHolder({ id: 'friday-1', name: 'Friday', archivedAt: null })
  mockVault.mockResolvedValue({ mountPointId: 'vault-1', mountPointName: 'Friday Vault' })
  mockRead.mockResolvedValue(null)
})

afterAll(() => {
  delete process.env.QUILLTAP_JOB_CHILD
})

describe('writeCommonplaceDigestsToVault', () => {
  it('writes Commonplace/<Subject>.md and Commonplace/Self.md into the holder vault', async () => {
    const result = await writeCommonplaceDigestsToVault(input)
    expect(ensureFolderPath).toHaveBeenCalledWith('vault-1', 'Commonplace')
    expect(mockWrite.mock.calls.map((c) => c[1])).toEqual(['Commonplace/Laura.md', 'Commonplace/Self.md'])
    expect(mockWrite.mock.calls[0][2]).toContain('type: commonplace-digest')
    expect(result.written).toBe(2)
  })

  it('skips an archived holder without touching its vault', async () => {
    withHolder({ id: 'friday-1', name: 'Friday', archivedAt: '2026-09-01T00:00:00.000Z' })
    const result = await writeCommonplaceDigestsToVault(input)
    expect(result.skippedReason).toBe('archived')
    expect(mockVault).not.toHaveBeenCalled()
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('does not rewrite a file whose digests are unchanged (only the stamp moved)', async () => {
    await writeCommonplaceDigestsToVault(input)
    const firstLaura = mockWrite.mock.calls[0][2]
    mockWrite.mockClear()
    mockRead.mockImplementation(async (_mp, path) =>
      path === 'Commonplace/Laura.md' ? firstLaura.replace('2026-10-08', '2026-10-01') : null,
    )
    const result = await writeCommonplaceDigestsToVault({ ...input, updatedAt: '2026-10-09T00:00:00.000Z' })
    expect(result.unchanged).toBe(1)
    expect(mockWrite.mock.calls.map((c) => c[1])).toEqual(['Commonplace/Self.md'])
  })

  it('routes through host-RPC from the job child', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1'
    await writeCommonplaceDigestsToVault(input)
    expect(mockCallHost).toHaveBeenCalledWith('writeCommonplaceDigestsToVault', input)
    expect(mockWrite).not.toHaveBeenCalled()
  })
})
