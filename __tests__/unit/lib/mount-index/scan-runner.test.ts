/**
 * Unit tests for lib/mount-index/scan-runner.ts
 *
 * Tests the orchestration logic that scans all enabled mount points
 * sequentially, validates basePath accessibility, and enqueues embeddings.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('fs/promises', () => ({
  access: jest.fn(),
}))

jest.mock('@/lib/mount-index/scanner', () => ({
  scanMountPoint: jest.fn(),
}))

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn(),
}))

import { scanAllMountPoints } from '@/lib/mount-index/scan-runner'
import { getRepositories } from '@/lib/repositories/factory'
import { scanMountPoint } from '@/lib/mount-index/scanner'
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler'
import * as fsPromises from 'fs/promises'

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockScanMountPoint = scanMountPoint as jest.MockedFunction<typeof scanMountPoint>
const mockEnqueueEmbeddingJobsForMountPoint = enqueueEmbeddingJobsForMountPoint as jest.MockedFunction<typeof enqueueEmbeddingJobsForMountPoint>
const mockFsAccess = fsPromises.access as jest.MockedFunction<typeof fsPromises.access>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMountPoint(id: string, basePath = '/archive') {
  return {
    id,
    name: `Mount ${id}`,
    basePath,
    enabled: true,
  }
}

function makeOkScanResult(mountPointId: string, chunksCreated = 0) {
  return {
    mountPointId,
    filesScanned: 1,
    filesNew: 1,
    filesModified: 0,
    filesDeleted: 0,
    chunksCreated,
    errors: [],
  }
}

function makeRepos(mountPoints: ReturnType<typeof makeMountPoint>[]) {
  return {
    docMountPoints: {
      findEnabled: jest.fn().mockResolvedValue(mountPoints),
      updateScanStatus: jest.fn().mockResolvedValue(undefined),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scanAllMountPoints', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFsAccess.mockResolvedValue(undefined)
    mockScanMountPoint.mockResolvedValue(makeOkScanResult('mp-1'))
    mockEnqueueEmbeddingJobsForMountPoint.mockResolvedValue(0)
  })

  it('returns an empty array when there are no enabled mount points', async () => {
    mockGetRepositories.mockReturnValue(makeRepos([]) as ReturnType<typeof getRepositories>)

    const results = await scanAllMountPoints()

    expect(results).toEqual([])
    expect(mockScanMountPoint).not.toHaveBeenCalled()
  })

  it('calls scanMountPoint for each enabled mount point', async () => {
    const mps = [makeMountPoint('mp-1'), makeMountPoint('mp-2')]
    mockGetRepositories.mockReturnValue(makeRepos(mps) as ReturnType<typeof getRepositories>)
    mockScanMountPoint.mockImplementation(mp => Promise.resolve(makeOkScanResult(mp.id)))

    const results = await scanAllMountPoints()

    expect(mockScanMountPoint).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(2)
  })

  it('returns one result per mount point', async () => {
    const mps = [makeMountPoint('mp-1'), makeMountPoint('mp-2'), makeMountPoint('mp-3')]
    mockGetRepositories.mockReturnValue(makeRepos(mps) as ReturnType<typeof getRepositories>)
    mockScanMountPoint.mockImplementation(mp => Promise.resolve(makeOkScanResult(mp.id)))

    const results = await scanAllMountPoints()

    expect(results).toHaveLength(3)
    const ids = results.map(r => r.mountPointId)
    expect(ids).toContain('mp-1')
    expect(ids).toContain('mp-2')
    expect(ids).toContain('mp-3')
  })

  it('enqueues embedding jobs when scan creates new chunks', async () => {
    const mps = [makeMountPoint('mp-1')]
    mockGetRepositories.mockReturnValue(makeRepos(mps) as ReturnType<typeof getRepositories>)
    mockScanMountPoint.mockResolvedValue(makeOkScanResult('mp-1', 5)) // 5 chunks created

    await scanAllMountPoints()

    expect(mockEnqueueEmbeddingJobsForMountPoint).toHaveBeenCalledWith('mp-1')
  })

  it('does not enqueue embedding jobs when scan creates no new chunks', async () => {
    const mps = [makeMountPoint('mp-1')]
    mockGetRepositories.mockReturnValue(makeRepos(mps) as ReturnType<typeof getRepositories>)
    mockScanMountPoint.mockResolvedValue(makeOkScanResult('mp-1', 0)) // 0 chunks

    await scanAllMountPoints()

    expect(mockEnqueueEmbeddingJobsForMountPoint).not.toHaveBeenCalled()
  })

  it('records an error result (not throws) when basePath is not accessible', async () => {
    const mps = [makeMountPoint('mp-1', '/bad/path')]
    const repos = makeRepos(mps)
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)
    mockFsAccess.mockRejectedValue(new Error('ENOENT'))

    const results = await scanAllMountPoints()

    expect(results).toHaveLength(1)
    expect(results[0].errors.length).toBeGreaterThan(0)
    expect(results[0].filesScanned).toBe(0)
    expect(mockScanMountPoint).not.toHaveBeenCalled()
  })

  it('updates scan status to error when basePath is inaccessible', async () => {
    const mps = [makeMountPoint('mp-1', '/bad/path')]
    const repos = makeRepos(mps)
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)
    mockFsAccess.mockRejectedValue(new Error('EACCES'))

    await scanAllMountPoints()

    expect(repos.docMountPoints.updateScanStatus).toHaveBeenCalledWith(
      'mp-1',
      'error',
      expect.stringContaining('/bad/path')
    )
  })

  it('continues scanning other mount points after one fails', async () => {
    const mps = [makeMountPoint('mp-1'), makeMountPoint('mp-2')]
    mockGetRepositories.mockReturnValue(makeRepos(mps) as ReturnType<typeof getRepositories>)
    // First scan throws
    mockScanMountPoint
      .mockRejectedValueOnce(new Error('Scan failed'))
      .mockResolvedValueOnce(makeOkScanResult('mp-2'))

    const results = await scanAllMountPoints()

    expect(results).toHaveLength(2)
    // mp-1 should have an error
    expect(results.find(r => r.mountPointId === 'mp-1')?.errors.length).toBeGreaterThan(0)
    // mp-2 should succeed
    expect(results.find(r => r.mountPointId === 'mp-2')?.errors).toHaveLength(0)
  })

  it('skips basePath accessibility check for database-backed mount points', async () => {
    const mps = [{ ...makeMountPoint('mp-db', ''), mountType: 'database' as const }]
    const repos = makeRepos(mps)
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)
    mockFsAccess.mockRejectedValue(new Error('ENOENT'))
    mockScanMountPoint.mockResolvedValue(makeOkScanResult('mp-db'))

    const results = await scanAllMountPoints()

    expect(mockFsAccess).not.toHaveBeenCalled()
    expect(mockScanMountPoint).toHaveBeenCalledTimes(1)
    expect(results[0].errors).toHaveLength(0)
    expect(repos.docMountPoints.updateScanStatus).not.toHaveBeenCalledWith(
      'mp-db',
      'error',
      expect.any(String)
    )
  })

  it('gracefully handles embedding enqueue failures without propagating error', async () => {
    const mps = [makeMountPoint('mp-1')]
    mockGetRepositories.mockReturnValue(makeRepos(mps) as ReturnType<typeof getRepositories>)
    mockScanMountPoint.mockResolvedValue(makeOkScanResult('mp-1', 3))
    mockEnqueueEmbeddingJobsForMountPoint.mockRejectedValue(new Error('Queue unavailable'))

    // Should not throw; scan result is still returned
    const results = await scanAllMountPoints()
    expect(results).toHaveLength(1)
  })
})
