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
    uploadFile: jest.fn(),
  },
}));

jest.mock('@/lib/files/overwrite-utils', () => ({
  findAndPrepareOverwrite: jest.fn(),
}));

const fileStorageManagerMock = jest.requireMock('@/lib/file-storage/manager') as {
  fileStorageManager: {
    uploadFile: jest.Mock;
  };
};

const overwriteUtilsMock = jest.requireMock('@/lib/files/overwrite-utils') as {
  findAndPrepareOverwrite: jest.Mock;
};

describe('files collection POST handler', () => {
  let ctx: any;
  let handlePost: typeof import('@/app/api/v1/files/handlers/post').handlePost;

  beforeEach(() => {
    jest.clearAllMocks();
    fileStorageManagerMock.fileStorageManager.uploadFile.mockResolvedValue({
      storageKey: 'files/story.txt',
    });
    overwriteUtilsMock.findAndPrepareOverwrite.mockResolvedValue(null);

    ctx = {
      user: { id: 'user-1' },
      repos: {
        filePermissions: {
          canWriteFile: jest.fn().mockResolvedValue(true),
        },
        files: {
          create: jest.fn().mockResolvedValue({
            id: 'file-123',
            userId: 'user-1',
            originalFilename: 'story.txt',
            mimeType: 'text/plain',
            size: 11,
            category: 'DOCUMENT',
            projectId: null,
            folderPath: '/',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          }),
        },
      },
    };

    jest.isolateModules(() => {
      handlePost = require('@/app/api/v1/files/handlers/post').handlePost;
    });
  });

  it('dispatches the write action to the write handler', async () => {
    const url = 'https://localhost:3000/api/v1/files?action=write';
    const request = {
      url,
      nextUrl: new URL(url),
      json: async () => ({
        filename: 'story.txt',
        content: 'hello world',
      }),
    } as unknown as NextRequest;

    const response = await handlePost(request, ctx);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(ctx.repos.filePermissions.canWriteFile).toHaveBeenCalledWith('user-1', null, undefined);
    expect(ctx.repos.files.create).toHaveBeenCalled();
    expect(body.data.id).toBe('file-123');
  });

  it('returns a bad request for an unknown action', async () => {
    const url = 'https://localhost:3000/api/v1/files?action=bogus';
    const request = {
      url,
      nextUrl: new URL(url),
    } as unknown as NextRequest;

    const response = await handlePost(request, ctx);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Unknown action: bogus');
  });
});