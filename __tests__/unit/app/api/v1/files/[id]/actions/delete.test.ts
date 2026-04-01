import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(function () {
      return this;
    }),
  },
}));

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: {
    deleteFile: jest.fn(),
  },
}));

jest.mock('@/lib/files/get-file-associations', () => ({
  getFileAssociations: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
}));

describe('files item delete action', () => {
  let handleDeleteFile: typeof import('@/app/api/v1/files/[id]/actions/delete').handleDeleteFile;
  let ctx: any;

  beforeEach(() => {
    jest.clearAllMocks();

    ctx = {
      user: { id: 'user-1' },
      repos: {
        files: {
          findById: jest.fn().mockResolvedValue({
            id: 'file-1',
            userId: 'other-user',
            mimeType: 'text/plain',
            linkedTo: [],
            storageKey: null,
          }),
        },
      },
    };

    jest.isolateModules(() => {
      handleDeleteFile = require('@/app/api/v1/files/[id]/actions/delete').handleDeleteFile;
    });
  });

  it('forbids deletion of files owned by another user', async () => {
    const url = 'https://localhost:3000/api/v1/files/file-1';
    const request = {
      nextUrl: new URL(url),
    } as unknown as NextRequest;

    const response = await handleDeleteFile(request, ctx, 'file-1');
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });
});