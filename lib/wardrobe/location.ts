/**
 * Wardrobe Location — the one answer to "where does this item live, and how
 * do I read and write there".
 *
 * A location is one wardrobe tier's `Wardrobe/` folder: a character's vault,
 * Quilltap General, a project's official store or a group's official store.
 * It always carries the backing mount, the origin a collection read tags its
 * items with, and the five operations every caller needs. Routes, transfers,
 * item pictures and the tools all address a tier through this; nobody
 * switches on scope to pick a writer, and nobody passes an owner-id hint.
 *
 * Provisioning is opt-in: `ensure: true` creates a project/group store and
 * its `Wardrobe/` folder when missing, and is for callers about to write. A
 * read probe passes `false` and gets null for a store that doesn't exist yet.
 *
 * The archived-character tombstone stays where it lives
 * (`resolveWardrobeMount` throws `CharacterArchivedError`): an archived
 * character's location still reads, but every write through it — and
 * `writableMountPointId()`, for writers that touch the folder some other way —
 * throws.
 *
 * Server-only.
 *
 * @module lib/wardrobe/location
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import {
  createInMount,
  deleteInMount,
  readMountItems,
  resolveWardrobeMount,
  updateInMount,
  type WardrobeMount,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { ensureOwnerOfficialStore } from '@/lib/mount-index/ensure-owner-store';
import { ensureSharedWardrobeFolder } from '@/lib/mount-index/shared-wardrobe';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import {
  GENERAL_WARDROBE_ORIGIN,
  type WardrobeOrigin,
} from '@/lib/wardrobe/wardrobe-container';

/** The four wardrobe tiers, as a Zod enum for request bodies. */
export const WardrobeScopeSchema = z.enum(['character', 'group', 'project', 'general']);
export type WardrobeScope = z.infer<typeof WardrobeScopeSchema>;

export interface WardrobeLocation {
  scope: WardrobeScope;
  /** Owner id; null for General. */
  id: string | null;
  /** The mount holding the `Wardrobe/` folder — always set, every tier. */
  mountPointId: string;
  /** The owning character — `character` scope only. */
  characterId: string | null;
  /** What a collection read tags this tier's items with. */
  origin: WardrobeOrigin;
  /** Every item in the folder; archived ones only when asked. */
  readItems(includeArchived?: boolean): Promise<WardrobeItem[]>;
  /** One item from the folder (archived included), or null. */
  findItem(id: string): Promise<WardrobeItem | null>;
  create(item: WardrobeItem): Promise<WardrobeItem>;
  update(id: string, patch: Partial<WardrobeItem>): Promise<WardrobeItem | null>;
  delete(id: string): Promise<boolean>;
  /**
   * The mount, checked for writing: throws `CharacterArchivedError` for an
   * archived character. For writers that reach the folder without going
   * through create/update/delete (dressing instructions, item pictures).
   */
  writableMountPointId(): Promise<string>;
}

export interface ResolveWardrobeLocationOptions {
  /** Provision a missing project/group store and its folder. For writers. */
  ensure?: boolean;
}

/** A key that names one folder, for "same source and destination?" checks. */
export function locationKey(loc: Pick<WardrobeLocation, 'scope' | 'mountPointId'>): string {
  return `${loc.scope}:${loc.mountPointId}`;
}

/**
 * Build a location over a folder. Writes re-resolve a character's mount at
 * write time so the tombstone check sees the character as it is now.
 */
export function locationForMount(
  mount: WardrobeMount,
  id: string | null,
  origin: WardrobeOrigin,
): WardrobeLocation {
  const writableMount = async (): Promise<WardrobeMount> => {
    if (mount.scope !== 'character') return mount;
    const current = await resolveWardrobeMount(mount.characterId);
    if (!current) throw new Error(`Character ${mount.characterId} has no linked vault`);
    return current;
  };

  return {
    scope: mount.scope,
    id,
    mountPointId: mount.mountPointId,
    characterId: mount.characterId,
    origin,
    async readItems(includeArchived = false) {
      const items = await readMountItems(mount);
      return includeArchived ? items : items.filter((item) => !item.archivedAt);
    },
    async findItem(itemId) {
      return (await readMountItems(mount)).find((item) => item.id === itemId) ?? null;
    },
    async create(item) {
      return createInMount(await writableMount(), item);
    },
    async update(itemId, patch) {
      const rest = { ...patch };
      delete rest.id;
      delete rest.createdAt;
      delete rest.updatedAt;
      return updateInMount(await writableMount(), itemId, rest);
    },
    async delete(itemId) {
      return deleteInMount(await writableMount(), itemId);
    },
    async writableMountPointId() {
      return (await writableMount()).mountPointId;
    },
  };
}

/**
 * Resolve `{ scope, id }` to a location, or null when the owner is missing
 * (or, for a character, not `userId`'s), when a non-General scope arrives
 * without an id, or when the backing store doesn't exist and `ensure` is off
 * (or can't be provisioned).
 */
export async function resolveWardrobeLocation(
  scope: WardrobeScope,
  id: string | null | undefined,
  repos: RepositoryContainer,
  userId: string,
  opts: ResolveWardrobeLocationOptions = {},
): Promise<WardrobeLocation | null> {
  const location = await resolve(scope, id ?? null, repos, userId, opts.ensure === true);
  logger.debug('[WardrobeLocation] Resolved wardrobe location', {
    scope,
    id: id ?? null,
    ensure: opts.ensure === true,
    found: location !== null,
    mountPointId: location?.mountPointId ?? null,
    context: 'wardrobe',
  });
  return location;
}

async function resolve(
  scope: WardrobeScope,
  id: string | null,
  repos: RepositoryContainer,
  userId: string,
  ensure: boolean,
): Promise<WardrobeLocation | null> {
  if (scope === 'general') {
    const mountPointId = await getGeneralMountPointId();
    if (!mountPointId) return null;
    if (ensure) await ensureSharedWardrobeFolder(mountPointId);
    return locationForMount(
      { mountPointId, scope: 'general', characterId: null },
      null,
      GENERAL_WARDROBE_ORIGIN,
    );
  }

  if (!id) return null;

  if (scope === 'character') {
    const character = await repos.characters.findByIdRaw(id);
    if (!character || character.userId !== userId) return null;
    const mountPointId = character.characterDocumentMountPointId;
    if (!mountPointId) return null;
    return locationForMount(
      { mountPointId, scope: 'character', characterId: character.id },
      character.id,
      { scope: 'character', id: character.id, name: character.name },
    );
  }

  const owner =
    scope === 'project' ? await repos.projects.findById(id) : await repos.groups.findById(id);
  if (!owner) return null;
  const name = owner.name || (scope === 'project' ? 'Project' : 'Group');

  let mountPointId: string | null = null;
  if (ensure) {
    const ensured = await ensureOwnerOfficialStore(scope, owner.id, name);
    if (!ensured) return null;
    mountPointId = ensured.mountPointId;
    await ensureSharedWardrobeFolder(mountPointId);
  } else {
    mountPointId = owner.officialMountPointId ?? null;
  }
  if (!mountPointId) return null;

  return locationForMount(
    { mountPointId, scope, characterId: null },
    owner.id,
    { scope, id: owner.id, name: owner.name },
  );
}

/**
 * Every group store a character can wear from, as locations — one per mount,
 * each tagged with its group's origin, in the order the group tier shadows
 * (later wins). The read probe the transfer route and the pool both use.
 */
export async function groupLocationsForCharacter(characterId: string): Promise<WardrobeLocation[]> {
  const { resolveGroupMountsForCharacter } = await import('@/lib/mount-index/tiered-mount-pool');
  const groups = await resolveGroupMountsForCharacter(characterId);
  return groups.flatMap(({ group, mountPointIds }) =>
    mountPointIds.map((mountPointId) =>
      locationForMount(
        { mountPointId, scope: 'group', characterId: null },
        group.id,
        { scope: 'group', id: group.id, name: group.name },
      ),
    ),
  );
}
