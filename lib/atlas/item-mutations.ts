/**
 * Atlas mutations — the one way an Atlas entry is created, edited, archived,
 * duplicated, filed, copied or deleted. The routes call these, so the name
 * rule and the alias normalisation live once:
 *
 *   - within one tier a create or rename is refused (`NAME_TAKEN`, 409) when a
 *     non-archived entry there already has that canonical name,
 *     case-insensitively; restoring an archived entry into a clash is refused
 *     the same way. Alias overlaps are never refused (matching resolves them).
 *   - aliases are trimmed, de-duplicated case-insensitively and never repeat
 *     the name (`normalizeAtlasAliases`).
 *
 * Every mutation logs at `debug`; refusals at `info` with the code.
 *
 * Server-only.
 *
 * @module lib/atlas/item-mutations
 */

import { foldItemName } from '@/lib/mount-index/item-names';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import {
  normalizeAtlasAliases,
  type AtlasCreateBody,
  type AtlasRecord,
  type AtlasUpdateBody,
} from '@/lib/schemas/atlas.types';
import { archivedPatch } from '@/lib/wardrobe/archived-patch';
import { nextCopyTitle } from '@/lib/wardrobe/next-copy-title';
import {
  ATLAS_FOLDER_RULES,
  AtlasEntryNotInLocationError,
  AtlasFolderPathError,
  isSameFolder,
} from '@/lib/atlas/folders';
import { moveItemsToFolderIn, type ItemFolderKind } from '@/lib/mount-index/item-folder-location';
import { AtlasNameTakenError, AtlasRefusal, AtlasShapeError } from '@/lib/atlas/errors';
import type { AtlasLocation, AtlasWriteGuard } from '@/lib/atlas/location';
import { cleanupAtlasEntryImages } from '@/lib/atlas/item-images';

/** The Atlas's folder kind: its rules and its path error. */
export const ATLAS_FOLDER_KIND: ItemFolderKind = {
  rules: ATLAS_FOLDER_RULES,
  pathError: (message) => new AtlasFolderPathError(message),
};

function refuse(error: AtlasRefusal, meta: Record<string, unknown>): never {
  logger.info('[AtlasMutations] Refused', { code: error.code, message: error.message, ...meta, context: 'atlas' });
  throw error;
}

function logOp(op: string, location: AtlasLocation, meta: Record<string, unknown>): void {
  logger.debug(`[AtlasMutations] ${op}`, {
    op,
    scope: location.scope,
    mountPointId: location.mountPointId,
    ...meta,
    context: 'atlas',
  });
}

/** Text fields: an empty or whitespace-only value is no value. */
function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.replace(/\s+$/, '');
  return trimmed.trim().length > 0 ? trimmed : null;
}

/**
 * A write guard refusing when a live entry other than `selfId` already holds
 * `name` in this tier. It runs inside the folder's write chain (the
 * location's `guard`), so two concurrent creates of one name cannot both
 * pass it.
 */
function nameFree(name: string, selfId: string | null, meta: Record<string, unknown>): AtlasWriteGuard {
  const key = foldItemName(name);
  return (records) => {
    const clash = records.find((entry) => !entry.archivedAt && entry.id !== selfId && foldItemName(entry.name) === key);
    if (clash) refuse(new AtlasNameTakenError(name.trim(), clash.id), meta);
  };
}

// ============================================================================
// Create
// ============================================================================

export interface CreateAtlasEntryOptions {
  /** Keep an existing entry's identity and history (transfers). */
  preserve?: Pick<AtlasRecord, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<AtlasRecord, 'archivedAt' | 'imageFileId'>>;
}

/** Create an entry at a location. */
export async function createAtlasEntry(
  location: AtlasLocation,
  body: AtlasCreateBody,
  opts: CreateAtlasEntryOptions = {},
): Promise<AtlasRecord> {
  const name = body.name.trim();
  const meta = { scope: location.scope, mountPointId: location.mountPointId, op: 'create', name };
  if (!name) refuse(new AtlasShapeError('An entry needs a name'), meta);
  const guard = opts.preserve?.archivedAt ? undefined : nameFree(name, null, meta);
  const now = new Date().toISOString();
  const record: AtlasRecord = {
    id: opts.preserve?.id ?? randomUUID(),
    name,
    aliases: normalizeAtlasAliases(name, body.aliases),
    graphicPrompt: cleanText(body.graphicPrompt),
    knowledge: cleanText(body.knowledge),
    imageFileId: opts.preserve?.imageFileId ?? null,
    metadata: body.metadata ?? {},
    folder: body.folder ? await location.resolveFolder(body.folder) : '',
    archivedAt: opts.preserve?.archivedAt ?? null,
    createdAt: opts.preserve?.createdAt ?? now,
    updatedAt: opts.preserve?.updatedAt ?? now,
  };
  const stored = await location.create(record, { guard });
  logOp('Created entry', location, { entryId: stored.id, aliases: stored.aliases.length, folder: stored.folder });
  return stored;
}

// ============================================================================
// Update / archive
// ============================================================================

/** Patch an entry at its location. A rename (or restore) into a live name is `NAME_TAKEN`. */
export async function updateAtlasEntry(
  location: AtlasLocation,
  current: AtlasRecord,
  body: AtlasUpdateBody,
): Promise<AtlasRecord | null> {
  const meta = { scope: location.scope, mountPointId: location.mountPointId, entryId: current.id, op: 'update' };
  const { archived, folder, ...fields } = body;
  const patch: Partial<AtlasRecord> = {};
  if (fields.name !== undefined) {
    const name = fields.name.trim();
    if (!name) refuse(new AtlasShapeError('An entry needs a name'), meta);
    patch.name = name;
  }
  const nextName = patch.name ?? current.name;
  if (fields.aliases !== undefined || patch.name !== undefined) {
    patch.aliases = normalizeAtlasAliases(nextName, fields.aliases ?? current.aliases);
  }
  if (fields.graphicPrompt !== undefined) patch.graphicPrompt = cleanText(fields.graphicPrompt);
  if (fields.knowledge !== undefined) patch.knowledge = cleanText(fields.knowledge);
  if (fields.metadata !== undefined) patch.metadata = fields.metadata;
  if (body.imageFileId !== undefined) patch.imageFileId = body.imageFileId;
  if (folder !== undefined && !isSameFolder(folder, current.folder)) patch.folder = await location.resolveFolder(folder);
  if (archived !== undefined) {
    const stamp = archivedPatch(current.archivedAt, archived, new Date().toISOString());
    if (stamp) patch.archivedAt = stamp.archivedAt;
  }

  const liveAfter = !(patch.archivedAt !== undefined ? patch.archivedAt : current.archivedAt);
  const renamed = patch.name !== undefined && foldItemName(patch.name) !== foldItemName(current.name);
  const restored = patch.archivedAt === null && !!current.archivedAt;
  const guard = liveAfter && (renamed || restored) ? nameFree(nextName, current.id, meta) : undefined;

  const updated = await location.update(current.id, patch, { guard });
  logOp('Updated entry', location, { entryId: current.id, fields: Object.keys(patch), found: updated !== null });
  return updated;
}

/** Archive (or restore) an entry. Idempotent. */
export async function setAtlasEntryArchived(
  location: AtlasLocation,
  current: AtlasRecord,
  archived: boolean,
): Promise<{ entry: AtlasRecord | null; changed: boolean }> {
  const stamp = archivedPatch(current.archivedAt, archived, new Date().toISOString());
  if (!stamp) return { entry: current, changed: false };
  const guard = archived
    ? undefined
    : nameFree(current.name, current.id, {
        scope: location.scope,
        mountPointId: location.mountPointId,
        entryId: current.id,
        op: 'restore',
      });
  const entry = await location.update(current.id, stamp, { guard });
  logOp('Archive state changed', location, { entryId: current.id, archivedAt: stamp.archivedAt });
  return { entry, changed: entry !== null };
}

// ============================================================================
// Delete
// ============================================================================

/** Delete an entry and its pictures. */
export async function deleteAtlasEntry(
  repos: RepositoryContainer,
  location: AtlasLocation,
  current: AtlasRecord,
): Promise<{ deleted: boolean }> {
  const meta = { scope: location.scope, mountPointId: location.mountPointId, entryId: current.id, op: 'delete' };
  await location.writableMountPointId();
  const deleted = await location.delete([current.id]);
  if (deleted.length > 0) await cleanupAtlasEntryImages(repos, current.id, '[AtlasMutations]', meta);
  logOp('Deleted entry', location, { entryId: current.id, deleted: deleted.length > 0 });
  return { deleted: deleted.length > 0 };
}

// ============================================================================
// Copies and filing
// ============================================================================

/** The record a copy writes: a new id and timestamps, nothing archived, no picture. */
function copyRecord(source: AtlasRecord, folder: string, name?: string): AtlasRecord {
  const now = new Date().toISOString();
  return {
    ...source,
    id: randomUUID(),
    folder,
    ...(name !== undefined && { name, aliases: normalizeAtlasAliases(name, source.aliases) }),
    archivedAt: null,
    imageFileId: null,
    createdAt: now,
    updatedAt: now,
    fileStem: undefined,
  };
}

/** Duplicate one entry beside itself, named `(copy)`. */
export async function duplicateAtlasEntry(location: AtlasLocation, current: AtlasRecord): Promise<AtlasRecord> {
  const names = (await location.readEntries(true)).map((r) => r.name);
  const copy = copyRecord(current, current.folder ?? '', nextCopyTitle(current.name, names));
  const stored = await location.create(copy);
  logOp('Duplicated entry', location, { entryId: current.id, copyId: stored.id });
  return stored;
}

/** File several entries of this location into one folder (one projection). */
export function moveAtlasEntriesToFolder(
  location: AtlasLocation,
  entryIds: readonly string[],
  folder: string,
): Promise<AtlasRecord[]> {
  return moveItemsToFolderIn(ATLAS_FOLDER_KIND, location, entryIds, folder);
}

/**
 * Copy several entries of this location into one folder. A copy in the same
 * tier cannot keep its name (the name rule), so each is named `(copy)`.
 */
export async function copyAtlasEntriesToFolder(
  location: AtlasLocation,
  entryIds: readonly string[],
  folder: string,
): Promise<AtlasRecord[]> {
  const target = await location.resolveFolder(folder);
  const all = await location.readEntries(true);
  const records = new Map(all.map((r) => [r.id, r]));
  const uniqueIds = Array.from(new Set(entryIds));
  const missing = uniqueIds.filter((id) => !records.has(id));
  if (missing.length > 0) throw new AtlasEntryNotInLocationError(missing);
  const names = all.map((r) => r.name);
  const copies: AtlasRecord[] = [];
  for (const id of uniqueIds) {
    const source = records.get(id) as AtlasRecord;
    const name = nextCopyTitle(source.name, names);
    names.push(name);
    copies.push(await location.create(copyRecord(source, target, name)));
  }
  logOp('Copied entries to folder', location, { folder: target, count: copies.length });
  return copies;
}
