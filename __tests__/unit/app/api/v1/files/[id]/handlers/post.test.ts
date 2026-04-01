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

describe('files item POST handler', () => {
  let handlePost: typeof import('@/app/api/v1/files/[id]/handlers/post').handlePost;
  let ctx: any;

  beforeEach(() => {
    jest.clearAllMocks();

    ctx = {
      user: { id: 'user-1' },
      repos: {
        files: {
          findById: jest.fn().mockResolvedValue({
            id: 'file-1',
            userId: 'user-1',
            originalFilename: 'story.txt',
            folderPath: '/',
            projectId: null,
          }),
        },
      },
    };

    jest.isolateModules(() => {
      handlePost = require('@/app/api/v1/files/[id]/handlers/post').handlePost;
    });
  });

  it('returns bad request for unknown actions', async () => {
    const url = 'https://localhost:3000/api/v1/files/file-1?action=bogus';
    const request = {
      url,
      nextUrl: new URL(url),
    } as unknown as NextRequest;

    const response = await handlePost(request, ctx, 'file-1');
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Unknown action: bogus');
  });

  it('returns not found when the file is not owned by the user', async () => {
    ctx.repos.files.findById.mockResolvedValue({
      id: 'file-1',
      userId: 'other-user',
    });

    const url = 'https://localhost:3000/api/v1/files/file-1?action=move';
    const request = {
      url,
      nextUrl: new URL(url),
    } as unknown as NextRequest;

    const response = await handlePost(request, ctx, 'file-1');
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('File not found');
  });
});