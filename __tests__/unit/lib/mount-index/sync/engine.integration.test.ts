/**
 * @jest-environment node
 *
 * `syncMountPoint` end to end: a real database-backed store (real SQLite, real
 * repositories, the real write chokepoints) and a real directory in a temp dir.
 *
 * The properties worth holding onto are the ones a planner test cannot reach:
 *
 *   - **A second run is a no-op.** This is the whole contract. If the appliers
 *     and the walks disagree about a single timestamp or a single trailing
 *     newline, the sync oscillates forever and nobody notices until it has
 *     been running nightly for a month.
 *   - **Bytes are preserved.** A `.png` pushed from disk stays a `.png` with
 *     the same sha — not the WebP a Scriptorium upload would make of it.
 *   - **The caption survives a byte update** (bug 155), and the chunks are
 *     touched only by the store's own reindex hook, never by the sync.
 *
 * Guards:
 *   - lib/mount-index/sync/index.ts, apply-store.ts, apply-disk.ts,
 *     walk-store.ts, walk-disk.ts
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

function loadDriver(): any {
  try {
    return require(path.join(
      __dirname, '..', '..', '..', '..', '..',
      'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers'
    ));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      return require(path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}
const Database = loadDriver();

jest.mock('@/lib/repositories/factory');
jest.mock('@/lib/mount-index/db-store-events', () => ({
  emitDocumentWritten: jest.fn(),
  emitDocumentDeleted: jest.fn(),
  emitDocumentMoved: jest.fn(),
}));
jest.mock('@/lib/doc-edit/reindex-file', () => ({
  reindexSingleFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/mount-index/link-groups', () => ({
  reindexLinkGroupSiblings: jest.fn().mockResolvedValue(0),
}));
jest.mock('@/lib/mount-index/character-vault', () => ({
  getArchivedCharacterVaultMountPointIds: jest.fn().mockResolvedValue([]),
}));

import { logger } from '@/lib/logger';
import { DocMountFileLinksRepository } from '@/lib/database/repositories/doc-mount-file-links.repository';
import { DocMountFilesRepository } from '@/lib/database/repositories/doc-mount-files.repository';
import { DocMountFoldersRepository } from '@/lib/database/repositories/doc-mount-folders.repository';
import { DocMountDocumentsRepository } from '@/lib/database/repositories/doc-mount-documents.repository';
import { DocMountBlobsRepository } from '@/lib/database/repositories/doc-mount-blobs.repository';
import { DocMountChunksRepository } from '@/lib/database/repositories/doc-mount-chunks.repository';
import { syncMountPoint, SyncRefusedError } from '@/lib/mount-index/sync';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';
import type { SyncAction, SyncOptions } from '@/lib/mount-index/sync/types';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const reindexSingleFileMock = jest.requireMock('@/lib/doc-edit/reindex-file').reindexSingleFile as jest.Mock;
const archivedMock = jest.requireMock('@/lib/mount-index/character-vault')
  .getArchivedCharacterVaultMountPointIds as jest.Mock;

const MOUNT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PNG = Buffer.from('\x89PNG\r\n\x1a\n and then some bytes that are not really a PNG');

let db: any;
let dir: string;
let links: DocMountFileLinksRepository;

function store(over: Partial<DocMountPoint> = {}): DocMountPoint {
  return {
    id: MOUNT_ID,
    name: 'Lore',
    basePath: '',
    mountType: 'database',
    storeType: 'documents',
    includePatterns: [],
    excludePatterns: ['node_modules'],
    enabled: true,
    scanStatus: 'idle',
    conversionStatus: 'idle',
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as DocMountPoint;
}

function options(over: Partial<SyncOptions> = {}): SyncOptions {
  return {
    targetPath: dir,
    dryRun: false,
    direction: 'both',
    prefer: 'newer',
    propagateDeletes: true,
    useManifest: true,
    ...over,
  };
}

const shaOf = (b: Buffer | string) =>
  createHash('sha256').update(typeof b === 'string' ? Buffer.from(b, 'utf-8') : b).digest('hex');

async function seedDoc(relativePath: string, content: string) {
  const { link } = await links.linkDocumentContent({
    mountPointId: MOUNT_ID,
    relativePath,
    fileName: path.posix.basename(relativePath),
    folderId: null,
    fileType: 'markdown',
    content,
    contentSha256: shaOf(content),
    plainTextLength: content.length,
    fileSizeBytes: Buffer.byteLength(content, 'utf-8'),
  });
  return link;
}

async function seedBlob(relativePath: string, data: Buffer, description?: string) {
  const { link } = await links.linkBlobContent({
    mountPointId: MOUNT_ID,
    relativePath,
    fileName: path.posix.basename(relativePath),
    folderId: null,
    fileType: 'blob',
    originalFileName: path.posix.basename(relativePath),
    originalMimeType: 'image/png',
    storedMimeType: 'image/png',
    sha256: shaOf(data),
    data,
    ...(description !== undefined ? { description } : {}),
  });
  return link;
}

/** `kind side path` for each action. */
function shape(actions: SyncAction[]): string[] {
  return actions.map(a => `${a.kind} ${a.side ?? '—'} ${a.relativePath}`);
}

async function readDisk(relativePath: string): Promise<string> {
  return fs.readFile(path.join(dir, relativePath), 'utf-8');
}

async function writeDisk(relativePath: string, body: string | Buffer) {
  const absolute = path.join(dir, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, body);
}

async function exists(relativePath: string): Promise<boolean> {
  return fs.stat(path.join(dir, relativePath)).then(() => true, () => false);
}

beforeEach(async () => {
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});
  jest.spyOn(logger, 'info').mockImplementation(() => {});
  reindexSingleFileMock.mockClear();
  archivedMock.mockResolvedValue([]);

  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = db;
  (globalThis as Record<string, unknown>).__quilltapMountIndexDegraded = false;

  links = new DocMountFileLinksRepository();
  const repos = {
    docMountFileLinks: links,
    docMountFiles: new DocMountFilesRepository(),
    docMountFolders: new DocMountFoldersRepository(),
    docMountDocuments: new DocMountDocumentsRepository(),
    docMountBlobs: new DocMountBlobsRepository(),
    docMountChunks: new DocMountChunksRepository(),
  };
  getRepositoriesMock.mockReturnValue(repos);

  // Mint the tables.
  await repos.docMountFiles.findBySha256('seed');
  await repos.docMountFolders.findByMountPointId('seed');
  await repos.docMountDocuments.findByFileId('seed');
  await repos.docMountBlobs.findByFileId('seed');
  await repos.docMountChunks.findByLinkId('seed');

  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quilltap-sync-engine-'));
});

afterEach(async () => {
  jest.restoreAllMocks();
  try { db.close(); } catch { /* ignore */ }
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = undefined;
  await fs.rm(dir, { recursive: true, force: true });
});

// ===========================================================================

describe('the first run materialises the store', () => {
  it('writes files, folders and sidecars, then reports what it did', async () => {
    await seedDoc('chapters/01.md', '# One\nThe first chapter.');
    await seedBlob('lore/harbour.png', PNG, 'A map of the harbour at dusk.');

    const report = await syncMountPoint(store(), options());

    expect(await readDisk('chapters/01.md')).toBe('# One\nThe first chapter.');
    expect(await fs.readFile(path.join(dir, 'lore/harbour.png'))).toEqual(PNG);
    expect((await readDisk('lore/harbour.png.description.md')).trim())
      .toBe('A map of the harbour at dusk.');
    expect(report.summary.created).toBeGreaterThanOrEqual(2);
    expect(report.summary.conflicts).toBe(0);
    expect(report.actions.every(a => a.outcome !== 'failed')).toBe(true);
  });

  it('carries the store’s mtime onto the file it writes', async () => {
    const link = await seedDoc('ch.md', 'body');
    await links.setLinkTimestamps(link.id, { lastModified: '2026-09-19T14:02:11.000Z' });

    await syncMountPoint(store(), options());

    const stat = await fs.stat(path.join(dir, 'ch.md'));
    expect(stat.mtime.toISOString()).toBe('2026-09-19T14:02:11.000Z');
  });

  it('creates an empty folder as a real directory', async () => {
    const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');
    await ensureFolderPath(MOUNT_ID, 'lore/maps');

    await syncMountPoint(store(), options());

    expect((await fs.stat(path.join(dir, 'lore/maps'))).isDirectory()).toBe(true);
  });

  it('creates the target directory when it is not there yet', async () => {
    await seedDoc('ch.md', 'body');
    const nested = path.join(dir, 'deeper', 'still');

    await syncMountPoint(store(), options({ targetPath: nested }));

    expect(await fs.readFile(path.join(nested, 'ch.md'), 'utf-8')).toBe('body');
  });

  it('changes nothing under --dry-run, and writes no manifest', async () => {
    await seedDoc('ch.md', 'body');

    const report = await syncMountPoint(store(), options({ dryRun: true }));

    expect(report.actions.length).toBeGreaterThan(0);
    expect(await exists('ch.md')).toBe(false);
    expect(await exists('.quilltap-sync.json')).toBe(false);
  });

  it('does not even conjure the target directory under --dry-run', async () => {
    // An operator planning a sync against a path they mistyped should be left
    // with the mistyped path absent, not with an empty folder to clean up.
    await seedDoc('ch.md', 'body');
    const missing = path.join(dir, 'not-yet');

    const report = await syncMountPoint(store(), options({ targetPath: missing, dryRun: true }));

    await expect(fs.stat(missing)).rejects.toThrow();
    expect(shape(report.actions)).toEqual(['create disk ch.md']);
    expect(report.warnings.join(' ')).toContain('a real run would create it');
  });
});

describe('the second run has nothing to do', () => {
  it('converges after one pass over text, a binary, a caption and a folder', async () => {
    const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');
    await seedDoc('chapters/01.md', '# One\nThe first chapter.');
    await seedDoc('chapters/02.md', '# Two');
    await seedBlob('lore/harbour.png', PNG, 'A map of the harbour at dusk.');
    await ensureFolderPath(MOUNT_ID, 'empty/shelf');

    await syncMountPoint(store(), options());
    const second = await syncMountPoint(store(), options());

    expect(shape(second.actions)).toEqual([]);
    expect(second.summary).toMatchObject({ created: 0, modified: 0, deleted: 0, touched: 0 });
  });

  it('converges over a file pushed the other way too', async () => {
    await writeDisk('notes/idea.md', 'An idea.\n');

    await syncMountPoint(store(), options());
    const second = await syncMountPoint(store(), options());

    expect(shape(second.actions)).toEqual([]);
  });

  it('settles again after an edit on each side, and stays settled', async () => {
    await seedDoc('from-store.md', 'one');
    await writeDisk('from-disk.md', 'two');
    await syncMountPoint(store(), options());

    await seedDoc('from-store.md', 'one, revised');
    await writeDisk('from-disk.md', 'two, revised');
    const second = await syncMountPoint(store(), options());
    expect(second.summary.modified).toBe(2);

    // Two more passes: the first proves the appliers and the walks agree, the
    // second proves nothing about that agreement decays.
    expect(shape(await syncMountPoint(store(), options()).then(r => r.actions))).toEqual([]);
    expect(shape(await syncMountPoint(store(), options()).then(r => r.actions))).toEqual([]);
  });

  it('settles after a caption edit', async () => {
    await seedBlob('harbour.png', PNG, 'the first caption');
    await syncMountPoint(store(), options());

    await writeDisk('harbour.png.description.md', 'a better caption\n');
    await syncMountPoint(store(), options());

    expect(shape(await syncMountPoint(store(), options()).then(r => r.actions))).toEqual([]);
  });
});

describe('edits converge in both directions', () => {
  it('pulls a disk edit into the store', async () => {
    await seedDoc('ch.md', 'the original');
    await syncMountPoint(store(), options());

    await writeDisk('ch.md', 'edited on disk');
    await fs.utimes(path.join(dir, 'ch.md'), new Date(), new Date());

    const report = await syncMountPoint(store(), options());

    expect(shape(report.actions)).toEqual(['modify store ch.md']);
    const link = await links.findByMountPointAndPath(MOUNT_ID, 'ch.md');
    expect(link?.sha256).toBe(shaOf('edited on disk'));
  });

  it('pushes a store edit out to disk', async () => {
    await seedDoc('ch.md', 'the original');
    await syncMountPoint(store(), options());

    await seedDoc('ch.md', 'edited in the store');

    const report = await syncMountPoint(store(), options());

    expect(shape(report.actions)).toEqual(['modify disk ch.md']);
    expect(await readDisk('ch.md')).toBe('edited in the store');
  });

  it('refuses when both sides were edited, and changes nothing', async () => {
    await seedDoc('ch.md', 'the original');
    await syncMountPoint(store(), options());

    await seedDoc('ch.md', 'edited in the store');
    await writeDisk('ch.md', 'edited on disk');

    const report = await syncMountPoint(store(), options());

    expect(report.actions[0].kind).toBe('conflict');
    expect(report.summary.conflicts).toBe(1);
    expect(await readDisk('ch.md')).toBe('edited on disk');
    const link = await links.findByMountPointAndPath(MOUNT_ID, 'ch.md');
    expect(link?.sha256).toBe(shaOf('edited in the store'));
  });

  it('--prefer disk resolves that conflict', async () => {
    await seedDoc('ch.md', 'the original');
    await syncMountPoint(store(), options());
    await seedDoc('ch.md', 'edited in the store');
    await writeDisk('ch.md', 'edited on disk');

    const report = await syncMountPoint(store(), options({ prefer: 'disk' }));

    expect(shape(report.actions)).toEqual(['modify store ch.md']);
    const link = await links.findByMountPointAndPath(MOUNT_ID, 'ch.md');
    expect(link?.sha256).toBe(shaOf('edited on disk'));
  });
});

describe('deletions', () => {
  it('propagates a disk deletion into the store, but only once the base proves it', async () => {
    await seedDoc('gone.md', 'body');
    await syncMountPoint(store(), options());
    await fs.rm(path.join(dir, 'gone.md'));

    const report = await syncMountPoint(store(), options());

    expect(shape(report.actions)).toEqual(['delete store gone.md']);
    expect(await links.findByMountPointAndPath(MOUNT_ID, 'gone.md')).toBeNull();
  });

  it('propagates a store deletion out to disk', async () => {
    const link = await seedDoc('gone.md', 'body');
    await syncMountPoint(store(), options());
    await links.deleteWithGC(link.id);

    const report = await syncMountPoint(store(), options());

    expect(shape(report.actions)).toEqual(['delete disk gone.md']);
    expect(await exists('gone.md')).toBe(false);
  });

  it('--no-delete keeps both sides intact', async () => {
    await seedDoc('gone.md', 'body');
    await syncMountPoint(store(), options());
    await fs.rm(path.join(dir, 'gone.md'));

    const report = await syncMountPoint(store(), options({ propagateDeletes: false }));

    expect(report.actions[0].kind).toBe('skip');
    expect(await links.findByMountPointAndPath(MOUNT_ID, 'gone.md')).not.toBeNull();
  });

  it('takes a binary’s sidecar with it', async () => {
    await seedBlob('harbour.png', PNG, 'A caption.');
    await syncMountPoint(store(), options());
    expect(await exists('harbour.png.description.md')).toBe(true);

    const link = await links.findByMountPointAndPath(MOUNT_ID, 'harbour.png');
    await links.deleteWithGC(link!.id);
    await syncMountPoint(store(), options());

    expect(await exists('harbour.png')).toBe(false);
    expect(await exists('harbour.png.description.md')).toBe(false);
  });
});

describe('bytes and captions', () => {
  it('stores a .png as a .png, byte for byte — no WebP transcode', async () => {
    await writeDisk('pushed.png', PNG);

    await syncMountPoint(store(), options());

    const link = await links.findByMountPointAndPath(MOUNT_ID, 'pushed.png');
    expect(link).not.toBeNull();
    expect(link!.relativePath).toBe('pushed.png');
    expect(link!.sha256).toBe(shaOf(PNG));
    const stored = await new DocMountBlobsRepository().readDataByFileId(link!.fileId);
    expect(stored).toEqual(PNG);
  });

  it('a caption set in the store survives a byte edit pushed from disk (bug 155)', async () => {
    await writeDisk('harbour.png', PNG);
    await syncMountPoint(store(), options());

    const link = await links.findByMountPointAndPath(MOUNT_ID, 'harbour.png');
    const blobs = new DocMountBlobsRepository();
    const blob = await blobs.findByFileId(link!.fileId);
    await blobs.updateDescription(blob!.id, 'A map of the harbour.', link!.id);
    await syncMountPoint(store(), options());      // sidecar lands on disk

    const revised = Buffer.concat([PNG, Buffer.from(' — revised')]);
    await writeDisk('harbour.png', revised);
    await syncMountPoint(store(), options());

    const after = await links.findByMountPointAndPath(MOUNT_ID, 'harbour.png');
    expect(after!.sha256).toBe(shaOf(revised));
    expect(after!.description).toBe('A map of the harbour.');
  });

  it('pulls an edited sidecar back into the store', async () => {
    await seedBlob('harbour.png', PNG, 'the first caption');
    await syncMountPoint(store(), options());

    await writeDisk('harbour.png.description.md', 'a better caption\n');
    const report = await syncMountPoint(store(), options());

    expect(shape(report.actions)).toEqual(['describe store harbour.png']);
    const after = await links.findByMountPointAndPath(MOUNT_ID, 'harbour.png');
    expect(after!.description).toBe('a better caption');
  });

  it('reports a store file that uses the reserved sidecar suffix', async () => {
    await seedDoc('notes.md.description.md', 'a document with an unfortunate name');

    const report = await syncMountPoint(store(), options({ dryRun: true }));

    expect(report.actions[0].kind).toBe('conflict');
    expect(report.actions[0].reason).toContain('reserved name');
  });
});

describe('what the sync will not touch', () => {
  it('never reads, writes or deletes a dotfile on disk', async () => {
    await writeDisk('.hidden.md', 'invisible');
    await writeDisk('.config/settings.json', '{}');

    await syncMountPoint(store(), options());

    expect(await links.findByMountPointAndPath(MOUNT_ID, '.hidden.md')).toBeNull();
    expect(await exists('.hidden.md')).toBe(true);           // still there
  });

  it('never materialises a dot-path from the store', async () => {
    await seedDoc('.secret/notes.md', 'invisible');

    const report = await syncMountPoint(store(), options());

    expect(await exists('.secret')).toBe(false);
    expect(shape(report.actions)).toEqual([]);
    expect(await links.findByMountPointAndPath(MOUNT_ID, '.secret/notes.md')).not.toBeNull();
  });

  it('honours the store’s own exclude patterns on the disk walk', async () => {
    await writeDisk('node_modules/thing.md', 'not ours');

    await syncMountPoint(store(), options());

    expect(await links.findByMountPointAndPath(MOUNT_ID, 'node_modules/thing.md')).toBeNull();
  });

  it('never touches a chunk row itself — only the store’s own reindex hook does', async () => {
    await seedDoc('ch.md', 'the original');
    await syncMountPoint(store(), options());
    reindexSingleFileMock.mockClear();

    await writeDisk('ch.md', 'edited on disk');
    await syncMountPoint(store(), options());

    // The chunking happened, and it happened through the shared hook.
    expect(reindexSingleFileMock).toHaveBeenCalledWith(MOUNT_ID, 'ch.md', '');
  });
});

describe('refusals', () => {
  it('refuses a filesystem store and points at its own base path', async () => {
    await expect(
      syncMountPoint(store({ mountType: 'filesystem', basePath: '/srv/notes' }), options())
    ).rejects.toThrow(/already IS a directory/);
  });

  it('refuses an archived character’s vault', async () => {
    archivedMock.mockResolvedValue([MOUNT_ID]);
    await expect(
      syncMountPoint(store({ storeType: 'character' }), options())
    ).rejects.toThrow(SyncRefusedError);
  });

  it('refuses while a conversion is in flight', async () => {
    await expect(
      syncMountPoint(store({ conversionStatus: 'converting' }), options())
    ).rejects.toThrow(/converting/);
  });

  it('refuses while the store is being scanned', async () => {
    await expect(
      syncMountPoint(store({ scanStatus: 'scanning' }), options())
    ).rejects.toThrow(/being scanned/);
  });

  it('refuses a manifest that belongs to another store', async () => {
    await seedDoc('ch.md', 'body');
    await syncMountPoint(store(), options());
    const manifestPath = path.join(dir, '.quilltap-sync.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    manifest.storeId = 'ffffffff-0000-0000-0000-000000000000';
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    await expect(syncMountPoint(store(), options())).rejects.toThrow(/belongs to store/);
  });

  it('--no-manifest ignores one that would otherwise be refused', async () => {
    await seedDoc('ch.md', 'body');
    await syncMountPoint(store(), options());
    const manifestPath = path.join(dir, '.quilltap-sync.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    manifest.storeId = 'ffffffff-0000-0000-0000-000000000000';
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    const report = await syncMountPoint(store(), options({ useManifest: false }));
    expect(report.summary.conflicts).toBe(0);
  });
});

describe('--direction', () => {
  it('to-disk leaves the store untouched', async () => {
    await writeDisk('only-on-disk.md', 'body');
    await seedDoc('only-in-store.md', 'body');

    const report = await syncMountPoint(store(), options({ direction: 'to-disk' }));

    expect(await links.findByMountPointAndPath(MOUNT_ID, 'only-on-disk.md')).toBeNull();
    expect(await exists('only-in-store.md')).toBe(true);
    expect(report.summary.skipped).toBe(1);
  });

  it('to-store leaves the disk untouched', async () => {
    await writeDisk('only-on-disk.md', 'body');
    await seedDoc('only-in-store.md', 'body');

    await syncMountPoint(store(), options({ direction: 'to-store' }));

    expect(await links.findByMountPointAndPath(MOUNT_ID, 'only-on-disk.md')).not.toBeNull();
    expect(await exists('only-in-store.md')).toBe(false);
  });
});
