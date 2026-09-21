/**
 * `POST /api/v1/mount-points/[id]?action=sync` — the route's own job.
 *
 * The engine is tested end to end elsewhere; what this covers is the boundary:
 * the body schema (which is the single source of truth for the CLI's flags,
 * since the CLI does not re-validate), the store lookup, and the mapping from
 * the engine's refusals onto HTTP status codes — a refusal the operator can
 * act on must not arrive as a 500.
 *
 * Guards:
 *   - app/api/v1/mount-points/[id]/route.ts (handleSync)
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

// The mock functions are minted inside the factories — a `const` at module
// scope would be read before the hoisted factories run.
jest.mock('@/lib/api/middleware', () => {
  const findById = jest.fn();
  return {
    __findById: findById,
    createContextParamsHandler:
      (handler: (req: any, ctx: any, params: any) => Promise<any>) =>
      async (req: any, params: any) =>
        handler(req, { user: { id: 'user-1' }, repos: { docMountPoints: { findById } } }, params),
  };
});

jest.mock('@/lib/api/middleware/actions', () => ({
  withActionDispatch:
    (handlers: Record<string, (req: any, ctx: any, params: any) => Promise<any>>) =>
    async (req: any, ctx: any, params: any) => {
      const action = new URL(req.url).searchParams.get('action') ?? '';
      return handlers[action](req, ctx, params);
    },
}));

// The route module reaches the filesystem watcher (and chokidar, an ESM
// package) on the way in; none of it is on the sync path.
jest.mock('@/lib/mount-index/watcher', () => ({
  detachMountPoint: jest.fn(),
  refreshMountPoint: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/mount-index/sync', () => {
  class SyncRefusedError extends Error {
    constructor(message: string, public code: string) {
      super(message);
      this.name = 'SyncRefusedError';
    }
  }
  return { syncMountPoint: jest.fn(), SyncRefusedError };
});

import { POST } from '@/app/api/v1/mount-points/[id]/route';
import { SyncRefusedError } from '@/lib/mount-index/sync';
import { ManifestMismatchError } from '@/lib/mount-index/sync/manifest';

const findByIdMock = jest.requireMock('@/lib/api/middleware').__findById as jest.Mock;
const syncMountPointMock = jest.requireMock('@/lib/mount-index/sync').syncMountPoint as jest.Mock;

const STORE = {
  id: 'store-1',
  name: 'Lore',
  mountType: 'database',
  storeType: 'documents',
  conversionStatus: 'idle',
  scanStatus: 'idle',
};

const REPORT = {
  storeId: 'store-1', storeName: 'Lore', targetPath: '/tmp/lore',
  dryRun: false, actions: [], warnings: [], elapsedMs: 4,
  summary: { created: 0, modified: 0, deleted: 0, touched: 0, described: 0, conflicts: 0, skipped: 0, failed: 0 },
};

function req(body: unknown) {
  return {
    url: 'http://localhost/api/v1/mount-points/store-1?action=sync',
    json: async () => body,
  } as never;
}

const params = Promise.resolve({ id: 'store-1' }) as never;

beforeEach(() => {
  findByIdMock.mockReset().mockResolvedValue(STORE);
  syncMountPointMock.mockReset().mockResolvedValue(REPORT);
});

describe('the body schema', () => {
  it('accepts a bare targetPath and fills in every default', async () => {
    const res = await POST(req({ targetPath: '/tmp/lore' }), params);
    expect(res.status).toBe(200);
    expect(syncMountPointMock).toHaveBeenCalledWith(STORE, {
      targetPath: '/tmp/lore',
      dryRun: false,
      direction: 'both',
      prefer: 'newer',
      propagateDeletes: true,
      useManifest: true,
    });
  });

  it('threads every flag through verbatim', async () => {
    await POST(req({
      targetPath: '/tmp/lore', dryRun: true, direction: 'to-store',
      prefer: 'disk', propagateDeletes: false, useManifest: false,
    }), params);
    expect(syncMountPointMock).toHaveBeenCalledWith(STORE, expect.objectContaining({
      dryRun: true, direction: 'to-store', prefer: 'disk',
      propagateDeletes: false, useManifest: false,
    }));
  });

  it('refuses a missing targetPath', async () => {
    const res = await POST(req({}), params);
    expect(res.status).toBe(400);
    expect(syncMountPointMock).not.toHaveBeenCalled();
  });

  it('refuses an empty targetPath', async () => {
    expect((await POST(req({ targetPath: '' }), params)).status).toBe(400);
  });

  it('refuses a direction it does not know', async () => {
    const res = await POST(req({ targetPath: '/tmp/lore', direction: 'sideways' }), params);
    expect(res.status).toBe(400);
  });

  it('refuses a prefer it does not know', async () => {
    const res = await POST(req({ targetPath: '/tmp/lore', prefer: 'whichever' }), params);
    expect(res.status).toBe(400);
  });

  it('names the offending field so the operator can fix it', async () => {
    const res = await POST(req({ targetPath: '/tmp/lore', prefer: 'whichever' }), params);
    expect((await res.json()).error).toContain('prefer');
  });
});

describe('the store', () => {
  it('404s on a store that is not there', async () => {
    findByIdMock.mockResolvedValue(null);
    expect((await POST(req({ targetPath: '/tmp/lore' }), params)).status).toBe(404);
  });

  it('returns the engine’s report as the response body', async () => {
    const res = await POST(req({ targetPath: '/tmp/lore' }), params);
    expect(await res.json()).toEqual(REPORT);
  });
});

describe('refusals reach the operator as something they can act on', () => {
  it('400s a store of the wrong kind', async () => {
    syncMountPointMock.mockRejectedValue(
      new SyncRefusedError('"Lore" is a filesystem store', 'NOT_DATABASE_BACKED')
    );
    const res = await POST(req({ targetPath: '/tmp/lore' }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('filesystem store');
  });

  it('400s an archived character’s vault', async () => {
    syncMountPointMock.mockRejectedValue(
      new SyncRefusedError('archived', 'CHARACTER_ARCHIVED')
    );
    expect((await POST(req({ targetPath: '/tmp/lore' }), params)).status).toBe(400);
  });

  it('409s a run that collides with another one', async () => {
    syncMountPointMock.mockRejectedValue(
      new SyncRefusedError('already running', 'SYNC_IN_PROGRESS')
    );
    expect((await POST(req({ targetPath: '/tmp/lore' }), params)).status).toBe(409);
  });

  it('409s while a conversion or a scan holds the store', async () => {
    syncMountPointMock.mockRejectedValue(
      new SyncRefusedError('converting', 'CONVERSION_IN_PROGRESS')
    );
    expect((await POST(req({ targetPath: '/tmp/lore' }), params)).status).toBe(409);
    syncMountPointMock.mockRejectedValue(
      new SyncRefusedError('scanning', 'SCAN_IN_PROGRESS')
    );
    expect((await POST(req({ targetPath: '/tmp/lore' }), params)).status).toBe(409);
  });

  it('409s a manifest belonging to another store', async () => {
    syncMountPointMock.mockRejectedValue(new ManifestMismatchError('other', 'store-1'));
    expect((await POST(req({ targetPath: '/tmp/lore' }), params)).status).toBe(409);
  });

  it('explains that the path is the server’s when it does not exist there', async () => {
    const err = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    syncMountPointMock.mockRejectedValue(err);
    const res = await POST(req({ targetPath: '/host/only' }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('docker-mounts');
  });

  it('500s anything genuinely unexpected', async () => {
    syncMountPointMock.mockRejectedValue(new Error('the disk caught fire'));
    expect((await POST(req({ targetPath: '/tmp/lore' }), params)).status).toBe(500);
  });
});
