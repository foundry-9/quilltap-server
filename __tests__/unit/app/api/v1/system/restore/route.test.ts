/**
 * Tests for the restore dispatcher (`POST /api/v1/system/restore`).
 *
 * The default action runs a full restore, so the one thing that must hold is
 * that an unknown `?action=` is refused rather than falling through to it.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler:
    (handler: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) =>
      handler(req, ctx),
}));

jest.mock('@/lib/backup/restore-service', () => ({
  restore: jest.fn(),
  previewRestore: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/v1/system/restore/route';
import { restore, previewRestore } from '@/lib/backup/restore-service';

const CTX = { user: { id: 'user-1' }, repos: {} } as never;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/v1/system/restore', () => {
  it('refuses an unknown action with 400 and never touches the restore service', async () => {
    const req = new NextRequest('http://localhost/api/v1/system/restore?action=wipe-everything', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });

    const res = (await POST(req, CTX)) as Response;

    expect(res.status).toBe(400);
    expect(restore).not.toHaveBeenCalled();
    expect(previewRestore).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toBe('Unknown action: wipe-everything');
    expect(body.availableActions).toEqual(['upload', 'preview']);
  });
});
