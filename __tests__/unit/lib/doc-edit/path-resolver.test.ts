/**
 * Regression tests for lib/doc-edit/path-resolver.ts
 *
 * Covers the symlink-aware boundary check. On macOS the canonical iCloud
 * data directory `~/iCloud` is a symlink to
 * `~/Library/Mobile Documents/com~apple~CloudDocs`. When a project file
 * under that tree is read, `fs.realpath` expands the symlink while a
 * naïvely-joined `baseDir` does not — and a containment check on the two
 * sides used to reject every existing file as a "Path escapes project
 * boundary" error. The fix realpaths both sides; these tests pin that
 * behavior so the regression cannot return.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const getFilesDirMock = jest.fn<() => string>();

jest.mock('@/lib/paths', () => ({
  getFilesDir: () => getFilesDirMock(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn(),
  writeDatabaseDocument: jest.fn(),
  DatabaseStoreError: class extends Error {
    constructor(message: string, public code: string) {
      super(message);
    }
  },
}));

import { resolveDocEditPath, PathResolutionError } from '@/lib/doc-edit/path-resolver';

const PROJECT_ID = 'proj-1234';

let realRoot: string;
let linkRoot: string;
let realFilesDir: string;
let linkedFilesDir: string;

beforeEach(async () => {
  // realRoot/  ← actual storage
  // linkRoot/  ← symlink → realRoot (mimics ~/iCloud → ~/Library/Mobile Documents/...)
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-path-resolver-'));
  realRoot = path.join(tmp, 'real');
  linkRoot = path.join(tmp, 'link');
  await fs.mkdir(realRoot, { recursive: true });
  await fs.symlink(realRoot, linkRoot, 'dir');

  realFilesDir = path.join(realRoot, 'files');
  linkedFilesDir = path.join(linkRoot, 'files');
  await fs.mkdir(path.join(realFilesDir, PROJECT_ID, 'Folio Drafts'), { recursive: true });
  await fs.mkdir(path.join(realFilesDir, '_general'), { recursive: true });
  await fs.writeFile(
    path.join(realFilesDir, PROJECT_ID, 'Folio Drafts', 'the-third-arrives.md'),
    'concierge prose',
    'utf-8',
  );

  getFilesDirMock.mockReturnValue(linkedFilesDir);
});

afterEach(async () => {
  // realRoot lives under tmpdir; clean up the whole sibling pair.
  const parent = path.dirname(realRoot);
  await fs.rm(parent, { recursive: true, force: true });
  getFilesDirMock.mockReset();
});

describe('resolveDocEditPath — project scope under a symlinked data directory', () => {
  it('resolves an existing project file whose data dir is reached through a symlink', async () => {
    const resolved = await resolveDocEditPath(
      'project',
      'Folio Drafts/the-third-arrives.md',
      { projectId: PROJECT_ID },
    );

    expect(resolved.scope).toBe('project');
    expect(resolved.relativePath).toBe('Folio Drafts/the-third-arrives.md');
    // The absolute path must point at the *real* file. Verify we can read it.
    const contents = await fs.readFile(resolved.absolutePath, 'utf-8');
    expect(contents).toBe('concierge prose');
  });

  it('resolves a not-yet-created project file (new write) under a symlinked data dir', async () => {
    const resolved = await resolveDocEditPath(
      'project',
      'Folio Drafts/the-fourth-arrives.md',
      { projectId: PROJECT_ID },
    );

    expect(resolved.scope).toBe('project');
    // We should be able to write to the resolved path without it falling
    // outside the realpath'd base — i.e. boundary check must not have
    // rejected it just because the leaf doesn't exist yet.
    await fs.writeFile(resolved.absolutePath, 'new draft', 'utf-8');
    const onDisk = await fs.readFile(
      path.join(realFilesDir, PROJECT_ID, 'Folio Drafts', 'the-fourth-arrives.md'),
      'utf-8',
    );
    expect(onDisk).toBe('new draft');
  });

  it('still rejects path-traversal attempts (..) under a symlinked data dir', async () => {
    await expect(
      resolveDocEditPath('project', '../escape.md', { projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(PathResolutionError);
  });

  it('still rejects absolute paths under a symlinked data dir', async () => {
    await expect(
      resolveDocEditPath('project', '/etc/passwd', { projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(PathResolutionError);
  });
});

describe('resolveDocEditPath — general scope under a symlinked data directory', () => {
  it('resolves an existing file in general storage reached through a symlink', async () => {
    await fs.writeFile(path.join(realFilesDir, '_general', 'Amy.md'), 'character notes', 'utf-8');

    const resolved = await resolveDocEditPath('general', 'Amy.md', {});

    expect(resolved.scope).toBe('general');
    const contents = await fs.readFile(resolved.absolutePath, 'utf-8');
    expect(contents).toBe('character notes');
  });
});
