/**
 * Orchestration tests for the partitioned write applier in job-dispatcher.ts.
 *
 * Each background-job batch is split by target database and committed in its
 * own transaction on its own connection. These tests drive `applyWritesUnsafe`
 * with fake `Database` handles (recording BEGIN/COMMIT/ROLLBACK) and a
 * recording repository container to assert:
 *   - cross-DB isolation + ordering (secondary partitions before main for
 *     idempotent handlers; main first for main-primary autonomous turns),
 *   - best-effort secondary semantics for autonomous turns (chat survives a
 *     dropped doc-store effect),
 *   - the cross-job concurrent folder-create reconcile (unique conflict →
 *     resolve to the existing folder + remap references for the rest of the
 *     batch).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyWritesUnsafe } from '../job-dispatcher';
import { getRepositories } from '@/lib/repositories/factory';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { getRawMountIndexDatabase } from '@/lib/database/backends/sqlite/mount-index-client';
import { getRawLLMLogsDatabase } from '@/lib/database/backends/sqlite/llm-logs-client';
import type { ChildWritePayload } from '../../ipc-types';

// `@/lib/repositories/factory` is already mocked globally in jest.setup.ts.
jest.mock('@/lib/database/backends/sqlite/client', () => ({ getRawDatabase: jest.fn() }));
jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({ getRawMountIndexDatabase: jest.fn() }));
jest.mock('@/lib/database/backends/sqlite/llm-logs-client', () => ({ getRawLLMLogsDatabase: jest.fn() }));
jest.mock('../processor-host', () => ({ sendToChild: jest.fn(() => true), notifyChild: jest.fn() }));

interface FakeDb {
  exec: jest.Mock;
  _calls: string[];
}

function fakeDb(opts?: { failCommit?: string }): FakeDb {
  const _calls: string[] = [];
  const exec = jest.fn((sql: string) => {
    _calls.push(sql);
    if (opts?.failCommit && sql === 'COMMIT') throw new Error(opts.failCommit);
  });
  return { exec, _calls } as unknown as FakeDb;
}

/** Build a recording repo container; `calls` lists applied write methods in order. */
function makeRepos() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec = (name: string) =>
    jest.fn((...args: unknown[]) => {
      calls.push({ method: name, args });
      return Promise.resolve({ ok: true });
    });
  const repos = {
    chats: { update: rec('chats.update'), addMessage: rec('chats.addMessage') },
    embeddingStatus: { markAsEmbedded: rec('embeddingStatus.markAsEmbedded') },
    docMountChunks: { updateEmbedding: rec('docMountChunks.updateEmbedding') },
    docMountFolders: {
      create: rec('docMountFolders.create'),
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    },
    docMountFileLinks: { create: rec('docMountFileLinks.create') },
    llmLogs: { cleanupOldLogs: rec('llmLogs.cleanupOldLogs') },
  };
  return { repos, calls };
}

const AUTONOMOUS = 'AUTONOMOUS_ROOM_TURN';

describe('applyWritesUnsafe — partitioned applier', () => {
  let mainDb: FakeDb;
  let mountDb: FakeDb;
  let llmDb: FakeDb;
  let repos: ReturnType<typeof makeRepos>['repos'];
  let calls: ReturnType<typeof makeRepos>['calls'];

  beforeEach(() => {
    jest.clearAllMocks();
    mainDb = fakeDb();
    mountDb = fakeDb();
    llmDb = fakeDb();
    ({ repos, calls } = makeRepos());

    jest.mocked(getRawDatabase).mockReturnValue(mainDb as never);
    jest.mocked(getRawMountIndexDatabase).mockReturnValue(mountDb as never);
    jest.mocked(getRawLLMLogsDatabase).mockReturnValue(llmDb as never);
    jest.mocked(getRepositories).mockReturnValue(repos as never);
  });

  it('isolates each database in its own transaction and applies secondary partitions before main (idempotent handler)', async () => {
    const writes: ChildWritePayload[] = [
      { method: 'chats.update', args: [{ id: 'c1' }] },
      { method: 'docMountChunks.updateEmbedding', args: [{ id: 'ch1' }] },
      { method: 'embeddingStatus.markAsEmbedded', args: [{ id: 'ch1' }] },
    ];

    await applyWritesUnsafe('job-1', writes, 'EMBEDDING_GENERATE');

    // Mount partition committed before the main partition.
    expect(mountDb._calls).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
    expect(mainDb._calls).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
    expect(llmDb.exec).not.toHaveBeenCalled(); // no llm writes
    // Cross-partition ordering: mount-index write runs before the main writes.
    expect(calls.map(c => c.method)).toEqual([
      'docMountChunks.updateEmbedding',
      'chats.update',
      'embeddingStatus.markAsEmbedded',
    ]);
  });

  it('fails the whole job and never touches main when a secondary partition fails (idempotent handler)', async () => {
    repos.docMountChunks.updateEmbedding = jest.fn().mockRejectedValue(new Error('mount boom'));
    const writes: ChildWritePayload[] = [
      { method: 'chats.update', args: [{ id: 'c1' }] },
      { method: 'docMountChunks.updateEmbedding', args: [{ id: 'ch1' }] },
    ];

    await expect(applyWritesUnsafe('job-2', writes, 'EMBEDDING_GENERATE')).rejects.toThrow('mount boom');

    // Mount rolled back; main never opened a transaction (secondary-first ordering).
    expect(mountDb._calls).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK']);
    expect(mainDb.exec).not.toHaveBeenCalled();
    expect(repos.chats.update).not.toHaveBeenCalled();
  });

  it('keeps the chat turn when a secondary (doc-store) partition fails for an autonomous turn', async () => {
    repos.docMountChunks.updateEmbedding = jest.fn().mockRejectedValue(new Error('mount degraded'));
    const writes: ChildWritePayload[] = [
      { method: 'chats.addMessage', args: [{ id: 'm1' }] },
      { method: 'chats.update', args: [{ id: 'c1', runState: 'idle' }] },
      { method: 'docMountChunks.updateEmbedding', args: [{ id: 'ch1' }] },
    ];

    // Must NOT throw — the committed chat survives the dropped doc-store effect.
    await expect(applyWritesUnsafe('job-3', writes, AUTONOMOUS)).resolves.toBeUndefined();

    // Main committed first and authoritatively.
    expect(mainDb._calls).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
    expect(repos.chats.addMessage).toHaveBeenCalledTimes(1);
    expect(repos.chats.update).toHaveBeenCalledTimes(1);
    // Mount partition was attempted best-effort and rolled back.
    expect(mountDb._calls).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK']);
  });

  it('aborts before any doc-store write when the main partition fails for an autonomous turn', async () => {
    repos.chats.addMessage = jest.fn().mockRejectedValue(new Error('main boom'));
    const writes: ChildWritePayload[] = [
      { method: 'chats.addMessage', args: [{ id: 'm1' }] },
      { method: 'docMountFolders.create', args: [{ mountPointId: 'MP', path: 'foo', parentId: null, name: 'foo' }, { id: 'F1' }] },
    ];

    await expect(applyWritesUnsafe('job-4', writes, AUTONOMOUS)).rejects.toThrow('main boom');

    expect(mainDb._calls).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK']);
    expect(mountDb.exec).not.toHaveBeenCalled(); // main-first: secondary never attempted
    expect(repos.docMountFolders.create).not.toHaveBeenCalled();
  });

  it('reconciles a concurrent folder create to the existing folder and remaps references', async () => {
    repos.docMountFolders.create = jest.fn().mockRejectedValue(
      Object.assign(new Error('UNIQUE constraint failed: doc_mount_folders'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }),
    );
    repos.docMountFolders.findByMountPointAndPath = jest.fn().mockResolvedValue({ id: 'EXIST' });
    repos.docMountFileLinks.create = jest.fn((...args: unknown[]) => {
      calls.push({ method: 'docMountFileLinks.create', args });
      return Promise.resolve({ ok: true });
    });

    const writes: ChildWritePayload[] = [
      { method: 'docMountFolders.create', args: [{ mountPointId: 'MP', path: 'foo', parentId: null, name: 'foo' }, { id: 'BUF' }] },
      { method: 'docMountFileLinks.create', args: [{ mountPointId: 'MP', folderId: 'BUF', relativePath: 'foo/x.md' }, { id: 'L1' }] },
    ];

    await expect(applyWritesUnsafe('job-5', writes, 'EMBEDDING_GENERATE')).resolves.toBeUndefined();

    // The mount partition committed rather than failing on the unique conflict.
    expect(mountDb._calls).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
    expect(repos.docMountFolders.findByMountPointAndPath).toHaveBeenCalledWith('MP', 'foo');
    // The file link's buffered folderId (BUF) was rewritten to the surviving row (EXIST).
    const linkCall = calls.find(c => c.method === 'docMountFileLinks.create');
    expect((linkCall?.args[0] as Record<string, unknown>).folderId).toBe('EXIST');
  });

  it('surfaces a unique conflict that has no matching existing folder (genuine corruption)', async () => {
    repos.docMountFolders.create = jest.fn().mockRejectedValue(
      Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }),
    );
    repos.docMountFolders.findByMountPointAndPath = jest.fn().mockResolvedValue(null);

    const writes: ChildWritePayload[] = [
      { method: 'docMountFolders.create', args: [{ mountPointId: 'MP', path: 'foo', parentId: null, name: 'foo' }, { id: 'BUF' }] },
    ];

    await expect(applyWritesUnsafe('job-6', writes, 'EMBEDDING_GENERATE')).rejects.toThrow(/UNIQUE constraint/);
    expect(mountDb._calls).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK']);
  });

  it('applies an llm-logs-only batch on the llm-logs connection alone', async () => {
    const writes: ChildWritePayload[] = [
      { method: 'llmLogs.cleanupOldLogs', args: [30] },
    ];

    await applyWritesUnsafe('job-7', writes, 'LLM_LOG_CLEANUP');

    expect(llmDb._calls).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
    expect(repos.llmLogs.cleanupOldLogs).toHaveBeenCalledWith(30);
    expect(mainDb.exec).not.toHaveBeenCalled();
    expect(mountDb.exec).not.toHaveBeenCalled();
  });

  it('throws when a partition has writes but its connection is unavailable', async () => {
    jest.mocked(getRawMountIndexDatabase).mockReturnValue(null as never);
    const writes: ChildWritePayload[] = [
      { method: 'docMountChunks.updateEmbedding', args: [{ id: 'ch1' }] },
    ];
    await expect(applyWritesUnsafe('job-8', writes, 'EMBEDDING_GENERATE')).rejects.toThrow(/connection is not initialized/);
  });
});

describe('applyWritesUnsafe — __finalizeFile', () => {
  it('renames a staged file inside the main partition transaction', async () => {
    jest.clearAllMocks();
    const mainDb = fakeDb();
    jest.mocked(getRawDatabase).mockReturnValue(mainDb as never);
    jest.mocked(getRawMountIndexDatabase).mockReturnValue(fakeDb() as never);
    jest.mocked(getRawLLMLogsDatabase).mockReturnValue(fakeDb() as never);
    const { repos } = makeRepos();
    jest.mocked(getRepositories).mockReturnValue(repos as never);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-finalize-'));
    const stagingPath = path.join(dir, 'staged.bin');
    const finalPath = path.join(dir, 'final', 'image.webp');
    fs.writeFileSync(stagingPath, 'payload');

    await applyWritesUnsafe('job-finalize', [
      { method: '__finalizeFile', args: [{ stagingPath, finalPath }] },
    ], 'STORY_BACKGROUND');

    expect(mainDb._calls).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
    expect(fs.existsSync(finalPath)).toBe(true);
    expect(fs.existsSync(stagingPath)).toBe(false);
    expect(fs.readFileSync(finalPath, 'utf8')).toBe('payload');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
