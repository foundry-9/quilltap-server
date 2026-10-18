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
export async function readAllInventoryRecords(): Promise<MountedInventoryRecord[]> {
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

/** Find archetypes by id anywhere in the instance (the pool's parent fallback). */
export async function findRecordsAnywhere(ids: readonly string[]): Promise<Map<string, MountedInventoryRecord>> {
  const wanted = new Set(ids);
  const found = new Map<string, MountedInventoryRecord>();
  if (wanted.size === 0) return found;
  for (const entry of await readAllInventoryRecords()) {
    if (wanted.has(entry.record.id) && !found.has(entry.record.id)) found.set(entry.record.id, entry);
  }
  return found;
}

/** Who owns a mount: a character vault, a group or project store, or General. */
async function describeMount(
  mountPointId: string,
  generalMountPointId: string | null,
): Promise<Pick<InventoryDependent, 'scope' | 'ownerId' | 'ownerName' | 'ownerArchived'>> {
  if (mountPointId === generalMountPointId) {
    return { scope: 'general', ownerId: null, ownerName: 'Quilltap General', ownerArchived: false };
  }
  const repos = getRepositories();
  const character = await repos.characters.findByDocumentMountPointIdRaw(mountPointId);
  if (character) {
    return { scope: 'character', ownerId: character.id, ownerName: character.name, ownerArchived: !!character.archivedAt };
  }
  const project = (await repos.projects.findAll()).find((p) => p.officialMountPointId === mountPointId);
  if (project) return { scope: 'project', ownerId: project.id, ownerName: project.name, ownerArchived: false };
  const group = (await repos.groups.findAll()).find((g) => g.officialMountPointId === mountPointId);
  if (group) return { scope: 'group', ownerId: group.id, ownerName: group.name, ownerArchived: false };
  const mount = await repos.docMountPoints.findById(mountPointId);
  return { scope: 'unknown', ownerId: null, ownerName: mount?.name ?? null, ownerArchived: false };
}

/** Every instance of `archetypeId`, in every mount, tagged with its holder. */
export async function findDependents(archetypeId: string): Promise<InventoryDependent[]> {
  const dependents = (await readAllInventoryRecords()).filter(({ record }) => record.parentId === archetypeId);
  const generalMountPointId = await getGeneralMountPointId();
  const owners = new Map<string, Awaited<ReturnType<typeof describeMount>>>();
  const out: InventoryDependent[] = [];
  for (const { record, mountPointId } of dependents) {
    if (!owners.has(mountPointId)) owners.set(mountPointId, await describeMount(mountPointId, generalMountPointId));
    out.push({
      id: record.id,
      name: record.name ?? null,
      title: record.title ?? null,
      mountPointId,
      ...(owners.get(mountPointId) as Awaited<ReturnType<typeof describeMount>>),
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
