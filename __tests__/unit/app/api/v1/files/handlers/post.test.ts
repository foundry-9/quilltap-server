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

describe('files collection POST handler', () => {
  let ctx: any;
  let handlePost: typeof import('@/app/api/v1/files/handlers/post').handlePost;

  beforeEach(() => {
    jest.clearAllMocks();

    ctx = {
      user: { id: 'user-1' },
      repos: {},
    };

    jest.isolateModules(() => {
      handlePost = require('@/app/api/v1/files/handlers/post').handlePost;
    });
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
