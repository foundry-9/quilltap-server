import { syncMountPoint, SyncRefusedError } from '@/lib/mount-index/sync';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';
import type { SyncAction, SyncEntry, SyncOptions } from '@/lib/mount-index/sync/types';
import { StoreRaceError } from '@/lib/mount-index/sync/apply-store';

jest.mock('@/lib/repositories/factory');
jest.mock('@/lib/mount-index/character-vault', () => ({
  getArchivedCharacterVaultMountPointIds: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/mount-index/sync/apply-disk', () => ({
  applyDiskAction: jest.fn(),
  birthtimeIsSettable: jest.fn().mockReturnValue(true),
  ensureTargetDirectory: jest.fn(),
  readDiskFile: jest.fn(),
  targetExists: jest.fn(),
}));
jest.mock('@/lib/mount-index/sync/apply-store', () => {
  const actual = jest.requireActual('@/lib/mount-index/sync/apply-store');
  return { ...actual, applyStoreAction: jest.fn(), readStoreBytes: jest.fn() };
});
jest.mock('@/lib/mount-index/sync/manifest', () => ({
  baseFromManifest: jest.fn().mockReturnValue(new Map()),
  readManifest: jest.fn().mockResolvedValue(null),
  writeManifest: jest.fn(),
}));
jest.mock('@/lib/mount-index/sync/planner', () => ({ planSync: jest.fn() }));
jest.mock('@/lib/mount-index/sync/walk-disk', () => ({ walkDisk: jest.fn() }));
jest.mock('@/lib/mount-index/sync/walk-store', () => ({ walkStore: jest.fn() }));

const applyDisk = jest.requireMock('@/lib/mount-index/sync/apply-disk');
const applyStore = jest.requireMock('@/lib/mount-index/sync/apply-store');
const manifest = jest.requireMock('@/lib/mount-index/sync/manifest');
const planSync = jest.requireMock('@/lib/mount-index/sync/planner').planSync as jest.Mock;
const walkDisk = jest.requireMock('@/lib/mount-index/sync/walk-disk').walkDisk as jest.Mock;
const walkStore = jest.requireMock('@/lib/mount-index/sync/walk-store').walkStore as jest.Mock;
const archived = jest.requireMock('@/lib/mount-index/character-vault')
  .getArchivedCharacterVaultMountPointIds as jest.Mock;

const mp = (over: Partial<DocMountPoint> = {}): DocMountPoint =>
  ({
    id: 'mp-1', name: 'Lore', mountType: 'database', conversionStatus: 'idle',
    scanStatus: 'idle', storeType: 'documents', excludePatterns: ['*.log'], basePath: '',
    ...over,
  }) as DocMountPoint;

const opts = (over: Partial<SyncOptions> = {}): SyncOptions => ({
  targetPath: '/tmp/qt-sync-target',
  dryRun: false,
  direction: 'both',
  prefer: 'newer',
  propagateDeletes: true,
  useManifest: true,
  ...over,
});

const file = (relativePath: string, sha256: string, extra: Partial<SyncEntry> = {}): SyncEntry => ({
  relativePath, kind: 'file', sha256, lastModified: 'LM', createdAt: null, ...extra,
});

describe('syncMountPoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    archived.mockResolvedValue([]);
    applyDisk.birthtimeIsSettable.mockReturnValue(true);
    manifest.readManifest.mockResolvedValue(null);
    manifest.baseFromManifest.mockReturnValue(new Map());
    walkStore.mockResolvedValue({ entries: new Map(), warnings: [], reservedPaths: [] });
    walkDisk.mockResolvedValue({ entries: new Map(), warnings: [], orphanSidecars: [], unreadable: [] });
    planSync.mockReturnValue({ actions: [], warnings: [] });
  });

  describe('guards', () => {
    it.each([
      [{ mountType: 'filesystem' }, 'NOT_DATABASE_BACKED'],
      [{ conversionStatus: 'converting' }, 'CONVERSION_IN_PROGRESS'],
      [{ scanStatus: 'scanning' }, 'SCAN_IN_PROGRESS'],
    ])('refuses %j with %s', async (over, code) => {
      const err = await syncMountPoint(mp(over as Partial<DocMountPoint>), opts()).catch(e => e);
      expect(err).toBeInstanceOf(SyncRefusedError);
      expect(err.code).toBe(code);
      expect(walkStore).not.toHaveBeenCalled();
    });

    it('refuses an archived character vault but syncs a live one', async () => {
      archived.mockResolvedValue(['mp-1']);
      await expect(syncMountPoint(mp({ storeType: 'character' }), opts())).rejects.toMatchObject({
        code: 'CHARACTER_ARCHIVED',
      });

      archived.mockResolvedValue(['other']);
      await expect(syncMountPoint(mp({ storeType: 'character' }), opts())).resolves.toBeDefined();
      expect(planSync).toHaveBeenCalledWith(expect.objectContaining({ isCharacterVault: true }));
    });

    it('refuses a concurrent run on the same store, then frees the slot', async () => {
      let release!: () => void;
      applyDisk.ensureTargetDirectory.mockImplementationOnce(
        () => new Promise<void>(res => { release = res; })
      );
      const first = syncMountPoint(mp(), opts());
      await new Promise(r => setImmediate(r));

      await expect(syncMountPoint(mp(), opts())).rejects.toMatchObject({ code: 'SYNC_IN_PROGRESS' });
      release();
      await first;
      await expect(syncMountPoint(mp(), opts())).resolves.toBeDefined();
    });

    it('frees the slot when a run throws', async () => {
      walkStore.mockRejectedValueOnce(new Error('boom'));
      await expect(syncMountPoint(mp(), opts())).rejects.toThrow('boom');
      walkStore.mockResolvedValue({ entries: new Map(), warnings: [], reservedPaths: [] });
      await expect(syncMountPoint(mp(), opts())).resolves.toBeDefined();
    });
  });

  describe('dry run', () => {
    it('plans but applies nothing, creates no directory, writes no manifest', async () => {
      applyDisk.targetExists.mockResolvedValue(false);
      planSync.mockReturnValue({
        actions: [{ kind: 'create', side: 'disk', relativePath: 'a.md', entryKind: 'file', outcome: 'planned' }],
        warnings: ['plan warning'],
      });

      const report = await syncMountPoint(mp(), opts({ dryRun: true }));

      expect(applyDisk.ensureTargetDirectory).not.toHaveBeenCalled();
      expect(applyDisk.applyDiskAction).not.toHaveBeenCalled();
      expect(applyStore.applyStoreAction).not.toHaveBeenCalled();
      expect(manifest.writeManifest).not.toHaveBeenCalled();
      expect(report.dryRun).toBe(true);
      expect(report.warnings).toEqual([
        expect.stringMatching(/does not exist yet; a real run would create it/),
        'plan warning',
      ]);
      expect(report.summary.created).toBe(1);
    });

    it('is quiet about an existing target', async () => {
      applyDisk.targetExists.mockResolvedValue(true);
      const report = await syncMountPoint(mp(), opts({ dryRun: true }));
      expect(report.warnings).toEqual([]);
    });
  });

  describe('real run', () => {
    it('applies store->disk and disk->store actions, reading bytes from the correct side', async () => {
      const toDisk: SyncAction = { kind: 'create', side: 'disk', relativePath: 'a.md', entryKind: 'file' };
      const toStore: SyncAction = { kind: 'modify', side: 'store', relativePath: 'b.md', entryKind: 'file', expectedStoreSha256: 's' };
      const touch: SyncAction = { kind: 'touch', side: 'store', relativePath: 'c.md', entryKind: 'file', linkId: 'l' };
      planSync.mockReturnValue({ actions: [toDisk, toStore, touch], warnings: [] });
      const fromStore = Buffer.from('from-store');
      const fromDisk = Buffer.from('from-disk');
      applyStore.readStoreBytes.mockResolvedValue(fromStore);
      applyDisk.readDiskFile.mockResolvedValue(fromDisk);

      const report = await syncMountPoint(mp(), opts());

      expect(applyDisk.ensureTargetDirectory).toHaveBeenCalledWith('/tmp/qt-sync-target');
      expect(applyStore.readStoreBytes).toHaveBeenCalledWith('mp-1', 'a.md');
      expect(applyDisk.applyDiskAction).toHaveBeenCalledWith('/tmp/qt-sync-target', toDisk, fromStore);
      expect(applyDisk.readDiskFile).toHaveBeenCalledWith('/tmp/qt-sync-target', 'b.md');
      expect(applyStore.applyStoreAction).toHaveBeenCalledWith('mp-1', toStore, fromDisk);
      expect(applyStore.applyStoreAction).toHaveBeenCalledWith('mp-1', touch, null);
      expect([toDisk, toStore, touch].map(a => a.outcome)).toEqual(['applied', 'applied', 'applied']);
      expect(report.summary).toMatchObject({ created: 1, modified: 1, touched: 1, failed: 0 });
      expect(walkDisk).toHaveBeenCalledWith('/tmp/qt-sync-target', ['*.log']);
    });

    it('does not apply conflicts/skips, and surfaces reserved store paths as skipped conflicts', async () => {
      walkStore.mockResolvedValue({ entries: new Map(), warnings: ['sw'], reservedPaths: ['p.png.description.md'] });
      walkDisk.mockResolvedValue({ entries: new Map(), warnings: ['dw'], orphanSidecars: [], unreadable: [] });
      const conflict: SyncAction = { kind: 'conflict', side: null, relativePath: 'x.md', entryKind: 'file' };
      planSync.mockReturnValue({ actions: [conflict], warnings: ['pw'] });

      const report = await syncMountPoint(mp(), opts());

      expect(report.actions[0]).toMatchObject({
        kind: 'conflict', side: null, relativePath: 'p.png.description.md', outcome: 'skipped',
      });
      expect(report.actions[1]).toBe(conflict);
      expect(applyStore.applyStoreAction).not.toHaveBeenCalled();
      expect(applyDisk.applyDiskAction).not.toHaveBeenCalled();
      expect(report.summary.conflicts).toBe(2);
      expect(report.warnings).toEqual(['sw', 'dw', 'pw']);
    });

    it('records a store race as a failed action, keeps going, and counts it', async () => {
      const racy: SyncAction = { kind: 'modify', side: 'store', relativePath: 'r.md', entryKind: 'file', expectedStoreSha256: 'old' };
      const fine: SyncAction = { kind: 'create', side: 'store', relativePath: 'ok.md', entryKind: 'file' };
      planSync.mockReturnValue({ actions: [racy, fine], warnings: [] });
      applyDisk.readDiskFile.mockResolvedValue(Buffer.from('x'));
      applyStore.applyStoreAction
        .mockRejectedValueOnce(new StoreRaceError('r.md', 'old', 'new'))
        .mockResolvedValueOnce(undefined);

      const report = await syncMountPoint(mp(), opts());

      expect(racy.outcome).toBe('failed');
      expect(racy.error).toMatch(/r\.md changed in the store/);
      expect(fine.outcome).toBe('applied');
      expect(report.summary.failed).toBe(1);
      expect(report.summary.created).toBe(1);
      expect(report.summary.modified).toBe(0);
      expect(report.warnings).toEqual([expect.stringMatching(/^modify store r\.md: r\.md changed in the store/)]);
    });

    it('fails a store->disk copy whose store bytes have vanished', async () => {
      const a: SyncAction = { kind: 'create', side: 'disk', relativePath: 'gone.md', entryKind: 'file' };
      planSync.mockReturnValue({ actions: [a], warnings: [] });
      applyStore.readStoreBytes.mockResolvedValue(null);

      await syncMountPoint(mp(), opts());

      expect(a.outcome).toBe('failed');
      expect(a.error).toBe('The store has no content at gone.md');
      expect(applyDisk.applyDiskAction).not.toHaveBeenCalled();
    });

    it('fails an action when reading the disk throws a non-Error', async () => {
      const a: SyncAction = { kind: 'create', side: 'store', relativePath: 'a.md', entryKind: 'file' };
      planSync.mockReturnValue({ actions: [a], warnings: [] });
      applyDisk.readDiskFile.mockRejectedValue('nope');
      await syncMountPoint(mp(), opts());
      expect(a.error).toBe('nope');
    });

    it('warns when creation dates cannot be set on disk', async () => {
      applyDisk.birthtimeIsSettable.mockReturnValue(false);
      planSync.mockReturnValue({
        actions: [{ kind: 'touch', side: 'disk', relativePath: 'a.md', entryKind: 'file', createdAt: '2020-01-01T00:00:00.000Z' }],
        warnings: [],
      });
      const report = await syncMountPoint(mp(), opts());
      expect(report.warnings.some(w => w.includes('Creation dates are not settable'))).toBe(true);
    });
  });

  describe('manifest', () => {
    it('is neither read nor written when useManifest is false', async () => {
      await syncMountPoint(mp(), opts({ useManifest: false }));
      expect(manifest.readManifest).not.toHaveBeenCalled();
      expect(manifest.writeManifest).not.toHaveBeenCalled();
      expect(manifest.baseFromManifest).toHaveBeenCalledWith(null);
    });

    it('records only entries both sides agree on, re-walking after the apply', async () => {
      const store = new Map<string, SyncEntry>([
        ['same.md', file('Same.md', 'h1', { description: '' })],
        ['differs.md', file('differs.md', 'h2')],
        ['storeonly.md', file('storeonly.md', 'h3')],
        ['dir', { relativePath: 'dir', kind: 'folder', lastModified: 'LM', createdAt: 'CA' }],
        ['pic.png', file('pic.png', 'h4', { description: 'cap', descriptionUpdatedAt: 'DU' })],
      ]);
      const disk = new Map<string, SyncEntry>([
        ['same.md', file('Same.md', 'h1')],
        ['differs.md', file('differs.md', 'XX')],
        ['dir', { relativePath: 'dir', kind: 'folder', lastModified: 'LM', createdAt: null }],
        ['pic.png', file('pic.png', 'h4')],
        ['diskonly.md', file('diskonly.md', 'h5')],
      ]);
      walkStore.mockResolvedValue({ entries: store, warnings: [], reservedPaths: [] });
      walkDisk.mockResolvedValue({ entries: disk, warnings: [], orphanSidecars: [], unreadable: [] });

      await syncMountPoint(mp(), opts());

      // once for planning, once for the manifest
      expect(walkStore).toHaveBeenCalledTimes(2);
      expect(walkDisk).toHaveBeenCalledTimes(2);
      expect(manifest.readManifest).toHaveBeenCalledWith('/tmp/qt-sync-target', 'mp-1', expect.any(Array));

      const [target, written] = manifest.writeManifest.mock.calls[0];
      expect(target).toBe('/tmp/qt-sync-target');
      expect(written).toMatchObject({ version: 1, storeId: 'mp-1', storeName: 'Lore' });
      expect(Object.keys(written.entries).sort()).toEqual(['Same.md', 'dir', 'pic.png']);
      expect(written.entries['dir']).toEqual({ kind: 'folder', createdAt: 'CA' });
      expect(written.entries['Same.md']).toEqual({
        kind: 'file', sha256: 'h1', lastModified: 'LM', createdAt: null,
      });
      expect(written.entries['pic.png']).toMatchObject({
        kind: 'file',
        descriptionSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        descriptionUpdatedAt: 'DU',
      });
    });
  });

  describe('summary', () => {
    it('buckets every action kind', async () => {
      const mk = (kind: SyncAction['kind'], side: SyncAction['side'] = null): SyncAction =>
        ({ kind, side, relativePath: kind, entryKind: 'file' });
      planSync.mockReturnValue({
        actions: [mk('mkdir', 'disk'), mk('rmdir', 'disk'), mk('delete', 'disk'), mk('describe', 'store'), mk('skip')],
        warnings: [],
      });
      const report = await syncMountPoint(mp(), opts({ dryRun: true }));
      expect(report.summary).toEqual({
        created: 1, modified: 0, deleted: 2, touched: 0, described: 1, conflicts: 0, skipped: 1, failed: 0,
      });
    });
  });
});
