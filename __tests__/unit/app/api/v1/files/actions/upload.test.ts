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

import { handleUploadFile } from '@/app/api/v1/files/actions/upload';

describe('files upload action', () => {
  let ctx: any;

  beforeEach(() => {
    ctx = {
      user: { id: 'user-1' },
      repos: {
        filePermissions: {
          canWriteFile: jest.fn(),
        },
      },
    };
  });

  it('rejects uploads without write permission', async () => {
    ctx.repos.filePermissions.canWriteFile.mockResolvedValue(false);

    const mockFile = {
      name: 'notes.txt',
      type: 'text/plain',
      arrayBuffer: jest.fn(),
    } as unknown as File;

    const formData = {
      get: (key: string) => {
        if (key === 'file') {
          return mockFile;
        }
        if (key === 'projectId') {
          return 'project-1';
        }
        return null;
      },
    } as unknown as FormData;

    const request = {
      headers: {
        get: () => 'multipart/form-data; boundary=test',
      },
      formData: async () => formData,
    } as unknown as NextRequest;

    const response = await handleUploadFile(request, ctx);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('File write permission required. Please grant permission first.');
    expect(ctx.repos.filePermissions.canWriteFile).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      undefined
    );
    expect(mockFile.arrayBuffer).not.toHaveBeenCalled();
  });
});