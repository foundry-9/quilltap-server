/**
 * `?download=1` on the three routes that serve image bytes.
 *
 * All three answer `inline` by default — the Salon embeds them in `<img>` —
 * and all three switch to `attachment` when asked, so the client can hand a
 * URL to `triggerUrlDownload` and let the Electron shell stream a 4K backdrop
 * to disk instead of buffering it into renderer memory.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => {
  const noop: Record<string, unknown> = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  noop.child = jest.fn(() => noop);
  return { logger: noop };
});

const mockDownloadFile = jest.fn();
jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { downloadFile: (...args: unknown[]) => mockDownloadFile(...args) },
}));

import {
  buildContentDisposition,
  wantsAttachment,
  dispositionFor,
} from '@/lib/api/content-disposition';
import { handleDownloadFile } from '@/app/api/v1/files/[id]/actions/download';
import { GET as blobsGet } from '@/app/api/v1/mount-points/[id]/blobs/[...path]/route';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories, getRepositoriesSafe } from '@/lib/repositories/factory';
import {
  createMockRepositoryContainer,
  setupAuthMocks,
} from '@/__tests__/unit/lib/fixtures/mock-repositories';
import type { RequestContext } from '@/lib/api/middleware';

const ASCII_NAME = 'a-backdrop.webp';
const NON_ASCII_NAME = 'Étude n° 3 — l’orangerie.webp';

function ctx(originalFilename: string): RequestContext {
  return {
    user: { id: 'user-1' },
    repos: {
      files: {
        findById: jest.fn().mockResolvedValue({
          id: 'file-1',
          originalFilename,
          mimeType: 'image/webp',
          storageKey: 'mount-blob:m:b',
        }),
      },
    },
  } as unknown as RequestContext;
}

function request(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/files/file-1${query}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDownloadFile.mockResolvedValue(Buffer.from([1, 2, 3]));
});

describe('wantsAttachment', () => {
  it('reads the flag in both spellings and defaults to off', () => {
    expect(wantsAttachment({ url: 'http://x/a?download=1' })).toBe(true);
    expect(wantsAttachment({ url: 'http://x/a?download=true' })).toBe(true);
    expect(wantsAttachment({ url: 'http://x/a?download=0' })).toBe(false);
    expect(wantsAttachment({ url: 'http://x/a' })).toBe(false);
    expect(wantsAttachment(undefined)).toBe(false);
    expect(wantsAttachment({ url: 'not a url' })).toBe(false);
  });

  it('names the disposition it implies', () => {
    expect(dispositionFor({ url: 'http://x/a?download=1' })).toBe('attachment');
    expect(dispositionFor({ url: 'http://x/a' })).toBe('inline');
  });
});

describe('buildContentDisposition', () => {
  it('carries an RFC 5987 filename* for a non-ASCII name in either mode', () => {
    const header = buildContentDisposition(NON_ASCII_NAME, 'attachment');
    expect(header.startsWith('attachment;')).toBe(true);
    expect(header).toContain("filename*=UTF-8''");
    // The apostrophe is the ext-value delimiter and must be escaped, or the
    // whole parameter is discarded and the mangled ASCII name wins.
    expect(header).not.toMatch(/filename\*=UTF-8''[^;]*[^%]'/);
    expect(buildContentDisposition(ASCII_NAME, 'attachment')).toBe(
      'attachment; filename="a-backdrop.webp"',
    );
  });
});

describe('GET /api/v1/files/[id]', () => {
  it('serves inline by default', async () => {
    const response = await handleDownloadFile(ctx(ASCII_NAME), 'file-1', request());
    expect(response.headers.get('Content-Disposition')).toBe(`inline; filename="${ASCII_NAME}"`);
  });

  it('serves an attachment for ?download=1', async () => {
    const response = await handleDownloadFile(ctx(ASCII_NAME), 'file-1', request('?download=1'));
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${ASCII_NAME}"`,
    );
  });

  it('gives a non-ASCII name an RFC 5987 filename* when downloaded', async () => {
    const response = await handleDownloadFile(ctx(NON_ASCII_NAME), 'file-1', request('?download=1'));
    const header = response.headers.get('Content-Disposition') ?? '';
    expect(header.startsWith('attachment;')).toBe(true);
    expect(header).toContain("filename*=UTF-8''");
  });

  it('leaves the cache and framing headers alone in either mode', async () => {
    for (const query of ['', '?download=1']) {
      const response = await handleDownloadFile(ctx(ASCII_NAME), 'file-1', request(query));
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
      expect(response.headers.get('Content-Type')).toBe('image/webp');
    }
  });

  it('still serves inline when no request is passed at all', async () => {
    const response = await handleDownloadFile(ctx(ASCII_NAME), 'file-1');
    expect(response.headers.get('Content-Disposition')).toContain('inline;');
  });
});

describe('GET /api/v1/mount-points/[id]/blobs/[...path]', () => {
  const mockRepos = createMockRepositoryContainer();

  function armBlob() {
    jest.mocked(getRepositories).mockReturnValue(mockRepos as never);
    jest.mocked(getRepositoriesSafe).mockResolvedValue(mockRepos as never);
    setupAuthMocks(jest.mocked(getServerSession) as jest.Mock, mockRepos);
    (mockRepos as unknown as Record<string, unknown>).docMountBlobs = {
      findByMountPointAndPath: jest.fn().mockResolvedValue({
        id: 'blob-1',
        storedMimeType: 'image/webp',
        sizeBytes: 3,
        sha256: 'sha-1',
        originalFileName: ASCII_NAME,
      }),
      readData: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
    };
  }

  async function fetchBlob(query: string): Promise<Response> {
    armBlob();
    return blobsGet(
      new NextRequest(`http://localhost:3000/api/v1/mount-points/m-1/blobs/photos/${ASCII_NAME}${query}`),
      { params: Promise.resolve({ id: 'm-1', path: ['photos', ASCII_NAME] }) } as never,
    );
  }

  it('serves inline by default and keeps its content hash header', async () => {
    const response = await fetchBlob('');
    expect(response.headers.get('Content-Disposition')).toBe(`inline; filename="${ASCII_NAME}"`);
    expect(response.headers.get('X-Blob-Sha256')).toBe('sha-1');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600');
  });

  it('serves an attachment for ?download=1, with the same other headers', async () => {
    const response = await fetchBlob('?download=1');
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${ASCII_NAME}"`,
    );
    expect(response.headers.get('X-Blob-Sha256')).toBe('sha-1');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600');
  });
});
