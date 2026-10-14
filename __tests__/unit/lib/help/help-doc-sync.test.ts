/**
 * Help Doc Sync Unit Tests
 *
 * Covers the disk -> database sync for help documentation: how changed and
 * unchanged docs are detected, pruning of rows whose Markdown file has been
 * deleted, and the startup reconcile that slices section-less docs and queues
 * embedding for every incomplete one.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'
import { join } from 'node:path'

jest.mock('@/lib/logger', () => {
  // `child` is needed because the chunker (reached through help-doc-chunking)
  // builds a service logger at module load.
  const base: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  base.child = jest.fn(() => base)
  return { __esModule: true, logger: base }
})

jest.mock('node:fs', () => ({
  __esModule: true,
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  __esModule: true,
  enqueueEmbeddingGenerate: jest.fn().mockResolvedValue({ jobId: 'job-1', isNew: true }),
}))

import { syncHelpDocs, reconcileHelpDocs } from '@/lib/help/help-doc-sync'
import { getRepositories } from '@/lib/repositories/factory'
import { enqueueEmbeddingGenerate } from '@/lib/background-jobs/queue-service'
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'

const mockedGetRepositories = getRepositories as jest.Mock
const mockedEnqueue = enqueueEmbeddingGenerate as jest.Mock
const mockedExistsSync = existsSync as jest.Mock
const mockedReaddirSync = readdirSync as jest.Mock
const mockedStatSync = statSync as jest.Mock
const mockedReadFileSync = readFileSync as jest.Mock

const HELP_DIR = join(process.cwd(), 'help')

/** Point the mocked fs at a flat help/ directory of `filename -> contents`. */
function givenHelpDirContains(files: Record<string, string>): void {
  mockedExistsSync.mockReturnValue(true)
  mockedReaddirSync.mockImplementation((dir: string) =>
    dir === HELP_DIR ? Object.keys(files) : []
  )
  mockedStatSync.mockReturnValue({ isDirectory: () => false })
  mockedReadFileSync.mockImplementation((path: string) => {
    const name = path.replace(`${HELP_DIR}/`, '')
    if (!(name in files)) throw new Error(`ENOENT: ${path}`)
    return files[name]
  })
}

function helpDocRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'existing-id',
    title: 'Aurora',
    path: 'help/aurora.md',
    url: '/aurora',
    content: '# Aurora',
    contentHash: 'stale-hash',
    embedding: null,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  }
}

describe('help-doc-sync', () => {
  let mockHelpDocs: Record<string, jest.Mock>
  let mockHelpDocChunks: Record<string, jest.Mock>
  let mockEmbeddingStatus: Record<string, jest.Mock>

  beforeEach(() => {
    jest.clearAllMocks()

    mockHelpDocs = {
      findAll: jest.fn().mockResolvedValue([]),
      findByPath: jest.fn().mockResolvedValue(null),
      // Both shaped like the job child's buffered writes: `create` hands back
      // an id of its own rather than the one it was asked to use, and `update`
      // returns nothing. The sync must key chunks to ids it already knows.
      create: jest.fn().mockImplementation(async (data: Record<string, unknown>) => ({
        ...data,
        id: 'id-returned-by-a-buffered-write',
      })),
      update: jest.fn().mockResolvedValue(undefined),
      clearAllEmbeddingsForDoc: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(true),
    }
    mockHelpDocChunks = {
      replaceForDoc: jest.fn().mockResolvedValue(0),
      deleteByDocId: jest.fn().mockResolvedValue(0),
      countByDoc: jest.fn().mockResolvedValue(new Map()),
    }
    mockEmbeddingStatus = {
      deleteByEntity: jest.fn().mockResolvedValue(1),
    }

    mockedGetRepositories.mockReturnValue({
      helpDocs: mockHelpDocs,
      helpDocChunks: mockHelpDocChunks,
      embeddingStatus: mockEmbeddingStatus,
      embeddingProfiles: {
        findAll: jest.fn().mockResolvedValue([{ id: 'profile-1', isDefault: true }]),
      },
      users: { findAll: jest.fn().mockResolvedValue([{ id: 'user-1' }]) },
    })
  })

  describe('syncHelpDocs', () => {
    it('creates docs that are on disk but not in the database', async () => {
      givenHelpDirContains({
        'answer-confirmation.md': '---\nurl: /salon\n---\n# Answer Confirmation\n\nBody.',
      })

      const result = await syncHelpDocs()

      expect(result.created).toBe(1)
      expect(result.totalOnDisk).toBe(1)
      expect(mockHelpDocs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'help/answer-confirmation.md',
          title: 'Answer Confirmation',
          url: '/salon',
        }),
        { id: expect.any(String) }
      )
    })

    it('skips docs whose content hash is unchanged', async () => {
      const content = '# Aurora\n\nBody.'
      givenHelpDirContains({ 'aurora.md': content })
      const { createHash } = await import('node:crypto')
      const hash = createHash('sha256').update(content).digest('hex')
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow({ contentHash: hash })])

      const result = await syncHelpDocs()

      expect(result.unchanged).toBe(1)
      expect(result.updated).toBe(0)
      expect(mockHelpDocs.create).not.toHaveBeenCalled()
      expect(mockHelpDocs.update).not.toHaveBeenCalled()
    })

    it('clears the embedding of a doc whose content changed', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora\n\nRewritten.' })
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow({ contentHash: 'stale-hash' })])

      const result = await syncHelpDocs()

      expect(result.updated).toBe(1)
      expect(mockHelpDocs.update).toHaveBeenCalledWith(
        'existing-id',
        expect.objectContaining({ content: '# Aurora\n\nRewritten.' })
      )
      expect(mockHelpDocs.clearAllEmbeddingsForDoc).toHaveBeenCalledWith('existing-id')
      // A failure recorded against the old text must not bar the new text
      expect(mockEmbeddingStatus.deleteByEntity).toHaveBeenCalledWith('HELP_DOC', 'existing-id')
    })

    it('keys a changed doc\'s chunks to the existing row id (bug 167)', async () => {
      // In the job child `update` is a buffered write that returns nothing, and
      // the old upsert-by-path returned a random synthetic id there — so every
      // chunk insert failed its foreign key when the parent replayed the batch.
      givenHelpDirContains({ 'aurora.md': '# Aurora\n\nRewritten.' })
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow({ contentHash: 'stale-hash' })])

      await syncHelpDocs()

      expect(mockHelpDocChunks.replaceForDoc).toHaveBeenCalledWith('existing-id', expect.any(Array))
    })

    it('keys a new doc\'s chunks to the id it asked create to use (bug 167)', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora\n\nBody.' })

      await syncHelpDocs()

      const [, options] = mockHelpDocs.create.mock.calls[0]
      expect(options.id).not.toBe('id-returned-by-a-buffered-write')
      expect(mockHelpDocChunks.replaceForDoc).toHaveBeenCalledWith(options.id, expect.any(Array))
    })

    it('prunes rows whose file has been deleted from disk', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ id: 'gone-id', path: 'help/retired.md' }),
      ])

      const result = await syncHelpDocs()

      expect(result.deleted).toBe(1)
      expect(mockHelpDocs.delete).toHaveBeenCalledWith('gone-id')
      expect(mockEmbeddingStatus.deleteByEntity).toHaveBeenCalledWith('HELP_DOC', 'gone-id')
    })

    it('writes section chunks for every doc it creates', async () => {
      givenHelpDirContains({
        'aurora.md': '---\nurl: /aurora\n---\n# Aurora\n\n## First section\n\nBody one.\n\n## Second section\n\nBody two.',
      })

      const result = await syncHelpDocs()

      const [, options] = mockHelpDocs.create.mock.calls[0]
      expect(mockHelpDocChunks.replaceForDoc).toHaveBeenCalledWith(
        options.id,
        expect.arrayContaining([
          expect.objectContaining({ chunkIndex: 0, content: expect.stringContaining('Body one.') }),
        ])
      )
      expect(result.chunksWritten).toBeGreaterThan(0)
    })

    it('does not re-slice a doc whose content hash is unchanged', async () => {
      const content = '# Aurora\n\nBody.'
      givenHelpDirContains({ 'aurora.md': content })
      const { createHash } = await import('node:crypto')
      const hash = createHash('sha256').update(content).digest('hex')
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow({ contentHash: hash })])

      const result = await syncHelpDocs()

      expect(mockHelpDocChunks.replaceForDoc).not.toHaveBeenCalled()
      expect(result.chunksWritten).toBe(0)
    })

    it('removes a pruned doc\'s chunks along with the doc', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ id: 'gone-id', path: 'help/retired.md' }),
      ])

      await syncHelpDocs()

      expect(mockHelpDocChunks.deleteByDocId).toHaveBeenCalledWith('gone-id')
    })

    it('never prunes when the help directory is missing', async () => {
      mockedExistsSync.mockReturnValue(false)
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow()])

      const result = await syncHelpDocs()

      expect(result.deleted).toBe(0)
      expect(mockHelpDocs.delete).not.toHaveBeenCalled()
    })

    it('never prunes when the help directory yields no readable files', async () => {
      givenHelpDirContains({})
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow()])

      const result = await syncHelpDocs()

      expect(result.deleted).toBe(0)
      expect(mockHelpDocs.delete).not.toHaveBeenCalled()
    })

    it('never wipes the table when the only file on disk is whitespace-only (Bug 18)', async () => {
      // files.length is 1 here, so the empty-directory guard does not fire; the
      // file trims to nothing, produces no usable content, and the prune would
      // delete every populated row (measured: totalOnDisk 1, deleted 3, rows
      // left 0). An all-blank help set against a populated table is suspicious,
      // not an instruction to wipe.
      givenHelpDirContains({ 'aurora.md': '   \n\t\n  ' })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ id: 'a', path: 'help/aurora.md' }),
        helpDocRow({ id: 'b', path: 'help/brahma-console.md' }),
        helpDocRow({ id: 'c', path: 'help/carina.md' }),
      ])

      const result = await syncHelpDocs()

      expect(result.totalOnDisk).toBe(1)
      expect(result.deleted).toBe(0)
      expect(mockHelpDocs.delete).not.toHaveBeenCalled()
      expect(mockEmbeddingStatus.deleteByEntity).not.toHaveBeenCalled()
    })

    it('still prunes stale rows when at least one file has usable content', async () => {
      // The guard only trips when NOTHING parses; a real doc alongside a blank
      // one must still reconcile the genuinely-gone row.
      givenHelpDirContains({
        'aurora.md': '# Aurora\n\nReal content.',
        'blank.md': '   \n  ',
      })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ id: 'keep', path: 'help/aurora.md' }),
        helpDocRow({ id: 'gone-id', path: 'help/retired.md' }),
      ])

      const result = await syncHelpDocs()

      expect(result.deleted).toBe(1)
      expect(mockHelpDocs.delete).toHaveBeenCalledWith('gone-id')
      expect(mockHelpDocs.delete).not.toHaveBeenCalledWith('keep')
    })
  })

  describe('reconcileHelpDocs', () => {
    /** Content hash as the sync computes it, so a row reads as unchanged. */
    async function hashOf(content: string): Promise<string> {
      const { createHash } = await import('node:crypto')
      return createHash('sha256').update(content).digest('hex')
    }

    const embedded = new Float32Array([0.6, 0.8])

    it('re-syncs a page whose text changed even when no file was added or removed', async () => {
      // The old lazy check compared only file names, so this edit was never
      // picked up outside a full reindex.
      givenHelpDirContains({ 'aurora.md': '# Aurora\n\nRewritten.' })
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow({ contentHash: 'stale-hash' })])

      const result = await reconcileHelpDocs()

      expect(result.sync.updated).toBe(1)
      expect(mockHelpDocs.update).toHaveBeenCalledWith('existing-id', expect.anything())
    })

    it('queues nothing when every page is unchanged and fully embedded', async () => {
      const content = '# Aurora\n\nBody.'
      givenHelpDirContains({ 'aurora.md': content })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ contentHash: await hashOf(content), content, embedding: embedded }),
      ])
      mockHelpDocChunks.countByDoc.mockResolvedValue(new Map([['existing-id', { total: 2, embedded: 2 }]]))

      const result = await reconcileHelpDocs()

      expect(result.incomplete).toBe(0)
      expect(mockHelpDocs.update).not.toHaveBeenCalled()
      expect(mockHelpDocChunks.replaceForDoc).not.toHaveBeenCalled()
      expect(mockedEnqueue).not.toHaveBeenCalled()
    })

    it('slices and queues an unchanged page that has no sections (bug 167 aftermath)', async () => {
      // Other pages already have sections, which is what defeated the old
      // "any rows at all?" backfill check.
      const content = '# Aurora\n\nBody.'
      givenHelpDirContains({ 'aurora.md': content })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ contentHash: await hashOf(content), content, embedding: embedded }),
      ])
      mockHelpDocChunks.countByDoc.mockResolvedValue(new Map([['some-other-doc', { total: 3, embedded: 3 }]]))

      const result = await reconcileHelpDocs()

      expect(result.sectionsBackfilled).toBe(1)
      expect(mockHelpDocChunks.replaceForDoc).toHaveBeenCalledWith(
        'existing-id',
        expect.arrayContaining([expect.objectContaining({ chunkIndex: 0 })])
      )
      expect(mockedEnqueue).toHaveBeenCalledWith('user-1', {
        entityType: 'HELP_DOC',
        entityId: 'existing-id',
        profileId: 'profile-1',
      })
    })

    it('queues a page whose own vector is missing', async () => {
      const content = '# Aurora\n\nBody.'
      givenHelpDirContains({ 'aurora.md': content })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ contentHash: await hashOf(content), content, embedding: null }),
      ])
      mockHelpDocChunks.countByDoc.mockResolvedValue(new Map([['existing-id', { total: 2, embedded: 2 }]]))

      await reconcileHelpDocs()

      expect(mockedEnqueue).toHaveBeenCalledWith('user-1', expect.objectContaining({ entityId: 'existing-id' }))
    })

    it('queues a page with any section still unembedded', async () => {
      const content = '# Aurora\n\nBody.'
      givenHelpDirContains({ 'aurora.md': content })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ contentHash: await hashOf(content), content, embedding: embedded }),
      ])
      mockHelpDocChunks.countByDoc.mockResolvedValue(new Map([['existing-id', { total: 4, embedded: 3 }]]))

      await reconcileHelpDocs()

      expect(mockHelpDocChunks.replaceForDoc).not.toHaveBeenCalled()
      expect(mockedEnqueue).toHaveBeenCalledWith('user-1', expect.objectContaining({ entityId: 'existing-id' }))
    })

    it('still completes when no embedding profile is configured', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow({ embedding: null })])
      mockedGetRepositories().embeddingProfiles.findAll.mockResolvedValue([])

      await expect(reconcileHelpDocs()).resolves.toEqual(expect.objectContaining({ incomplete: 1 }))
      expect(mockedEnqueue).not.toHaveBeenCalled()
    })
  })

  describe('ensureHelpDocsSynced', () => {
    /** A fresh copy of the module, so its once-per-process memo starts empty. */
    function freshModule(): typeof import('@/lib/help/help-doc-sync') {
      let mod!: typeof import('@/lib/help/help-doc-sync')
      jest.isolateModules(() => {
        mod = require('@/lib/help/help-doc-sync')
      })
      return mod
    }

    it('reconciles once per process however many callers ask', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })
      const { ensureHelpDocsSynced } = freshModule()

      await Promise.all([ensureHelpDocsSynced(), ensureHelpDocsSynced()])
      await ensureHelpDocsSynced()

      expect(mockHelpDocs.create).toHaveBeenCalledTimes(1)
    })

    it('never throws, and retries on the next call after a failure', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })
      mockHelpDocs.findAll.mockRejectedValueOnce(new Error('database is locked'))
      const { ensureHelpDocsSynced } = freshModule()

      await expect(ensureHelpDocsSynced()).resolves.toBeUndefined()
      expect(mockHelpDocs.create).not.toHaveBeenCalled()

      await ensureHelpDocsSynced()
      expect(mockHelpDocs.create).toHaveBeenCalledTimes(1)
    })
  })
})
