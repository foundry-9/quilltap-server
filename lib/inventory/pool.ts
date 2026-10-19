/**
 * Inventory Pool — everything one character can reach, read once per request.
 *
 * The four tiers in precedence order, **character > group > project >
 * general**: the character's own vault, the stores of every group the
 * character belongs to, the chat's (or a given project's) project stores, and
 * Quilltap General. Archived objects are dropped per tier *before* shadowing,
 * so an archived personal copy never hides a shared one. Every lookup outside
 * the writer is a walk over this.
 *
 * An archetype may live in a tier this pool cannot see (a character's
 * instance of a project archetype, read outside that project). Those parents
 * are fetched instance-wide in one extra read, so an instance resolves
 * wherever it is looked at; only a parent that exists nowhere resolves as
 * `parentMissing`.
 *
 * The v1 Inventory is the operator's alone, so no project roster gate applies
 * (the wardrobe's applies only to a character's own tool calls).
 *
 * Server-only.
 *
 * @module lib/inventory/pool
 */

import { logger } from '@/lib/logger';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import {
  resolveGroupMountsForCharacter,
  resolveProjectMountPointIds,
} from '@/lib/mount-index/tiered-mount-pool';
import { readMountInventory } from '@/lib/database/repositories/vault-overlay/inventory-writes';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { InventoryOrigin, InventoryRecord, ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { findRecordsAnywhere } from '@/lib/inventory/dependents';
import { GENERAL_INVENTORY_ORIGIN, type InventoryLocation } from '@/lib/inventory/location';
import { isKin, resolveItem, type InventoryRecordWithOrigin } from '@/lib/inventory/resolve';

export interface InventoryTierMounts {
  groupMountPointIds: string[];
  projectMountPointIds: string[];
}

/** A tier mount the pool could not read, and why. Fail-soft readers skip it; the title lint refuses on it. */
export interface UnreadInventoryMount {
  mountPointId: string;
  error: string;
}

export interface InventoryPool {
  /** The character whose reach this is; null for a shared tier's pool. */
  characterId: string | null;
  tiers: InventoryTierMounts;
  /** Every mount this pool read (or tried to), so an empty pool still says where it looked. */
  consultedMounts: readonly string[];
  /** Mounts whose records are missing from this pool because the read failed. */
  unreadMounts: readonly UnreadInventoryMount[];
  /** Every reachable record, archived included, shadowed by precedence. */
  byId: ReadonlyMap<string, InventoryRecordWithOrigin>;
  /** The holder's own tier's records (archived included). */
  own: readonly InventoryRecordWithOrigin[];
  /** Records with archived ones dropped per tier before shadowing. */
  reachable(): InventoryRecordWithOrigin[];
  get(id: string): InventoryRecordWithOrigin | undefined;
  /** True when the record lives in the holder's own tier. */
  owns(id: string): boolean;
  /** Resolve one record against this pool (and the out-of-pool parents). */
  resolve(record: InventoryRecord | InventoryRecordWithOrigin): ResolvedInventoryItem;
  /** Resolve the whole reachable (non-archived) pool. */
  resolved(): ResolvedInventoryItem[];
  /** Resolve by id (archived included); undefined when unknown. */
  resolveId(id: string): ResolvedInventoryItem | undefined;
}

type Layer = readonly InventoryRecordWithOrigin[];

function shadow(layers: readonly Layer[]): Map<string, InventoryRecordWithOrigin> {
  const byId = new Map<string, InventoryRecordWithOrigin>();
  for (const layer of layers) for (const record of layer) byId.set(record.id, record);
  return byId;
}

/**
 * Build a pool from tiers already in hand. Pure but for the parent map the
 * loader passes in; tests come through here too.
 */
export function buildInventoryPool(
  characterId: string | null,
  tiers: InventoryTierMounts,
  layers: { own: Layer; group: Layer; project: Layer; general: Layer },
  externalParents: ReadonlyMap<string, InventoryRecordWithOrigin> = new Map(),
  unreadMounts: readonly UnreadInventoryMount[] = [],
  consultedMounts: readonly string[] = [],
): InventoryPool {
  const weakestFirst = [layers.general, layers.project, layers.group, layers.own];
  const byId = shadow(weakestFirst);
  let reachableCache: InventoryRecordWithOrigin[] | null = null;
  const reachable = () => {
    reachableCache ??= Array.from(
      shadow(weakestFirst.map((layer) => layer.filter((record) => !record.archivedAt))).values(),
    );
    return reachableCache;
  };
  const ownIds = new Set(layers.own.map((record) => record.id));
  const lookup = (id: string) => byId.get(id) ?? externalParents.get(id);
  const warned = new Set<string>();
  const resolve = (record: InventoryRecord | InventoryRecordWithOrigin) => {
    const item = resolveItem(record, lookup);
    if (item.parentMissing && !warned.has(record.id)) {
      warned.add(record.id);
      logger.warn('[InventoryPool] Instance whose archetype exists nowhere; resolved to its own fields', {
        characterId,
        itemId: record.id,
        parentId: record.parentId,
        context: 'inventory',
      });
    }
    return item;
  };

  return {
    characterId,
    tiers,
    unreadMounts,
    consultedMounts,
    byId,
    own: layers.own,
    reachable,
    get: (id) => byId.get(id),
    owns: (id) => ownIds.has(id),
    resolve,
    resolved: () => reachable().map(resolve),
    resolveId: (id) => {
      const record = byId.get(id);
      return record ? resolve(record) : undefined;
    },
  };
}

/**
 * Read a list of mounts weakest-first, tagging each record. Fails soft per
 * mount, noting each failure in `unread` so a caller that must not guess can
 * tell "this tier is empty" from "this tier was not read".
 */
async function readTier(
  mountPointIds: readonly string[],
  originOf: (mountPointId: string) => InventoryOrigin,
  unread: UnreadInventoryMount[],
  consulted: string[],
): Promise<InventoryRecordWithOrigin[]> {
  const out: InventoryRecordWithOrigin[] = [];
  for (const mountPointId of mountPointIds) {
    consulted.push(mountPointId);
    try {
      const records = await readMountInventory({ mountPointId, scope: 'project', characterId: null });
      out.push(...records.map((record) => ({ ...record, origin: originOf(mountPointId), mountPointId })));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      unread.push({ mountPointId, error: message });
      logger.warn('[InventoryPool] Failed to read an Inventory tier; skipping it', {
        mountPointId,
        context: 'inventory',
        error: message,
      });
    }
  }
  return out;
}

/** The archetypes instances in the pool name that the pool itself cannot see. */
async function fetchExternalParents(
  layers: readonly Layer[],
): Promise<Map<string, InventoryRecordWithOrigin>> {
  const known = new Set(layers.flatMap((layer) => layer.map((record) => record.id)));
  const missing = new Set<string>();
  for (const layer of layers) {
    for (const record of layer) {
      if (record.parentId && !known.has(record.parentId)) missing.add(record.parentId);
    }
  }
  if (missing.size === 0) return new Map();
  const found = await findRecordsAnywhere(Array.from(missing));
  const out = new Map<string, InventoryRecordWithOrigin>();
  for (const [id, { record, mountPointId }] of found) {
    out.set(id, { ...record, origin: { scope: 'project', id: null, name: 'Elsewhere' }, mountPointId });
  }
  logger.debug('[InventoryPool] Fetched archetypes outside the pool', {
    wanted: missing.size,
    found: out.size,
    context: 'inventory',
  });
  return out;
}

export interface LoadInventoryPoolOptions {
  characterId: string;
  /** Resolve the project tier from this chat. */
  chatId?: string | null;
  /** Or name the project directly (no chat). */
  projectId?: string | null;
  /** The character's own records, already read. */
  ownRecords?: readonly InventoryRecord[];
}

/** The project's display name for its tier's origin; `'Project'` when it cannot be read. */
async function projectNameOf(
  repos: Partial<Pick<RepositoryContainer, 'projects'>>,
  projectId: string | null,
): Promise<string> {
  if (!projectId || !repos.projects) return 'Project';
  try {
    return (await repos.projects.findById(projectId))?.name || 'Project';
  } catch (error) {
    logger.warn('[InventoryPool] Project name lookup failed', {
      projectId,
      context: 'inventory',
      error: error instanceof Error ? error.message : String(error),
    });
    return 'Project';
  }
}

/**
 * Load a character's Inventory pool: own vault, groups, the project tier
 * (from `chatId` or `projectId`) and General. Each tier fails soft.
 */
export async function loadInventoryPool(
  repos: Pick<RepositoryContainer, 'characters' | 'chats'> & Partial<Pick<RepositoryContainer, 'projects'>>,
  opts: LoadInventoryPoolOptions,
): Promise<InventoryPool> {
  const { characterId } = opts;
  let projectId = opts.projectId ?? null;
  if (!projectId && opts.chatId) {
    try {
      projectId = (await repos.chats.findById(opts.chatId))?.projectId ?? null;
    } catch (error) {
      logger.warn('[InventoryPool] Project lookup for chat failed', {
        chatId: opts.chatId,
        context: 'inventory',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const character = await repos.characters.findByIdRaw(characterId);
  const ownMountPointId = character?.characterDocumentMountPointId ?? null;
  const [groups, projectMountPointIds, generalMountPointId, projectName] = await Promise.all([
    resolveGroupMountsForCharacter(characterId),
    resolveProjectMountPointIds(projectId),
    getGeneralMountPointId(),
    projectNameOf(repos, projectId),
  ]);
  const groupOriginByMount = new Map<string, InventoryOrigin>();
  for (const { group, mountPointIds } of groups) {
    for (const mountPointId of mountPointIds) {
      groupOriginByMount.set(mountPointId, { scope: 'group', id: group.id, name: group.name });
    }
  }
  const ownOrigin: InventoryOrigin = { scope: 'character', id: characterId, name: character?.name ?? '' };
  const projectOrigin: InventoryOrigin = { scope: 'project', id: projectId, name: projectName };

  const unread: UnreadInventoryMount[] = [];
  const consulted: string[] = opts.ownRecords && ownMountPointId ? [ownMountPointId] : [];
  const [own, group, project, general] = await Promise.all([
    opts.ownRecords
      ? Promise.resolve(opts.ownRecords.map((record) => ({ ...record, origin: ownOrigin, mountPointId: ownMountPointId ?? undefined })))
      : ownMountPointId
        ? readTier([ownMountPointId], () => ownOrigin, unread, consulted)
        : Promise.resolve([] as InventoryRecordWithOrigin[]),
    readTier(Array.from(groupOriginByMount.keys()), (mp) => groupOriginByMount.get(mp) as InventoryOrigin, unread, consulted),
    readTier(projectMountPointIds.filter((mp) => mp !== ownMountPointId), () => projectOrigin, unread, consulted),
    readTier(generalMountPointId ? [generalMountPointId] : [], () => GENERAL_INVENTORY_ORIGIN, unread, consulted),
  ]);
  const layers = { own, group, project, general };
  const pool = buildInventoryPool(
    characterId,
    { groupMountPointIds: Array.from(groupOriginByMount.keys()), projectMountPointIds },
    layers,
    await fetchExternalParents([own, group, project, general]),
    unread,
    consulted,
  );
  logger.debug('[InventoryPool] Loaded inventory pool', {
    characterId,
    chatId: opts.chatId ?? null,
    projectId,
    ownCount: own.length,
    groupCount: group.length,
    projectCount: project.length,
    generalCount: general.length,
    reachable: pool.byId.size,
    unread: unread.length,
    op: 'pool',
    context: 'inventory',
  });
  return pool;
}

/**
 * The pool a location writes against: a character's whole reach, or for a
 * shared tier its own folder plus Quilltap General (a project or group store
 * reaches General; General reaches only itself). What the instantiate picker
 * and a kit's member check walk.
 */
export async function loadPoolForLocation(
  repos: Pick<RepositoryContainer, 'characters' | 'chats'>,
  location: InventoryLocation,
  opts: { chatId?: string | null; projectId?: string | null } = {},
): Promise<InventoryPool> {
  if (location.characterId) {
    return loadInventoryPool(repos, { characterId: location.characterId, ...opts });
  }
  const own = (await location.readItems(true)).map((record) => ({
    ...record,
    origin: location.origin,
    mountPointId: location.mountPointId,
  }));
  const generalMountPointId = location.scope === 'general' ? null : await getGeneralMountPointId();
  const unread: UnreadInventoryMount[] = [];
  const consulted: string[] = [location.mountPointId];
  const general = generalMountPointId
    ? await readTier([generalMountPointId], () => GENERAL_INVENTORY_ORIGIN, unread, consulted)
    : [];
  const empty: InventoryRecordWithOrigin[] = [];
  return buildInventoryPool(
    null,
    { groupMountPointIds: [], projectMountPointIds: [] },
    { own, group: empty, project: empty, general },
    await fetchExternalParents([own, general]),
    unread,
    consulted,
  );
}

/** One pool per cast member for a chat. */
export async function loadCastInventoryPools(
  repos: Pick<RepositoryContainer, 'characters' | 'chats'>,
  chat: { id: string; projectId?: string | null },
  characterIds: readonly string[],
): Promise<Map<string, InventoryPool>> {
  const pools = await Promise.all(
    characterIds.map((characterId) =>
      loadInventoryPool(repos, { characterId, chatId: chat.id, projectId: chat.projectId ?? null }),
    ),
  );
  return new Map(characterIds.map((id, i) => [id, pools[i]]));
}

/** Reachable, equippable kin of `name` in the pool (resolved). */
export function kinOf(name: string, pool: InventoryPool): ResolvedInventoryItem[] {
  return pool.resolved().filter((item) => !item.isArchetype && item.kind !== 'kit' && isKin(item, { name }));
}
