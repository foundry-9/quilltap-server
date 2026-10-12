/**
 * The Commonplace mirror is written from committed rows, in the parent only
 * (bug 208): which buckets a committed batch touched, the digests read back
 * from the database, and the commit hook's gates.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})
jest.mock('@/lib/file-storage/commonplace-digest-vault-bridge', () => ({
  writeCommonplaceDigestsToVault: jest.fn(),
}))

import {
  mirrorCommonplaceAfterCommit,
  mirrorCommonplaceForSubjects,
  subjectsTouchedByWrites,
} from '../commonplace-mirror'
import { getRepositories } from '@/lib/repositories/factory'
import { writeCommonplaceDigestsToVault } from '@/lib/file-storage/commonplace-digest-vault-bridge'

const HOLDER = 'friday-1'
const LAURA = 'laura-1'
const GONE = 'gone-1'

let repos: any

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.QUILLTAP_JOB_CHILD
  repos = {
    memories: {
      findByIdForCharacter: jest.fn(async (_holder: string, id: string) =>
        id === 'digest-old'
          ? { id, source: 'CONSOLIDATED', aboutCharacterId: HOLDER }
          : { id, source: 'AUTO', aboutCharacterId: LAURA },
      ),
      findHotDigests: jest.fn(async (_holder: string, subject: string) =>
        subject === 'self'
          ? [{ id: 's1', content: 'I keep the ledgers.', kind: 'semantic', occurredAt: null, reinforcedImportance: 0.7, importance: 0.7 }]
          : [{ id: 'd1', content: 'Laura keeps the charts.', kind: 'semantic', occurredAt: null, reinforcedImportance: 0.8, importance: 0.8 }],
      ),
    },
    characters: {
      findByIdRaw: jest.fn(async (id: string) =>
        id === HOLDER ? { id: HOLDER, name: 'Friday', archivedAt: null } : id === LAURA ? { id: LAURA, name: 'Laura' } : null,
      ),
      findById: jest.fn(async (id: string) => (id === LAURA ? { id: LAURA, name: 'Laura' } : null)),
    },
  }
  jest.mocked(getRepositories).mockReturnValue(repos)
  ;(writeCommonplaceDigestsToVault as jest.Mock).mockResolvedValue({ written: 2, unchanged: 0, skipped: 0 })
})

afterAll(() => {
  delete process.env.QUILLTAP_JOB_CHILD
})

describe('subjectsTouchedByWrites', () => {
  it('collects created digests by data and revised digests by the committed row', async () => {
    const touched = await subjectsTouchedByWrites([
      { method: 'memories.create', args: [{ characterId: HOLDER, aboutCharacterId: LAURA, source: 'CONSOLIDATED' }, { id: 'd1' }] },
      { method: 'memories.create', args: [{ characterId: HOLDER, aboutCharacterId: LAURA, source: 'AUTO' }] }, // not a digest
      { method: 'memories.create', args: [{ characterId: HOLDER, aboutCharacterId: null, source: 'CONSOLIDATED' }] }, // no-subject: no mirror
      { method: 'memories.updateForCharacter', args: [HOLDER, 'digest-old', { content: 'x', consolidatedFrom: ['a'] }] },
      { method: 'memories.updateForCharacter', args: [HOLDER, 'row-1', { relatedMemoryIds: [] }] }, // link rewrite only
    ])
    expect(Array.from(touched.keys())).toEqual([HOLDER])
    expect(Array.from(touched.get(HOLDER)!).sort()).toEqual([HOLDER, LAURA].sort())
    expect(repos.memories.findByIdForCharacter).toHaveBeenCalledTimes(1)
  })
})

describe('mirrorCommonplaceForSubjects', () => {
  it('writes each bucket from the committed hot digests', async () => {
    const written = await mirrorCommonplaceForSubjects(HOLDER, [LAURA, HOLDER, GONE], '2026-10-12T00:00:00.000Z')
    expect(written).toBe(2)
    expect(repos.memories.findHotDigests).toHaveBeenCalledWith(HOLDER, LAURA, expect.any(Number))
    expect(repos.memories.findHotDigests).toHaveBeenCalledWith(HOLDER, 'self', expect.any(Number))
    const input = (writeCommonplaceDigestsToVault as jest.Mock).mock.calls[0][0]
    expect(input.holderCharacterId).toBe(HOLDER)
    expect(input.updatedAt).toBe('2026-10-12T00:00:00.000Z')
    // A subject that no longer exists gets no file.
    expect(input.files.map((f: any) => [f.subjectCharacterId, f.subjectName, f.isSelf])).toEqual([
      [LAURA, 'Laura', false],
      [HOLDER, 'Friday', true],
    ])
    expect(input.files[0].digests).toEqual([
      { content: 'Laura keeps the charts.', kind: 'semantic', occurredAt: null, reinforcedImportance: 0.8 },
    ])
  })

  it('does nothing in the job child', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1'
    expect(await mirrorCommonplaceForSubjects(HOLDER, [LAURA])).toBe(0)
    expect(repos.memories.findHotDigests).not.toHaveBeenCalled()
    expect(writeCommonplaceDigestsToVault).not.toHaveBeenCalled()
  })

  it('never throws when the read fails', async () => {
    repos.memories.findHotDigests.mockRejectedValue(new Error('db gone'))
    await expect(mirrorCommonplaceForSubjects(HOLDER, [LAURA])).resolves.toBe(0)
  })
})

describe('mirrorCommonplaceAfterCommit', () => {
  const writes = [
    { method: 'memories.create', args: [{ characterId: HOLDER, aboutCharacterId: LAURA, source: 'CONSOLIDATED' }] },
  ]

  it('mirrors a committed consolidation batch', async () => {
    await mirrorCommonplaceAfterCommit('MEMORY_CONSOLIDATION', { characterId: HOLDER }, writes)
    expect(writeCommonplaceDigestsToVault).toHaveBeenCalledTimes(1)
  })

  it('ignores other job types and dry runs', async () => {
    await mirrorCommonplaceAfterCommit('MEMORY_EXTRACTION', { characterId: HOLDER }, writes)
    await mirrorCommonplaceAfterCommit('MEMORY_CONSOLIDATION', { characterId: HOLDER, dryRun: true }, writes)
    await mirrorCommonplaceAfterCommit(undefined, undefined, writes)
    expect(writeCommonplaceDigestsToVault).not.toHaveBeenCalled()
  })
})
