/**
 * Atlas route factory — one implementation of the Atlas endpoints for all
 * four tiers, each route file a config:
 *
 *   - `/api/v1/characters/[id]/atlas` (+ `/[entryId]`) — a character's vault
 *   - `/api/v1/groups/[id]/atlas`     (+ `/[entryId]`) — a group's store
 *   - `/api/v1/projects/[id]/atlas`   (+ `/[entryId]`) — a project's store
 *   - `/api/v1/atlas`                 (+ `/[entryId]`) — Quilltap General
 *
 * Collection: `GET` lists the tier's entries (`?includeArchived`),
 * `?action=folders`, `?action=overlaps` (the terms this tier's entries share
 * with other reachable entries or with characters, for the editor's notices).
 * `POST` creates; `?action=duplicate`, `create-folder`, `rename-folder`,
 * `delete-folder`, `move-items`, `copy-items`.
 *
 * Item: `GET` one entry; `PUT` an edit (`archived` archives, `imageFileId`
 * picks the current picture); `DELETE`.
 *
 * The config shape, labels, resolver, read probe, `?action=folders`, the
 * folder write actions and the error mapping are the shared item-route
 * preamble (`lib/mount-index/item-folder-routes.ts`). No GET provisions a
 * store.
 *
 * @module lib/atlas/routes/atlas-route-factory
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, withActionDispatch } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { created, notFound, successResponse } from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import {
  atlasFolderPathBodySchema,
  createAtlasEntrySchema,
  duplicateAtlasEntrySchema,
  fileAtlasEntriesSchema,
  renameAtlasFolderSchema,
  updateAtlasEntrySchema,
  type AtlasOverlap,
  type AtlasRecord,
  type AtlasScope,
} from '@/lib/schemas/atlas.types';
import { itemRoutePreamble, type ItemRouteConfig, type ItemRouteKind } from '@/lib/mount-index/item-folder-routes';
import {
  ATLAS_FOLDER_KIND,
  copyAtlasEntriesToFolder,
  createAtlasEntry,
  deleteAtlasEntry,
  duplicateAtlasEntry,
  moveAtlasEntriesToFolder,
  updateAtlasEntry,
} from '@/lib/atlas/item-mutations';
import { assertAtlasImageChoice } from '@/lib/atlas/item-images';
import { resolveAtlasLocation, type AtlasLocation } from '@/lib/atlas/location';
import { loadAtlasPoolForLocation, withOrigin } from '@/lib/atlas/pool';
import { atlasTermsOf, foldAtlasTerm } from '@/lib/atlas/match';
import { ATLAS_ITEM_ERRORS } from '@/lib/atlas/routes/responses';

type Params = Record<string, string>;

/** An Atlas route file's config: the shared item-route shape. */
export type AtlasRouteConfig<P extends Params> = ItemRouteConfig<P, AtlasScope>;

const ATLAS_ROUTE_KIND: ItemRouteKind<AtlasLocation> = {
  folderKind: ATLAS_FOLDER_KIND,
  itemLabels: {
    character: 'Atlas entry',
    group: 'Group atlas entry',
    project: 'Project atlas entry',
    general: 'General atlas entry',
  },
  resolve: resolveAtlasLocation,
  errors: ATLAS_ITEM_ERRORS,
  folderSchemas: { path: atlasFolderPathBodySchema, rename: renameAtlasFolderSchema },
};

/**
 * The terms a tier's own entries share with other reachable entries or with
 * any workspace character's name or alias. Pure.
 */
export function computeAtlasOverlaps(
  own: readonly AtlasRecord[],
  reachable: ReadonlyArray<AtlasRecord & { origin?: AtlasOverlap['otherOrigin'] }>,
  people: ReadonlyArray<{ name: string; aliases?: readonly string[] | null }>,
): AtlasOverlap[] {
  const personByTerm = new Map<string, string>();
  for (const person of people) {
    for (const term of [person.name, ...(person.aliases ?? [])]) {
      if (term?.trim() && !personByTerm.has(foldAtlasTerm(term))) personByTerm.set(foldAtlasTerm(term), person.name);
    }
  }
  const holders = new Map<string, Array<AtlasRecord & { origin?: AtlasOverlap['otherOrigin'] }>>();
  for (const entry of reachable) {
    for (const term of atlasTermsOf(entry)) {
      const key = foldAtlasTerm(term);
      holders.set(key, [...(holders.get(key) ?? []), entry]);
    }
  }
  const out: AtlasOverlap[] = [];
  for (const entry of own) {
    if (entry.archivedAt) continue;
    for (const term of atlasTermsOf(entry)) {
      const key = foldAtlasTerm(term);
      const person = personByTerm.get(key);
      if (person) out.push({ term, entryId: entry.id, kind: 'character', otherName: person });
      for (const other of holders.get(key) ?? []) {
        if (other.id === entry.id) continue;
        out.push({ term, entryId: entry.id, kind: 'entry', otherName: other.name, otherOrigin: other.origin });
      }
    }
  }
  return out;
}

// ============================================================================
// Collection
// ============================================================================

export function createAtlasCollectionHandlers<P extends Params>(config: AtlasRouteConfig<P>) {
  const { logTag, logIdKey } = config;
  const preamble = itemRoutePreamble(ATLAS_ROUTE_KIND, config);
  const { labels, resolveLocation, probe, withErrors, folderActions } = preamble;

  async function handleList(req: NextRequest, ctx: RequestContext, params: P) {
    const probed = await probe(ctx, params);
    if (!probed.ok) return probed.response;
    const location = probed.location;
    if (!location) return successResponse({ mountPointId: null, entries: [] });
    const includeArchived = readIncludeArchived(req);
    const entries = (await location.readEntries(includeArchived)).map((record) => withOrigin(location, record));
    logger.debug(`${logTag} Listed atlas`, {
      [logIdKey]: location.id,
      mountPointId: location.mountPointId,
      count: entries.length,
      includeArchived,
      context: 'atlas',
    });
    return successResponse({ mountPointId: location.mountPointId, entries });
  }

  async function handleOverlaps(_req: NextRequest, ctx: RequestContext, params: P) {
    const probed = await probe(ctx, params);
    if (!probed.ok) return probed.response;
    const location = probed.location;
    if (!location) return successResponse({ overlaps: [] });
    const [own, reachable, people] = await Promise.all([
      location.readEntries(false),
      loadAtlasPoolForLocation(ctx.repos, location),
      ctx.repos.characters.findByUserId(ctx.user.id),
    ]);
    const overlaps = computeAtlasOverlaps(own, reachable, people.map((c) => ({ name: c.name, aliases: c.aliases ?? [] })));
    logger.debug(`${logTag} Computed atlas overlaps`, {
      [logIdKey]: location.id,
      entries: own.length,
      reachable: reachable.length,
      overlaps: overlaps.length,
      context: 'atlas',
    });
    return successResponse({ overlaps });
  }

  async function handleCreate(req: NextRequest, ctx: RequestContext, params: P) {
    // Parse before resolving: an invalid body must never provision a store.
    const body = createAtlasEntrySchema.parse(await req.json());
    const resolved = await resolveLocation(ctx, params, true);
    if (!resolved.ok) return resolved.response;
    const { location } = resolved;
    const record = await createAtlasEntry(location, body);
    logger.info(`${logTag} Created atlas entry`, {
      [logIdKey]: location.id,
      userId: ctx.user.id,
      mountPointId: location.mountPointId,
      entryId: record.id,
      context: 'atlas',
    });
    return created({ entry: withOrigin(location, record) });
  }

  async function handleFileEntries(action: 'move' | 'copy', req: NextRequest, ctx: RequestContext, params: P) {
    const body = fileAtlasEntriesSchema.parse(await req.json());
    const resolved = await resolveLocation(ctx, params, false);
    if (!resolved.ok) return resolved.response;
    const { location } = resolved;
    const records = action === 'move'
      ? await moveAtlasEntriesToFolder(location, body.entryIds, body.folder)
      : await copyAtlasEntriesToFolder(location, body.entryIds, body.folder);
    logger.info(`${logTag} ${action === 'move' ? 'Moved' : 'Copied'} atlas entries to folder`, {
      [logIdKey]: location.id,
      userId: ctx.user.id,
      folder: body.folder,
      count: records.length,
      context: 'atlas',
    });
    return successResponse({ entries: records.map((record) => withOrigin(location, record)) });
  }

  async function handleDuplicate(req: NextRequest, ctx: RequestContext, params: P) {
    const body = duplicateAtlasEntrySchema.parse(await req.json());
    const resolved = await resolveLocation(ctx, params, false);
    if (!resolved.ok) return resolved.response;
    const { location } = resolved;
    const current = await location.findEntry(body.entryId);
    if (!current) return notFound(labels.item);
    const record = await duplicateAtlasEntry(location, current);
    logger.info(`${logTag} Duplicated atlas entry`, { [logIdKey]: location.id, entryId: current.id, copyId: record.id, context: 'atlas' });
    return created({ entry: withOrigin(location, record) });
  }

  const GET = createContextParamsHandler<P>(
    withActionDispatch<P>({ folders: preamble.getFolders, overlaps: handleOverlaps }, handleList),
  );

  const POST = createContextParamsHandler<P>(
    withActionDispatch<P>(
      {
        ...folderActions,
        'move-items': withErrors((req: NextRequest, ctx: RequestContext, params: P) => handleFileEntries('move', req, ctx, params)),
        'copy-items': withErrors((req: NextRequest, ctx: RequestContext, params: P) => handleFileEntries('copy', req, ctx, params)),
        duplicate: withErrors(handleDuplicate),
      },
      withErrors(handleCreate),
    ),
  );

  return { GET, POST };
}

// ============================================================================
// Item
// ============================================================================

export function createAtlasItemHandlers<P extends Params & { entryId: string }>(config: AtlasRouteConfig<P>) {
  const { logTag, logIdKey } = config;
  const { labels, resolveLocation, withErrors } = itemRoutePreamble(ATLAS_ROUTE_KIND, config);

  async function findRecord(
    ctx: RequestContext,
    params: P,
  ): Promise<{ ok: true; location: AtlasLocation; record: AtlasRecord } | { ok: false; response: NextResponse }> {
    const resolved = await resolveLocation(ctx, params, false);
    if (!resolved.ok) return resolved;
    const record = await resolved.location.findEntry(params.entryId);
    if (!record) return { ok: false, response: notFound(labels.item) };
    return { ok: true, location: resolved.location, record };
  }

  const GET = createContextParamsHandler<P>(
    withActionDispatch<P>({}, async (_req: NextRequest, ctx: RequestContext, params: P) => {
      const found = await findRecord(ctx, params);
      if (!found.ok) return found.response;
      return successResponse({ entry: withOrigin(found.location, found.record) });
    }),
  );

  const PUT = createContextParamsHandler<P>(
    withActionDispatch<P>({}, withErrors(async (req: NextRequest, ctx: RequestContext, params: P) => {
      const found = await findRecord(ctx, params);
      if (!found.ok) return found.response;
      const body = updateAtlasEntrySchema.parse(await req.json());
      if (body.imageFileId !== undefined) await assertAtlasImageChoice(ctx.repos, found.record.id, body.imageFileId);
      const record = await updateAtlasEntry(found.location, found.record, body);
      if (!record) return notFound(labels.item);
      logger.info(`${logTag} Updated atlas entry`, {
        [logIdKey]: found.location.id,
        userId: ctx.user.id,
        entryId: found.record.id,
        context: 'atlas',
      });
      return successResponse({ entry: withOrigin(found.location, record) });
    })),
  );

  const DELETE = createContextParamsHandler<P>(
    withActionDispatch<P>({}, withErrors(async (_req: NextRequest, ctx: RequestContext, params: P) => {
      const found = await findRecord(ctx, params);
      if (!found.ok) return found.response;
      const result = await deleteAtlasEntry(ctx.repos, found.location, found.record);
      if (!result.deleted) return notFound(labels.item);
      logger.info(`${logTag} Deleted atlas entry`, {
        [logIdKey]: found.location.id,
        userId: ctx.user.id,
        entryId: found.record.id,
        context: 'atlas',
      });
      return successResponse({ success: true });
    })),
  );

  return { GET, PUT, DELETE };
}
