import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { handleGet } from '@/app/api/v1/files/handlers/get';

describe('files collection GET handler', () => {
  let ctx: any;

  beforeEach(() => {
    ctx = {
      user: { id: 'user-1' },
      repos: {
        files: {
          findByUserId: jest.fn(),
        },
      },
    };
  });

  it('filters general files and sorts by createdAt descending', async () => {
    ctx.repos.files.findByUserId.mockResolvedValue([
      {
        id: 'file-1',
        userId: 'user-1',
        originalFilename: 'older.txt',
        mimeType: 'text/plain',
        size: 10,
        category: 'DOCUMENT',
        description: null,
        projectId: null,
        folderPath: '/',
        storageKey: 'files/older.txt',
        width: null,
        height: null,
        fileStatus: 'ok',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'file-2',
        userId: 'user-1',
        originalFilename: 'project.txt',
        mimeType: 'text/plain',
        size: 20,
        category: 'DOCUMENT',
        description: null,
        projectId: 'project-1',
        folderPath: '/',
        storageKey: 'files/project.txt',
        width: null,
        height: null,
        fileStatus: 'ok',
        createdAt: '2024-01-03T00:00:00.000Z',
        updatedAt: '2024-01-03T00:00:00.000Z',
      },
      {
        id: 'file-3',
        userId: 'user-1',
        originalFilename: 'newer.txt',
        mimeType: 'text/plain',
        size: 30,
        category: 'DOCUMENT',
        description: null,
        projectId: undefined,
        folderPath: '/',
        storageKey: 'files/newer.txt',
        width: null,
        height: null,
        fileStatus: 'ok',
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ]);

    const url = 'https://localhost:3000/api/v1/files?filter=general';
    const request = {
      nextUrl: new URL(url),
    } as unknown as NextRequest;

    const response = await handleGet(request, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.files.map((file: { id: string }) => file.id)).toEqual(['file-3', 'file-1']);
  });

  it('filters files by normalized folder path', async () => {
    ctx.repos.files.findByUserId.mockResolvedValue([
      {
        id: 'file-a',
        userId: 'user-1',
        originalFilename: 'draft.md',
        mimeType: 'text/markdown',
        size: 10,
        category: 'DOCUMENT',
        description: null,
        projectId: null,
        folderPath: '/notes',
        storageKey: 'files/notes/draft.md',
        width: null,
        height: null,
        fileStatus: 'ok',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'file-b',
        userId: 'user-1',
        originalFilename: 'image.png',
        mimeType: 'image/png',
        size: 10,
        category: 'DOCUMENT',
        description: null,
        projectId: null,
        folderPath: '/images',
        storageKey: 'files/images/image.png',
        width: null,
        height: null,
        fileStatus: 'ok',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]);

    const url = 'https://localhost:3000/api/v1/files?folderPath=notes';
    const request = {
      nextUrl: new URL(url),
    } as unknown as NextRequest;

    const response = await handleGet(request, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].id).toBe('file-a');
  });
});