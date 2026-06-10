/**
 * Unit tests for the canonical read helpers (lib/mount-index/read-file.ts).
 *
 * Covers UTF-8 vs base64 encoding selection, line-window pagination, document
 * vs blob routing on database mounts, and not-found handling. Filesystem reads
 * are exercised by the integration/verification pass; here we mock repositories
 * so no real DB or disk is touched.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  }),
}));
jest.mock('@/lib/doc-edit/path-resolver', () => ({
  isTextFile: (p: string) => /\.(txt|md|markdown|json|jsonl|csv|yaml|yml)$/i.test(p),
}));
jest.mock('@/lib/mount-index/file-ops', () => ({
  resolveFsAbsolute: jest.fn((_mp: unknown, rel: string) => `/abs/${rel}`),
}));
jest.mock('@/lib/repositories/factory');
const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

import { readMountFile, readMountFileBytes } from '@/lib/mount-index/read-file';
import { FileOpError } from '@/lib/mount-index/file-op-error';

const MOUNT_ID = 'mount-1';
let repos: any;

beforeEach(() => {
  jest.clearAllMocks();
  repos = {
    docMountPoints: { findById: jest.fn().mockResolvedValue({ id: MOUNT_ID, mountType: 'database', basePath: '' }) },
    docMountFileLinks: { findByMountPointAndPath: jest.fn() },
    docMountDocuments: { findByMountPointAndPath: jest.fn() },
    docMountBlobs: { readDataByFileId: jest.fn(), findByMountPointAndPath: jest.fn() },
  };
  getRepositoriesMock.mockReturnValue(repos);
});

describe('readMountFile — database documents', () => {
  beforeEach(() => {
    repos.docMountFileLinks.findByMountPointAndPath.mockResolvedValue({
      id: 'l', fileId: 'f', fileType: 'markdown', sha256: 'sha-doc', lastModified: '2023-01-01T00:00:00.000Z',
    });
    repos.docMountDocuments.findByMountPointAndPath.mockResolvedValue({
      content: 'line1\nline2\nline3\nline4', contentSha256: 'sha-doc', lastModified: '2023-01-01T00:00:00.000Z',
    });
  });

  it('returns UTF-8 text with line count by default', async () => {
    const r = await readMountFile(MOUNT_ID, 'notes/a.md');
    expect(r.encoding).toBe('utf-8');
    expect(r.content).toBe('line1\nline2\nline3\nline4');
    expect(r.totalLines).toBe(4);
    expect(r.truncated).toBe(false);
    expect(r.fileType).toBe('markdown');
    expect(r.mtime).toBe(new Date('2023-01-01T00:00:00.000Z').getTime());
  });

  it('applies an offset/limit line window', async () => {
    const r = await readMountFile(MOUNT_ID, 'notes/a.md', { offset: 1, limit: 2 });
    expect(r.content).toBe('line2\nline3');
    expect(r.totalLines).toBe(4);
    expect(r.truncated).toBe(true);
  });

  it('returns base64 when encoding=base64 is forced', async () => {
    const r = await readMountFile(MOUNT_ID, 'notes/a.md', { encoding: 'base64' });
    expect(r.encoding).toBe('base64');
    expect(Buffer.from(r.content, 'base64').toString('utf-8')).toBe('line1\nline2\nline3\nline4');
  });
});

describe('readMountFile — database blobs', () => {
  beforeEach(() => {
    repos.docMountFileLinks.findByMountPointAndPath.mockResolvedValue({
      id: 'l', fileId: 'f', fileType: 'blob', sha256: 'sha-blob', lastModified: '2023-02-02T00:00:00.000Z',
    });
    repos.docMountBlobs.readDataByFileId.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    repos.docMountBlobs.findByMountPointAndPath.mockResolvedValue({
      storedMimeType: 'image/webp', sha256: 'sha-blob', sizeBytes: 4,
    });
  });

  it('defaults binary files to base64', async () => {
    const r = await readMountFile(MOUNT_ID, 'images/p.webp');
    expect(r.encoding).toBe('base64');
    expect(r.mimeType).toBe('image/webp');
    expect(Buffer.from(r.content, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(r.fileType).toBe('blob');
  });

  it('readMountFileBytes returns the stored mime + sha', async () => {
    const r = await readMountFileBytes(MOUNT_ID, 'images/p.webp');
    expect(r.mimeType).toBe('image/webp');
    expect(r.sha256).toBe('sha-blob');
    expect(r.sizeBytes).toBe(4);
  });
});

describe('readMountFile — errors', () => {
  it('throws SOURCE_NOT_FOUND when no link exists', async () => {
    repos.docMountFileLinks.findByMountPointAndPath.mockResolvedValue(null);
    await expect(readMountFile(MOUNT_ID, 'missing.md')).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  });

  it('throws MOUNT_NOT_FOUND for an unknown mount', async () => {
    repos.docMountPoints.findById.mockResolvedValue(null);
    await expect(readMountFile('nope', 'a.md')).rejects.toBeInstanceOf(FileOpError);
  });

  it('rejects path traversal', async () => {
    await expect(readMountFile(MOUNT_ID, '../escape.md')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
});
