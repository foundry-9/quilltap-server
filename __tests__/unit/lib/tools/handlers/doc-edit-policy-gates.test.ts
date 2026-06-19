/**
 * Tests for the per-document policy gates in
 * lib/tools/handlers/doc-edit/shared.ts.
 *
 * These four helpers are the single chokepoint every doc_* handler funnels
 * through, so exercising them directly covers the character_read / character_write
 * enforcement for the whole tool family:
 *
 *   - assertCharacterMayRead  (doc_read_*, doc_open_document, copy source)
 *   - assertCharacterMayWrite (doc_write/str_replace/insert/update_*, delete, move, copy dest)
 *   - getCharacterBlockedReadPaths (doc_list_files / doc_grep filtering)
 *   - assertFolderHasNoWriteProtectedDescendants (doc_delete_folder / doc_move_folder)
 *
 * Security-critical invariants pinned here:
 *   - character_read:false reads/writes report NOT_FOUND (existence not leaked)
 *   - character_write:false (but readable) reports a read-only ACCESS_DENIED
 *   - operatorOverride bypasses every gate (governs characters, not the human)
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Mock the doc-edit barrel so we don't drag in native converters; supply a
// local PathResolutionError so `new`/`instanceof`/`.code` work against the
// same class the helpers throw.
jest.mock('@/lib/doc-edit', () => {
  class PathResolutionError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'PathResolutionError';
      this.code = code;
    }
  }
  return {
    PathResolutionError,
    resolveDocEditPath: jest.fn(),
    reindexSingleFile: jest.fn(),
  };
});

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

import {
  assertCharacterMayRead,
  assertCharacterMayWrite,
  getCharacterBlockedReadPaths,
  assertFolderHasNoWriteProtectedDescendants,
  type DocEditToolContext,
} from '@/lib/tools/handlers/doc-edit/shared';
import { PathResolutionError } from '@/lib/doc-edit';
import { getRepositories } from '@/lib/repositories/factory';
import type { ResolvedPath } from '@/lib/doc-edit';

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;

interface PolicyLink {
  id: string;
  relativePath: string;
  allowCharacterRead?: boolean;
  allowCharacterWrite?: boolean;
}

function wireRepos(links: PolicyLink[]) {
  const byPath = async (_mp: string, rel: string) =>
    links.find(l => l.relativePath.toLowerCase() === rel.toLowerCase()) ?? null;
  mockGetRepositories.mockReturnValue({
    docMountFileLinks: {
      findByMountPointAndPath: jest.fn(byPath),
      findByMountPointId: jest.fn(async () => links),
    },
  } as unknown as ReturnType<typeof getRepositories>);
}

function resolved(relativePath: string, mountPointId: string | undefined = 'mp-1'): ResolvedPath {
  return {
    absolutePath: `/base/${relativePath}`,
    scope: 'document_store',
    mountPointId,
    relativePath,
    basePath: '/base',
  };
}

const charCtx: DocEditToolContext = { chatId: 'c', userId: 'u', characterId: 'char-1' };
const operatorCtx: DocEditToolContext = { chatId: 'c', userId: 'u', operatorOverride: true };

async function expectPathError(promise: Promise<unknown>, code: string): Promise<PathResolutionError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(PathResolutionError);
    expect((err as PathResolutionError).code).toBe(code);
    return err as PathResolutionError;
  }
  throw new Error(`Expected a PathResolutionError(${code}) but none was thrown`);
}

describe('assertCharacterMayRead', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws NOT_FOUND for a character_read:false document (does not leak existence)', async () => {
    wireRepos([{ id: 'l1', relativePath: 'Roleplay/secret.md', allowCharacterRead: false }]);
    const err = await expectPathError(
      assertCharacterMayRead(resolved('Roleplay/secret.md'), charCtx),
      'NOT_FOUND'
    );
    expect(err.message).toContain('File not found');
    expect(err.message).not.toMatch(/denied|read-only|policy/i);
  });

  it('resolves for a readable document', async () => {
    wireRepos([{ id: 'l1', relativePath: 'Notes/open.md', allowCharacterRead: true }]);
    await expect(assertCharacterMayRead(resolved('Notes/open.md'), charCtx)).resolves.toBeUndefined();
  });

  it('operatorOverride bypasses the read gate (no repo lookup)', async () => {
    wireRepos([{ id: 'l1', relativePath: 'Roleplay/secret.md', allowCharacterRead: false }]);
    const repos = mockGetRepositories.mock.results;
    await expect(assertCharacterMayRead(resolved('Roleplay/secret.md'), operatorCtx)).resolves.toBeUndefined();
    // The operator branch returns before touching repositories.
    expect(repos.length).toBe(0);
  });

  it('no-op when the resolved path has no mountPointId (non-mount scope)', async () => {
    wireRepos([]);
    await expect(
      assertCharacterMayRead(resolved('legacy.md', undefined), charCtx)
    ).resolves.toBeUndefined();
  });

  it('no-op when no link row exists yet (unindexed path)', async () => {
    wireRepos([]);
    await expect(assertCharacterMayRead(resolved('brand/new.md'), charCtx)).resolves.toBeUndefined();
  });
});

describe('assertCharacterMayWrite', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws ACCESS_DENIED (read-only) for a readable character_write:false document', async () => {
    wireRepos([{ id: 'l1', relativePath: 'Shared/locked.md', allowCharacterRead: true, allowCharacterWrite: false }]);
    const err = await expectPathError(
      assertCharacterMayWrite(resolved('Shared/locked.md'), charCtx),
      'ACCESS_DENIED'
    );
    expect(err.message).toMatch(/read-only/i);
  });

  it('throws NOT_FOUND for a character_read:false document (existence wins over read-only)', async () => {
    wireRepos([{ id: 'l1', relativePath: 'Roleplay/secret.md', allowCharacterRead: false, allowCharacterWrite: false }]);
    const err = await expectPathError(
      assertCharacterMayWrite(resolved('Roleplay/secret.md'), charCtx),
      'NOT_FOUND'
    );
    expect(err.message).toContain('File not found');
  });

  it('resolves for a fully-permissive document', async () => {
    wireRepos([{ id: 'l1', relativePath: 'Notes/open.md', allowCharacterRead: true, allowCharacterWrite: true }]);
    await expect(assertCharacterMayWrite(resolved('Notes/open.md'), charCtx)).resolves.toBeUndefined();
  });

  it('resolves when creating a brand-new file (no link row)', async () => {
    wireRepos([]);
    await expect(assertCharacterMayWrite(resolved('Notes/new.md'), charCtx)).resolves.toBeUndefined();
  });

  it('operatorOverride bypasses the write gate', async () => {
    wireRepos([{ id: 'l1', relativePath: 'Shared/locked.md', allowCharacterRead: true, allowCharacterWrite: false }]);
    await expect(assertCharacterMayWrite(resolved('Shared/locked.md'), operatorCtx)).resolves.toBeUndefined();
  });
});

describe('getCharacterBlockedReadPaths', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the lowercased relativePaths of character_read:false links', async () => {
    wireRepos([
      { id: 'a', relativePath: 'Roleplay/Secret.md', allowCharacterRead: false },
      { id: 'b', relativePath: 'Notes/open.md', allowCharacterRead: true },
      { id: 'c', relativePath: 'Vault/Hidden.md', allowCharacterRead: false },
    ]);
    const blocked = await getCharacterBlockedReadPaths('mp-1', charCtx);
    expect([...blocked].sort()).toEqual(['roleplay/secret.md', 'vault/hidden.md']);
  });

  it('returns an empty set for the operator', async () => {
    wireRepos([{ id: 'a', relativePath: 'Roleplay/secret.md', allowCharacterRead: false }]);
    const blocked = await getCharacterBlockedReadPaths('mp-1', operatorCtx);
    expect(blocked.size).toBe(0);
  });
});

describe('assertFolderHasNoWriteProtectedDescendants', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws ACCESS_DENIED naming a protected document inside the folder', async () => {
    wireRepos([
      { id: 'a', relativePath: 'Roleplay/notes.md', allowCharacterRead: true, allowCharacterWrite: true },
      { id: 'b', relativePath: 'Roleplay/secret.md', allowCharacterRead: false, allowCharacterWrite: false },
    ]);
    const err = await expectPathError(
      assertFolderHasNoWriteProtectedDescendants(resolved('Roleplay'), charCtx),
      'ACCESS_DENIED'
    );
    expect(err.message).toContain('Roleplay/secret.md');
  });

  it('resolves when the folder contains only open documents', async () => {
    wireRepos([
      { id: 'a', relativePath: 'Roleplay/notes.md', allowCharacterRead: true, allowCharacterWrite: true },
    ]);
    await expect(
      assertFolderHasNoWriteProtectedDescendants(resolved('Roleplay'), charCtx)
    ).resolves.toBeUndefined();
  });

  it('does not match a sibling folder sharing a name prefix', async () => {
    // "Notes-archive/locked.md" must NOT be treated as inside "Notes".
    wireRepos([
      { id: 'a', relativePath: 'Notes-archive/locked.md', allowCharacterRead: false, allowCharacterWrite: false },
      { id: 'b', relativePath: 'Notes/open.md', allowCharacterRead: true, allowCharacterWrite: true },
    ]);
    await expect(
      assertFolderHasNoWriteProtectedDescendants(resolved('Notes'), charCtx)
    ).resolves.toBeUndefined();
  });

  it('operatorOverride bypasses the folder guard', async () => {
    wireRepos([
      { id: 'b', relativePath: 'Roleplay/secret.md', allowCharacterRead: false, allowCharacterWrite: false },
    ]);
    await expect(
      assertFolderHasNoWriteProtectedDescendants(resolved('Roleplay'), operatorCtx)
    ).resolves.toBeUndefined();
  });
});
