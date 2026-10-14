/**
 * The document-store sync planner, row by row.
 *
 * The planner is the whole of the sync's judgement — which side wins, what
 * counts as a deletion, when to refuse — and it is pure, so every rule can be
 * stated as a table rather than by running a sync and inspecting a directory
 * afterwards. If a case is not here, the sync does not promise it.
 *
 * Guards:
 *   - lib/mount-index/sync/planner.ts
 */

import { describe, it, expect } from '@jest/globals';
import { planSync, CHARACTER_VAULT_KEYSTONES } from '@/lib/mount-index/sync/planner';
import { descriptionSha256 } from '@/lib/mount-index/sync/sidecar';
import type {
  ManifestEntry,
  SyncAction,
  SyncEntry,
  SyncEntryMap,
  SyncOptions,
} from '@/lib/mount-index/sync/types';

const T0 = '2026-09-01T10:00:00.000Z';
const T1 = '2026-09-10T10:00:00.000Z';
const T2 = '2026-09-20T10:00:00.000Z';
const BIRTH_OLD = '2024-01-01T00:00:00.000Z';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function opts(over: Partial<SyncOptions> = {}): SyncOptions {
  return {
    targetPath: '/tmp/target',
    dryRun: false,
    direction: 'both',
    prefer: 'newer',
    propagateDeletes: true,
    useManifest: true,
    ...over,
  };
}

function file(relativePath: string, over: Partial<SyncEntry> = {}): SyncEntry {
  return {
    relativePath,
    kind: 'file',
    sha256: SHA_A,
    sizeBytes: 100,
    lastModified: T1,
    createdAt: BIRTH_OLD,
    fileType: 'markdown',
    ...over,
  };
}

function folder(relativePath: string, over: Partial<SyncEntry> = {}): SyncEntry {
  return { relativePath, kind: 'folder', lastModified: T1, createdAt: BIRTH_OLD, ...over };
}

function mapOf(...entries: SyncEntry[]): SyncEntryMap {
  return new Map(entries.map(e => [e.relativePath.toLowerCase(), e]));
}

function baseOf(record: Record<string, ManifestEntry>): Map<string, ManifestEntry> {
  return new Map(Object.entries(record).map(([k, v]) => [k.toLowerCase(), v]));
}

function plan(
  store: SyncEntryMap,
  disk: SyncEntryMap,
  base: Map<string, ManifestEntry> = new Map(),
  options: SyncOptions = opts(),
  isCharacterVault = false,
  canSetDiskBirthtime = true
) {
  return planSync({ store, disk, base, options, isCharacterVault, canSetDiskBirthtime });
}

/** `kind side path` for each action, for compact assertions. */
function shape(actions: SyncAction[]): string[] {
  return actions.map(a => `${a.kind} ${a.side ?? '—'} ${a.relativePath}`);
}

// ===========================================================================
// The decision table
// ===========================================================================

describe('present on one side only, with no manifest (first run)', () => {
  it('materialises a store file on disk', () => {
    const { actions } = plan(mapOf(file('chapters/01.md')), mapOf());
    expect(shape(actions)).toEqual(['create disk chapters/01.md']);
    expect(actions[0].lastModified).toBe(T1);
  });

  it('materialises a disk file in the store', () => {
    const { actions } = plan(mapOf(), mapOf(file('drafts/new.md')));
    expect(shape(actions)).toEqual(['create store drafts/new.md']);
  });

  it('never deletes on a first run, in either direction', () => {
    const { actions } = plan(mapOf(file('a.md')), mapOf(file('b.md')));
    expect(shape(actions).sort()).toEqual(['create disk a.md', 'create store b.md']);
    expect(actions.some(a => a.kind === 'delete')).toBe(false);
  });

  it('creates an empty folder rather than ignoring it', () => {
    const { actions } = plan(mapOf(folder('lore/maps')), mapOf());
    expect(shape(actions)).toEqual(['mkdir disk lore/maps']);
  });
});

describe('present on one side only, with a manifest', () => {
  const wasThere = baseOf({ 'notes.md': { kind: 'file', sha256: SHA_A, lastModified: T1 } });

  it('propagates a disk deletion to the store', () => {
    const { actions } = plan(mapOf(file('notes.md')), mapOf(), wasThere);
    expect(shape(actions)).toEqual(['delete store notes.md']);
    expect(actions[0].reason).toContain('deleted on disk');
  });

  it('propagates a store deletion to disk', () => {
    const { actions } = plan(mapOf(), mapOf(file('notes.md')), wasThere);
    expect(shape(actions)).toEqual(['delete disk notes.md']);
  });

  it('refuses when the surviving side was edited since the base', () => {
    const { actions } = plan(mapOf(file('notes.md', { sha256: SHA_B })), mapOf(), wasThere);
    expect(actions[0].kind).toBe('conflict');
    expect(actions[0].reason).toContain('deleted on disk');
  });

  it('--no-delete downgrades a deletion to a skip', () => {
    const { actions } = plan(mapOf(file('notes.md')), mapOf(), wasThere, opts({ propagateDeletes: false }));
    expect(shape(actions)).toEqual(['skip — notes.md']);
  });

  it('forgets an entry that is gone from both sides', () => {
    const { actions } = plan(mapOf(), mapOf(), wasThere);
    expect(actions).toEqual([]);
  });

  it('propagates an empty folder’s deletion as an rmdir', () => {
    const base = baseOf({ 'drafts': { kind: 'folder' } });
    const { actions } = plan(mapOf(folder('drafts')), mapOf(), base);
    expect(shape(actions)).toEqual(['rmdir store drafts']);
  });
});

describe('present on both sides with different bytes', () => {
  it('the newer side wins when only one side moved', () => {
    const base = baseOf({ 'ch.md': { kind: 'file', sha256: SHA_A } });
    const { actions } = plan(
      mapOf(file('ch.md', { sha256: SHA_A, lastModified: T1 })),
      mapOf(file('ch.md', { sha256: SHA_B, lastModified: T2 })),
      base
    );
    expect(shape(actions)).toEqual(['modify store ch.md']);
    expect(actions[0].reason).toContain('disk newer');
  });

  it('refuses when both sides moved since the base', () => {
    const base = baseOf({ 'ch.md': { kind: 'file', sha256: SHA_A } });
    const { actions } = plan(
      mapOf(file('ch.md', { sha256: SHA_B, lastModified: T2 })),
      mapOf(file('ch.md', { sha256: SHA_C, lastModified: T1 })),
      base
    );
    expect(actions[0].kind).toBe('conflict');
    expect(actions[0].side).toBeNull();
  });

  it('--prefer disk resolves a conflict without consulting the clocks', () => {
    const base = baseOf({ 'ch.md': { kind: 'file', sha256: SHA_A } });
    const { actions } = plan(
      mapOf(file('ch.md', { sha256: SHA_B, lastModified: T2 })),
      mapOf(file('ch.md', { sha256: SHA_C, lastModified: T0 })),
      base,
      opts({ prefer: 'disk' })
    );
    expect(shape(actions)).toEqual(['modify store ch.md']);
    expect(actions[0].reason).toBe('--prefer disk');
  });

  it('--prefer store resolves it the other way', () => {
    const base = baseOf({ 'ch.md': { kind: 'file', sha256: SHA_A } });
    const { actions } = plan(
      mapOf(file('ch.md', { sha256: SHA_B, lastModified: T0 })),
      mapOf(file('ch.md', { sha256: SHA_C, lastModified: T2 })),
      base,
      opts({ prefer: 'store' })
    );
    expect(shape(actions)).toEqual(['modify disk ch.md']);
  });

  it('falls back to the clocks on a first run', () => {
    const { actions } = plan(
      mapOf(file('ch.md', { sha256: SHA_A, lastModified: T2 })),
      mapOf(file('ch.md', { sha256: SHA_B, lastModified: T0 }))
    );
    expect(shape(actions)).toEqual(['modify disk ch.md']);
  });

  it('refuses a first-run difference the clocks cannot separate', () => {
    const { actions } = plan(
      mapOf(file('ch.md', { sha256: SHA_A, lastModified: T1 })),
      mapOf(file('ch.md', { sha256: SHA_B, lastModified: T1 }))
    );
    expect(actions[0].kind).toBe('conflict');
  });

  it('carries the older createdAt onto the written side', () => {
    const { actions } = plan(
      mapOf(file('ch.md', { sha256: SHA_A, lastModified: T2, createdAt: '2025-06-01T00:00:00.000Z' })),
      mapOf(file('ch.md', { sha256: SHA_B, lastModified: T0, createdAt: BIRTH_OLD }))
    );
    expect(actions[0].createdAt).toBe(BIRTH_OLD);
  });

  it('a side that cannot report createdAt never wins it', () => {
    const { actions } = plan(
      mapOf(file('ch.md', { sha256: SHA_A, lastModified: T2, createdAt: BIRTH_OLD })),
      mapOf(file('ch.md', { sha256: SHA_B, lastModified: T0, createdAt: null }))
    );
    expect(actions[0].createdAt).toBe(BIRTH_OLD);
  });

  it('a pure-case rename follows the content winner', () => {
    const { actions } = plan(
      mapOf(file('Notes.md', { sha256: SHA_A, lastModified: T0 })),
      mapOf(file('notes.md', { sha256: SHA_B, lastModified: T2 }))
    );
    // The store is rewritten, so the store's stored casing is what is written.
    expect(shape(actions)).toEqual(['modify store notes.md']);
  });
});

describe('present on both sides with the same bytes', () => {
  it('copies the winner’s clock across as a touch rather than the bytes', () => {
    const { actions } = plan(
      mapOf(file('ch.md', { lastModified: T0 })),
      mapOf(file('ch.md', { lastModified: T2 }))
    );
    expect(shape(actions)).toEqual(['touch store ch.md']);
    expect(actions[0].lastModified).toBe(T2);
  });

  it('plans nothing at all when both sides already agree', () => {
    const { actions } = plan(mapOf(file('ch.md')), mapOf(file('ch.md')));
    expect(actions).toEqual([]);
  });

  it('tolerates a sub-second clock difference', () => {
    const { actions } = plan(
      mapOf(file('ch.md', { lastModified: '2026-09-10T10:00:00.000Z' })),
      mapOf(file('ch.md', { lastModified: '2026-09-10T10:00:00.900Z' }))
    );
    expect(actions).toEqual([]);
  });

  it('does not tolerate a difference past the tolerance', () => {
    const { actions } = plan(
      mapOf(file('ch.md', { lastModified: '2026-09-10T10:00:00.000Z' })),
      mapOf(file('ch.md', { lastModified: '2026-09-10T10:00:02.000Z' }))
    );
    expect(shape(actions)).toEqual(['touch store ch.md']);
  });

  it('touches the disk side when the store is the newer clock', () => {
    const { actions } = plan(
      mapOf(file('ch.md', { lastModified: T2 })),
      mapOf(file('ch.md', { lastModified: T0 }))
    );
    expect(shape(actions)).toEqual(['touch disk ch.md']);
  });

  it('never plans a disk touch for a creation date this platform cannot set', () => {
    // Otherwise the touch could not change the filesystem's answer, the next
    // walk would read the same disagreement, and the sync would plan the same
    // futile action on every run for ever.
    const { actions } = plan(
      mapOf(file('ch.md', { createdAt: '2025-01-01T00:00:00.000Z' })),
      mapOf(file('ch.md', { createdAt: BIRTH_OLD })),
      new Map(), opts(), false, /* canSetDiskBirthtime */ false
    );
    expect(shape(actions)).toEqual(['touch store ch.md']);
  });

  it('still corrects the mtime where birthtime is out of reach', () => {
    const { actions } = plan(
      mapOf(file('ch.md', { lastModified: T2, createdAt: BIRTH_OLD })),
      mapOf(file('ch.md', { lastModified: T0, createdAt: BIRTH_OLD })),
      new Map(), opts(), false, false
    );
    expect(shape(actions)).toEqual(['touch disk ch.md']);
    expect(actions[0].createdAt).toBeUndefined();
  });

  it('touches both sides when only the creation date disagrees', () => {
    const { actions } = plan(
      mapOf(file('ch.md', { createdAt: '2025-01-01T00:00:00.000Z' })),
      mapOf(file('ch.md', { createdAt: BIRTH_OLD }))
    );
    expect(shape(actions)).toEqual(['touch store ch.md']);
    expect(actions[0].createdAt).toBe(BIRTH_OLD);
  });
});

describe('kind disagreements', () => {
  it('refuses a path that is a file on one side and a folder on the other', () => {
    const { actions } = plan(mapOf(folder('lore')), mapOf(file('lore')));
    expect(actions[0].kind).toBe('conflict');
    expect(actions[0].reason).toContain('folder in the store');
  });

  it('leaves a folder present on both sides alone', () => {
    const { actions } = plan(
      mapOf(folder('lore', { lastModified: T0 })),
      mapOf(folder('lore', { lastModified: T2 }))
    );
    expect(actions).toEqual([]);
  });
});

// ===========================================================================
// Descriptions
// ===========================================================================

describe('descriptions and their sidecars', () => {
  const img = (over: Partial<SyncEntry> = {}) =>
    file('lore/harbour.png', { fileType: 'blob', sha256: SHA_A, ...over });

  it('pushes a store caption out as a sidecar on a first run', () => {
    const { actions } = plan(
      mapOf(img({ description: 'A map of the harbour.', descriptionUpdatedAt: T1 })),
      mapOf(img())
    );
    expect(shape(actions)).toEqual(['describe disk lore/harbour.png']);
    expect(actions[0].description).toBe('A map of the harbour.');
  });

  it('pulls an edited sidecar back into the store', () => {
    const base = baseOf({
      'lore/harbour.png': {
        kind: 'file', sha256: SHA_A,
        descriptionSha256: descriptionSha256('old caption'),
      },
    });
    const { actions } = plan(
      mapOf(img({ description: 'old caption' })),
      mapOf(img({ description: 'a better caption', descriptionUpdatedAt: T2 })),
      base
    );
    expect(shape(actions)).toEqual(['describe store lore/harbour.png']);
    expect(actions[0].description).toBe('a better caption');
  });

  it('refuses when the caption moved on both sides', () => {
    const base = baseOf({
      'lore/harbour.png': {
        kind: 'file', sha256: SHA_A,
        descriptionSha256: descriptionSha256('old caption'),
      },
    });
    const { actions, warnings } = plan(
      mapOf(img({ description: 'the store’s new caption' })),
      mapOf(img({ description: 'the sidecar’s new caption' })),
      base
    );
    expect(actions[0].kind).toBe('conflict');
    expect(warnings.join(' ')).toContain('Caption conflict');
  });

  it('reads a deleted sidecar as a clearing when the store stood still', () => {
    const base = baseOf({
      'lore/harbour.png': {
        kind: 'file', sha256: SHA_A,
        descriptionSha256: descriptionSha256('old caption'),
      },
    });
    const { actions } = plan(
      mapOf(img({ description: 'old caption' })),
      mapOf(img()),                                   // no sidecar on disk
      base
    );
    expect(shape(actions)).toEqual(['describe store lore/harbour.png']);
    expect(actions[0].description).toBe('');
    expect(actions[0].reason).toContain('cleared');
  });

  it('does not read a missing sidecar as a clearing under --no-delete', () => {
    const base = baseOf({
      'lore/harbour.png': {
        kind: 'file', sha256: SHA_A,
        descriptionSha256: descriptionSha256('old caption'),
      },
    });
    const { actions } = plan(
      mapOf(img({ description: 'old caption' })),
      mapOf(img()),
      base,
      opts({ propagateDeletes: false })
    );
    expect(shape(actions)).toEqual(['describe disk lore/harbour.png']);
  });

  it('says nothing when the caption already matches', () => {
    const { actions } = plan(
      mapOf(img({ description: 'same' })),
      mapOf(img({ description: 'same' }))
    );
    expect(actions).toEqual([]);
  });

  it('ignores trailing whitespace an editor added to the sidecar', () => {
    const { actions } = plan(
      mapOf(img({ description: 'same' })),
      mapOf(img({ description: 'same\n' }))
    );
    expect(actions).toEqual([]);
  });

  it('reports a text document’s description as unsynced rather than losing it quietly', () => {
    const { actions } = plan(
      mapOf(file('README.md', { description: 'a note about this file' })),
      mapOf(file('README.md'))
    );
    expect(shape(actions)).toEqual(['skip — README.md']);
    expect(actions[0].reason).toContain('text document');
  });

  it('says nothing about a text document with no description', () => {
    const { actions } = plan(mapOf(file('README.md')), mapOf(file('README.md')));
    expect(actions).toEqual([]);
  });
});

// ===========================================================================
// Direction, vaults, link groups, ordering
// ===========================================================================

describe('--direction narrows the plan', () => {
  it('to-disk turns store-side work into skips', () => {
    const { actions } = plan(
      mapOf(file('a.md')),
      mapOf(file('b.md')),
      new Map(),
      opts({ direction: 'to-disk' })
    );
    expect(shape(actions).sort()).toEqual(['create disk a.md', 'skip — b.md']);
  });

  it('to-store turns disk-side work into skips', () => {
    const { actions } = plan(
      mapOf(file('a.md')),
      mapOf(file('b.md')),
      new Map(),
      opts({ direction: 'to-store' })
    );
    expect(shape(actions).sort()).toEqual(['create store b.md', 'skip — a.md']);
  });

  it('leaves conflicts visible in either direction', () => {
    const { actions } = plan(
      mapOf(file('ch.md', { sha256: SHA_A, lastModified: T1 })),
      mapOf(file('ch.md', { sha256: SHA_B, lastModified: T1 })),
      new Map(),
      opts({ direction: 'to-disk' })
    );
    expect(actions[0].kind).toBe('conflict');
  });
});

describe('character vault keystones', () => {
  const base = baseOf({ 'identity.md': { kind: 'file', sha256: SHA_A } });

  it('refuses to delete a keystone the operator removed from disk', () => {
    const { actions } = plan(mapOf(file('identity.md')), mapOf(), base, opts(), true);
    expect(actions[0].kind).toBe('conflict');
    expect(actions[0].reason).toContain('keystone');
  });

  it('names every keystone the vault writer guarantees', () => {
    expect(CHARACTER_VAULT_KEYSTONES).toEqual(expect.arrayContaining([
      'properties.json', 'identity.md', 'description.md',
      'manifesto.md', 'personality.md', 'example-dialogues.md',
      'wardrobe/instructions.md',
    ]));
  });

  it('deletes an ordinary vault file as usual', () => {
    const ordinary = baseOf({ 'notes/idea.md': { kind: 'file', sha256: SHA_A } });
    const { actions } = plan(mapOf(file('notes/idea.md')), mapOf(), ordinary, opts(), true);
    expect(shape(actions)).toEqual(['delete store notes/idea.md']);
  });

  it('applies no keystone rule to an ordinary document store', () => {
    const { actions } = plan(mapOf(file('identity.md')), mapOf(), base, opts(), false);
    expect(shape(actions)).toEqual(['delete store identity.md']);
  });
});

describe('hard-link groups', () => {
  const GROUP = 'group-0000-1111-2222';

  it('refreshes a sibling’s disk copy in the same run', () => {
    const store = mapOf(
      file('a.md', { sha256: SHA_A, lastModified: T0, linkGroupId: GROUP, linkId: 'link-a' }),
      file('b.md', { sha256: SHA_A, lastModified: T0, linkGroupId: GROUP, linkId: 'link-b' }),
    );
    const disk = mapOf(
      file('a.md', { sha256: SHA_B, lastModified: T2 }),   // edited on disk
      file('b.md', { sha256: SHA_A, lastModified: T0 }),
    );
    const { actions } = plan(store, disk);
    expect(shape(actions)).toEqual(['modify store a.md', 'modify disk b.md']);
    expect(actions[1].reason).toContain('hard-linked to a.md');
  });

  it('refuses when two members of one group were edited differently', () => {
    const store = mapOf(
      file('a.md', { sha256: SHA_A, lastModified: T0, linkGroupId: GROUP, linkId: 'link-a' }),
      file('b.md', { sha256: SHA_A, lastModified: T0, linkGroupId: GROUP, linkId: 'link-b' }),
    );
    const disk = mapOf(
      file('a.md', { sha256: SHA_B, lastModified: T2 }),
      file('b.md', { sha256: SHA_C, lastModified: T2 }),
    );
    const { actions, warnings } = plan(store, disk);
    expect(actions.filter(a => a.kind === 'conflict')).toHaveLength(2);
    expect(warnings.join(' ')).toContain('Hard-link group');
  });

  it('leaves an ungrouped pair of identical files alone', () => {
    const store = mapOf(
      file('a.md', { sha256: SHA_A, lastModified: T0, linkId: 'link-a' }),
      file('b.md', { sha256: SHA_A, lastModified: T0, linkId: 'link-b' }),
    );
    const disk = mapOf(
      file('a.md', { sha256: SHA_B, lastModified: T2 }),
      file('b.md', { sha256: SHA_A, lastModified: T0 }),
    );
    const { actions } = plan(store, disk);
    expect(shape(actions)).toEqual(['modify store a.md']);
  });
});

describe('ordering', () => {
  it('creates parents before children and the store before the disk', () => {
    const store = mapOf(file('deep/nested/leaf.md'));
    const disk = mapOf(file('other.md'));
    const { actions } = plan(store, disk);
    expect(shape(actions)).toEqual(['create store other.md', 'create disk deep/nested/leaf.md']);
  });

  it('puts folders before files at the same depth', () => {
    const store = mapOf(folder('lore'), file('top.md'));
    const { actions } = plan(store, mapOf());
    expect(shape(actions)).toEqual(['mkdir disk lore', 'create disk top.md']);
  });

  it('deletes children before their parents, and after everything else', () => {
    const base = baseOf({
      'drafts': { kind: 'folder' },
      'drafts/old.md': { kind: 'file', sha256: SHA_A },
      'new.md': { kind: 'file', sha256: SHA_A },
    });
    const store = mapOf(folder('drafts'), file('drafts/old.md'), file('fresh.md'));
    const { actions } = plan(store, mapOf(file('fresh.md')), base);
    expect(shape(actions)).toEqual([
      'delete store drafts/old.md',
      'rmdir store drafts',
    ]);
  });
});
