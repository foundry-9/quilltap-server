/**
 * Atlas Location — the one answer to "where does this entry live, and how do
 * I read and write there".
 *
 * A location is one tier's `Atlas/` folder: a character's vault, Quilltap
 * General, a project's official store or a group's official store. The
 * Inventory's surface without its archetype and kit operations: records, the
 * record operations, the folder operations and the tombstone-checked writable
 * mount.
 *
 * Every write that lands publishes the `atlas` realtime topic; a read never
 * does. `ensure: true` provisions a missing project/group store and its
 * `Atlas/` folder, for callers about to write. An archived character's
 * location still reads, but every write through it throws
 * `CharacterArchivedError`.
 *
 * Server-only.
 *
 * @module lib/atlas/location
 */

import { logger } from '@/lib/logger';
import {
  createAtlasFolderInMount,
  createAtlasInMount,
  deleteAtlasFolderInMount,
  deleteAtlasInMount,
  listAtlasFolderPathsInMount,
  listAtlasFoldersInMount,
  readMountAtlas,
  renameAtlasFolderInMount,
  resolveAtlasMount,
  updateAtlasManyInMount,
  type AtlasMount,
  type AtlasRecordPatch,
  type AtlasWriteGuard,
} from '@/lib/atlas/vault-writes';
import { resolveOwnerStore } from '@/lib/mount-index/reach';
import { cleanPatch, locationWriter } from '@/lib/mount-index/item-store';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { ATLAS_FOLDER, type AtlasOrigin, type AtlasRecord, type AtlasScope } from '@/lib/schemas/atlas.types';
import { resolveAtlasFolder, type AtlasFolder } from '@/lib/atlas/folders';
import type { ItemFolderLocation } from '@/lib/mount-index/item-folder-location';

export { AtlasScopeSchema, type AtlasScope } from '@/lib/schemas/atlas.types';
export { locationKey } from '@/lib/mount-index/item-folder-location';
export type { AtlasWriteGuard } from '@/lib/atlas/vault-writes';

/** What Quilltap General's entries are tagged with. */
export const GENERAL_ATLAS_ORIGIN: AtlasOrigin = { scope: 'general', id: null, name: 'Quilltap General' };

/** One Atlas tier's `Atlas/` folder. */
export interface AtlasLocation extends ItemFolderLocation {
  scope: AtlasScope;
  /** What a collection read tags this tier's entries with. */
  origin: AtlasOrigin;
  /** Every record in the folder; archived ones only when asked. */
  readEntries(includeArchived?: boolean): Promise<AtlasRecord[]>;
  /** One record from the folder (archived included), or null. */
  findEntry(id: string): Promise<AtlasRecord | null>;
  /** `guard` runs inside the folder's write chain against the current records; it throws to refuse. */
  create(record: AtlasRecord, opts?: { guard?: AtlasWriteGuard }): Promise<AtlasRecord>;
  update(id: string, patch: Partial<AtlasRecord>, opts?: { guard?: AtlasWriteGuard }): Promise<AtlasRecord | null>;
  updateMany(patches: AtlasRecordPatch[], opts?: { requireAll?: boolean; guard?: AtlasWriteGuard }): Promise<AtlasRecord[]>;
  delete(ids: readonly string[]): Promise<string[]>;
  listFolders(): Promise<AtlasFolder[]>;
}

/** Build a location over a folder. A character's mount is re-resolved at write time for the tombstone check. */
export function atlasLocationForMount(mount: AtlasMount, id: string | null, origin: AtlasOrigin): AtlasLocation {
  const { writableMount, write, nonEmpty } = locationWriter('atlas', mount, resolveAtlasMount);

  const updateMany: AtlasLocation['updateMany'] = (patches, opts) =>
    write((target) => updateAtlasManyInMount(target, patches.map((p) => ({ ...p, patch: cleanPatch(p.patch) })), opts), nonEmpty);

  return {
    scope: mount.scope,
    id,
    mountPointId: mount.mountPointId,
    characterId: mount.characterId,
    origin,
    async readEntries(includeArchived = false) {
      const records = await readMountAtlas(mount);
      return includeArchived ? records : records.filter((record) => !record.archivedAt);
    },
    async findEntry(entryId) {
      return (await readMountAtlas(mount)).find((record) => record.id === entryId) ?? null;
    },
    create: (record, opts) => write((target) => createAtlasInMount(target, record, opts)),
    async update(entryId, patch, opts) {
      const [updated] = await updateMany([{ id: entryId, patch }], opts);
      return updated ?? null;
    },
    updateMany,
    delete: (ids) => write((target) => deleteAtlasInMount(target, ids), nonEmpty),
    listFolders: () => listAtlasFoldersInMount(mount),
    async resolveFolder(requested) {
      if (!requested || !requested.trim()) return '';
      return resolveAtlasFolder(await listAtlasFolderPathsInMount(mount), requested);
    },
    createFolder: (path) => write((target) => createAtlasFolderInMount(target, path)),
    renameFolder: (path, newName) => write((target) => renameAtlasFolderInMount(target, path, newName)),
    deleteFolder: (path) => write((target) => deleteAtlasFolderInMount(target, path)),
    async writableMountPointId() {
      return (await writableMount()).mountPointId;
    },
  };
}

export interface ResolveAtlasLocationOptions {
  /** Provision a missing project/group store and its folder. For writers. */
  ensure?: boolean;
}

/**
 * Resolve `{ scope, id }` to a location, or null when the owner is missing
 * (or, for a character, not `userId`'s), when a non-General scope arrives
 * without an id, or when the store does not exist and `ensure` is off.
 */
export async function resolveAtlasLocation(
  scope: AtlasScope,
  id: string | null | undefined,
  repos: RepositoryContainer,
  userId: string,
  opts: ResolveAtlasLocationOptions = {},
): Promise<AtlasLocation | null> {
  const ensure = opts.ensure === true;
  const store = await resolveOwnerStore(scope, id ?? null, repos, userId, {
    ensure: ensure ? { folder: ATLAS_FOLDER, onFolderFailure: 'swallow' } : undefined,
    archived: 'allow',
    context: 'atlas',
  });
  let location: AtlasLocation | null = null;
  if (store?.scope === 'general') {
    location = atlasLocationForMount({ mountPointId: store.mountPointId, scope: 'general', characterId: null }, null, GENERAL_ATLAS_ORIGIN);
  } else if (store) {
    const ownerId = store.owner.id as string;
    location = atlasLocationForMount(
      { mountPointId: store.mountPointId, scope: store.scope, characterId: store.scope === 'character' ? ownerId : null },
      ownerId,
      { scope: store.scope, id: ownerId, name: store.owner.name },
    );
  }
  logger.debug('[AtlasLocation] Resolved atlas location', {
    scope,
    id: id ?? null,
    ensure,
    found: location !== null,
    mountPointId: location?.mountPointId ?? null,
    op: 'resolve',
    context: 'atlas',
  });
  return location;
}
