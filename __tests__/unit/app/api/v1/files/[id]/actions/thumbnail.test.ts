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

describe('files item thumbnail action', () => {
  let handleGetThumbnail: typeof import('@/app/api/v1/files/[id]/actions/thumbnail').handleGetThumbnail;
  let ctx: any;

  beforeEach(() => {
    jest.clearAllMocks();

    ctx = {
      repos: {
        files: {
          findById: jest.fn(),
        },
      },
    };

    jest.isolateModules(() => {
      handleGetThumbnail = require('@/app/api/v1/files/[id]/actions/thumbnail').handleGetThumbnail;
    });
  });

  it('rejects invalid size parameters', async () => {
    const url = 'https://localhost:3000/api/v1/files/file-1?action=thumbnail&size=0';
    const request = {
      nextUrl: new URL(url),
    } as unknown as NextRequest;

    const response = await handleGetThumbnail(request, ctx, 'file-1');
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid size parameter');
    expect(ctx.repos.files.findById).not.toHaveBeenCalled();
  });
});