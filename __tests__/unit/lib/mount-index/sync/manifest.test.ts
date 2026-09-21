/**
 * `.quilltap-sync.json` — the record of what the last run left on both sides.
 *
 * The refusals matter more than the happy path: a manifest belonging to
 * another store would drive deletions across a directory that has nothing to
 * do with it, and a manifest that does not parse must degrade to "first run"
 * (create, never delete) rather than to "everything here is new".
 *
 * Guards:
 *   - lib/mount-index/sync/manifest.ts
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  ManifestMismatchError,
  baseFromManifest,
  manifestPathFor,
  readManifest,
  writeManifest,
} from '@/lib/mount-index/sync/manifest';
import type { SyncManifest } from '@/lib/mount-index/sync/types';

let dir: string;

const STORE_ID = '11111111-2222-3333-4444-555555555555';

function manifest(over: Partial<SyncManifest> = {}): SyncManifest {
  return {
    version: 1,
    storeId: STORE_ID,
    storeName: 'Lore',
    lastSyncAt: '2026-09-21T10:15:30.120Z',
    entries: {
      'chapters/01.md': {
        kind: 'file', sha256: 'a'.repeat(64),
        lastModified: '2026-09-19T14:02:11.000Z', createdAt: '2024-01-01T00:00:00.000Z',
      },
      'lore/maps/': { kind: 'folder' },
    },
    ...over,
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quilltap-sync-manifest-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('round trip', () => {
  it('writes and reads back exactly what it was given', async () => {
    const original = manifest();
    await writeManifest(dir, original);
    expect(await readManifest(dir, STORE_ID, [])).toEqual(original);
  });

  it('leaves no temp file behind', async () => {
    await writeManifest(dir, manifest());
    const left = await fs.readdir(dir);
    expect(left).toEqual(['.quilltap-sync.json']);
  });

  it('replaces a previous manifest in place', async () => {
    await writeManifest(dir, manifest());
    await writeManifest(dir, manifest({ storeName: 'Lore (renamed)' }));
    const read = await readManifest(dir, STORE_ID, []);
    expect(read?.storeName).toBe('Lore (renamed)');
  });

  it('puts the manifest at the documented name', () => {
    expect(manifestPathFor('/tmp/x')).toBe('/tmp/x/.quilltap-sync.json');
  });
});

describe('refusals and degradations', () => {
  it('returns null when there is no manifest at all', async () => {
    expect(await readManifest(dir, STORE_ID, [])).toBeNull();
  });

  it('refuses a manifest belonging to another store', async () => {
    await writeManifest(dir, manifest({ storeId: 'someone-elses-store' }));
    await expect(readManifest(dir, STORE_ID, [])).rejects.toThrow(ManifestMismatchError);
  });

  it('names both stores in the refusal so the operator can tell what happened', async () => {
    await writeManifest(dir, manifest({ storeId: 'someone-elses-store' }));
    await expect(readManifest(dir, STORE_ID, [])).rejects.toThrow(/someone-elses-store/);
  });

  it('degrades unparseable JSON to a first run, with a warning', async () => {
    await fs.writeFile(manifestPathFor(dir), '{ not json at all', 'utf-8');
    const warnings: string[] = [];
    expect(await readManifest(dir, STORE_ID, warnings)).toBeNull();
    expect(warnings.join(' ')).toContain('not valid JSON');
  });

  it('degrades a manifest that does not validate, with a warning', async () => {
    await fs.writeFile(
      manifestPathFor(dir),
      JSON.stringify({ version: 99, storeId: STORE_ID, entries: {} }),
      'utf-8'
    );
    const warnings: string[] = [];
    expect(await readManifest(dir, STORE_ID, warnings)).toBeNull();
    expect(warnings.join(' ')).toContain('did not validate');
  });
});

describe('base', () => {
  it('keys entries case-insensitively, like both walks', () => {
    const base = baseFromManifest(manifest({
      entries: { 'Chapters/01.MD': { kind: 'file', sha256: 'a'.repeat(64) } },
    }));
    expect(base.has('chapters/01.md')).toBe(true);
  });

  it('is empty for a first run', () => {
    expect(baseFromManifest(null).size).toBe(0);
  });
});
