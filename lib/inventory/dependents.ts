/**
 * Inventory dependents — every instance of an archetype, instance-wide.
 *
 * An archetype may live in any tier and its instances in any other, so the
 * question "what derives from this?" is answered across **every** mount, not
 * a pool (spec §2). Deletion is rare, so there is no dependency table: one
 * `docMountDocuments` query reads every `Inventory/**\/*.json` in the
 * instance, and the records are parsed and filtered. The same read answers
 * the pool's fallback for an archetype outside the tiers it can see.
 *
 * Server-only.
 *
 * @module lib/inventory/dependents
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { INVENTORY_FOLDER, isInventoryItemDocumentPath } from '@/lib/inventory/folders';
import { parseInventoryItemFile } from '@/lib/database/repositories/vault-overlay/inventory-readers';
import type { InventoryRecord, InventoryScope } from '@/lib/schemas/inventory.types';

/** A record and the mount it was read from. */
export interface MountedInventoryRecord {
  record: InventoryRecord;
  mountPointId: string;
}

/** One instance of an archetype, wherever it lives. */
export interface InventoryDependent {
  id: string;
  name: string | null;
  title: string | null;
  mountPointId: string;
  scope: InventoryScope | 'unknown';
  /** The owning character, group or project id; null for General. */
  ownerId: string | null;
  ownerName: string | null;
  /** The owner is an archived character: its vault is a tombstone. */
  ownerArchived: boolean;
}

/** Every Inventory record in every mount, unresolved. */
async function readAllInventoryRecords(): Promise<MountedInventoryRecord[]> {
  const repos = getRepositories();
  const mounts = await repos.docMountPoints.findAll();
  if (mounts.length === 0) return [];
  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    mounts.map((m) => m.id),
    INVENTORY_FOLDER,
    '.json',
    { recursive: true },
  );
  const out: MountedInventoryRecord[] = [];
  for (const doc of docs) {
    if (!isInventoryItemDocumentPath(doc.relativePath)) continue;
    const record = parseInventoryItemFile(doc, { quiet: true });
    if (record) out.push({ record, mountPointId: doc.mountPointId });
  }
  logger.debug('[InventoryDependents] Read every Inventory record', {
    mountCount: mounts.length,
    recordCount: out.length,
    op: 'read-all',
    context: 'inventory',
  });
  return out;
}

/**
 * Find records by id anywhere in the instance (the pool's parent fallback).
 * Runs on the prompt and image paths, so it asks the index only for the
 * files that mention a wanted id and parses those, never the whole instance.
 */
export async function findRecordsAnywhere(ids: readonly string[]): Promise<Map<string, MountedInventoryRecord>> {
  const wanted = new Set(ids);
  const found = new Map<string, MountedInventoryRecord>();
  if (wanted.size === 0) return found;
  const docs = await getRepositories().docMountDocuments.findManyInFolderContaining(
    INVENTORY_FOLDER,
    '.json',
    Array.from(wanted),
  );
  const candidates = docs
    .filter((doc) => isInventoryItemDocumentPath(doc.relativePath))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  for (const doc of candidates) {
    const record = parseInventoryItemFile(doc, { quiet: true });
    if (record && wanted.has(record.id) && !found.has(record.id)) {
      found.set(record.id, { record, mountPointId: doc.mountPointId });
    }
  }
  logger.debug('[InventoryDependents] Found records by id across the instance', {
    wanted: wanted.size,
    candidates: candidates.length,
    found: found.size,
    op: 'find-anywhere',
    context: 'inventory',
  });
  return found;
}

type MountOwner = Pick<InventoryDependent, 'scope' | 'ownerId' | 'ownerName' | 'ownerArchived'>;

/** Answers "who owns this mount?" for one operation; see {@link mountOwnerResolver}. */
export type MountOwnerResolver = (mountPointId: string) => Promise<MountOwner>;

/**
 * Who owns a mount — a character vault, a group or project store, or General
 * — memoised for one operation. The project and group lists are read once,
 * on first need, however many mounts are asked about.
 */
export function mountOwnerResolver(): MountOwnerResolver {
  const repos = getRepositories();
  const owners = new Map<string, Promise<MountOwner>>();
  let general: Promise<string | null> | null = null;
  let projects: ReturnType<typeof repos.projects.findAll> | null = null;
  let groups: ReturnType<typeof repos.groups.findAll> | null = null;

  const describe = async (mountPointId: string): Promise<MountOwner> => {
    if (mountPointId === (await (general ??= getGeneralMountPointId()))) {
      return { scope: 'general', ownerId: null, ownerName: 'Quilltap General', ownerArchived: false };
    }
    const character = await repos.characters.findByDocumentMountPointIdRaw(mountPointId);
    if (character) {
      return { scope: 'character', ownerId: character.id, ownerName: character.name, ownerArchived: !!character.archivedAt };
    }
    const project = (await (projects ??= repos.projects.findAll())).find((p) => p.officialMountPointId === mountPointId);
    if (project) return { scope: 'project', ownerId: project.id, ownerName: project.name, ownerArchived: false };
    const group = (await (groups ??= repos.groups.findAll())).find((g) => g.officialMountPointId === mountPointId);
    if (group) return { scope: 'group', ownerId: group.id, ownerName: group.name, ownerArchived: false };
    const mount = await repos.docMountPoints.findById(mountPointId);
    return { scope: 'unknown', ownerId: null, ownerName: mount?.name ?? null, ownerArchived: false };
  };

  return (mountPointId) => {
    let owner = owners.get(mountPointId);
    if (!owner) {
      owner = describe(mountPointId);
      owners.set(mountPointId, owner);
    }
    return owner;
  };
}

/** Which tier a mount is, or null when it belongs to no Inventory owner. */
export async function mountScopeOf(
  mountPointId: string,
  ownerOf: MountOwnerResolver = mountOwnerResolver(),
): Promise<InventoryScope | null> {
  const owner = await ownerOf(mountPointId);
  return owner.scope === 'unknown' ? null : owner.scope;
}

/**
 * Whether an object living at `target` is within reach of a kit kept at
 * `kitMount`: its own tier, Quilltap General, and for a character's vault
 * the groups they belong to and any project (a project member is reached
 * in that project's chats).
 */
export async function isReachableFromKitTier(
  kitMountPointId: string,
  target: { mountPointId: string; scope: InventoryScope },
  ownerOf: MountOwnerResolver = mountOwnerResolver(),
): Promise<boolean> {
  if (target.mountPointId === kitMountPointId || target.scope === 'general') return true;
  const owner = await ownerOf(kitMountPointId);
  if (owner.scope !== 'character' || !owner.ownerId) return false;
  if (target.scope === 'project') return true;
  if (target.scope !== 'group') return false;
  const { groupLocationsForCharacter } = await import('@/lib/inventory/location');
  return (await groupLocationsForCharacter(owner.ownerId)).some((loc) => loc.mountPointId === target.mountPointId);
}

/**
 * The non-archived kits, anywhere, that name `itemId` and could not reach it
 * once it lives at `target` — what a move would strand.
 */
export async function findKitsStrandedByMove(
  itemId: string,
  target: { mountPointId: string; scope: InventoryScope },
): Promise<Array<{ id: string; name: string | null; ownerName: string | null; mountPointId: string }>> {
  const docs = await getRepositories().docMountDocuments.findManyInFolderContaining(INVENTORY_FOLDER, '.json', [itemId]);
  const ownerOf = mountOwnerResolver();
  const out: Array<{ id: string; name: string | null; ownerName: string | null; mountPointId: string }> = [];
  for (const doc of docs) {
    if (!isInventoryItemDocumentPath(doc.relativePath)) continue;
    const kit = parseInventoryItemFile(doc, { quiet: true });
    if (!kit || kit.kind !== 'kit' || kit.archivedAt || !(kit.itemIds ?? []).includes(itemId)) continue;
    if (await isReachableFromKitTier(doc.mountPointId, target, ownerOf)) continue;
    const owner = await ownerOf(doc.mountPointId);
    out.push({ id: kit.id, name: kit.title || kit.name || null, ownerName: owner.ownerName, mountPointId: doc.mountPointId });
  }
  logger.debug('[InventoryDependents] Checked kits a move would strand', {
    itemId,
    targetMountPointId: target.mountPointId,
    targetScope: target.scope,
    candidates: docs.length,
    stranded: out.length,
    op: 'kits-stranded',
    context: 'inventory',
  });
  return out;
}

/** Every instance of `archetypeId`, in every mount, tagged with its holder. */
export async function findDependents(archetypeId: string): Promise<InventoryDependent[]> {
  const dependents = (await readAllInventoryRecords()).filter(({ record }) => record.parentId === archetypeId);
  const ownerOf = mountOwnerResolver();
  const out: InventoryDependent[] = [];
  for (const { record, mountPointId } of dependents) {
    out.push({
      id: record.id,
      name: record.name ?? null,
      title: record.title ?? null,
      mountPointId,
      ...(await ownerOf(mountPointId)),
    });
  }
  logger.debug('[InventoryDependents] Found dependents', {
    itemId: archetypeId,
    count: out.length,
    archivedHolders: out.filter((d) => d.ownerArchived).length,
    op: 'dependents',
    context: 'inventory',
  });
  return out;
}
