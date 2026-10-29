/**
 * @jest-environment node
 *
 * The scanner must not read a file a cloud-sync provider has evicted: reading
 * it downloads it. A store pointed at an iCloud-synced ~/Documents (23,615 of
 * 24,153 files evicted) faulted them in one at a time and held the startup
 * gate for its full five-minute cap. A skipped file keeps its index entry.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock('fs/promises', () => ({
  __esModule: true,
  default: {
    stat: jest.fn(),
    readdir: jest.fn(),
    readFile: jest.fn(),
  },
}));

jest.mock('@/lib/file-storage/scanner', () => ({
  computeSha256: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/mount-index/converters', () => ({
  convertToPlainText: jest.fn(),
}));

jest.mock('@/lib/files/cloud-placeholder', () => ({
  isEvictedCloudPlaceholder: jest.fn(),
}));

import fs from 'fs/promises';
import { processMountFile, scanMountPoint } from '@/lib/mount-index/scanner';
import { computeSha256 } from '@/lib/file-storage/scanner';
import { getRepositories } from '@/lib/repositories/factory';
import { convertToPlainText } from '@/lib/mount-index/converters';
import { isEvictedCloudPlaceholder } from '@/lib/files/cloud-placeholder';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';

const mockStat = fs.stat as jest.Mock;
const mockReaddir = fs.readdir as jest.Mock;
const mockSha = computeSha256 as jest.Mock;
const mockConvert = convertToPlainText as jest.Mock;
const mockIsEvicted = isEvictedCloudPlaceholder as jest.Mock;
const mockGetRepositories = getRepositories as jest.Mock;

const mountPoint = {
  id: 'mp-docs',
  name: 'Documents',
  basePath: '/Users/me/Documents',
  mountType: 'filesystem',
  includePatterns: [],
  excludePatterns: [],
  enabled: true,
} as unknown as DocMountPoint;

function makeRepos(existing: Array<{ id: string; relativePath: string }> = []) {
  return {
    docMountFileLinks: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      deleteWithGC: jest.fn().mockResolvedValue(undefined),
      linkFilesystemFile: jest.fn(),
      update: jest.fn(),
    },
    docMountFiles: {
      findByMountPointId: jest.fn().mockResolvedValue(existing),
    },
    docMountChunks: {
      deleteByLinkId: jest.fn(),
      bulkInsert: jest.fn(),
    },
    docMountPoints: {
      updateScanStatus: jest.fn().mockResolvedValue(undefined),
      updateLastScanned: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function fileEntry(name: string) {
  return { name, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStat.mockResolvedValue({ size: 4096, blocks: 0, mtime: new Date(0) });
});

describe('processMountFile', () => {
  it('returns in-cloud without hashing or reading an evicted file', async () => {
    mockGetRepositories.mockReturnValue(makeRepos());
    mockIsEvicted.mockReturnValue(true);

    const outcome = await processMountFile(mountPoint, '/Users/me/Documents/notes.md', 'notes.md');

    expect(outcome).toEqual({ status: 'in-cloud' });
    expect(mockSha).not.toHaveBeenCalled();
    expect(mockConvert).not.toHaveBeenCalled();
  });

  it('hashes a resident file as before', async () => {
    mockGetRepositories.mockReturnValue(makeRepos());
    mockIsEvicted.mockReturnValue(false);
    mockSha.mockResolvedValue('abc');
    mockConvert.mockResolvedValue('');

    const outcome = await processMountFile(mountPoint, '/Users/me/Documents/notes.md', 'notes.md');

    expect(mockSha).toHaveBeenCalledWith('/Users/me/Documents/notes.md');
    expect(outcome).toEqual({ status: 'empty' });
  });

  it('does not stat a file type the scanner ignores', async () => {
    mockGetRepositories.mockReturnValue(makeRepos());

    const outcome = await processMountFile(mountPoint, '/Users/me/Documents/song.m4a', 'song.m4a');

    expect(outcome).toEqual({ status: 'unsupported' });
    expect(mockStat).not.toHaveBeenCalled();
  });
});

describe('scanMountPoint', () => {
  it('counts evicted files and keeps their existing index entries', async () => {
    const repos = makeRepos([{ id: 'link-1', relativePath: 'notes.md' }]);
    mockGetRepositories.mockReturnValue(repos);
    mockReaddir.mockResolvedValue([fileEntry('notes.md'), fileEntry('plan.txt')]);
    mockIsEvicted.mockReturnValue(true);

    const result = await scanMountPoint(mountPoint);

    expect(result.filesScanned).toBe(2);
    expect(result.filesInCloud).toBe(2);
    expect(result.filesDeleted).toBe(0);
    expect(result.errors).toEqual([]);
    expect(repos.docMountFileLinks.deleteWithGC).not.toHaveBeenCalled();
    expect(mockSha).not.toHaveBeenCalled();
  });
});
