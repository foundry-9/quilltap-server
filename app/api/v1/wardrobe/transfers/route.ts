/**
 * Wardrobe transfer API.
 *
 * GET  /api/v1/wardrobe/transfers
 *   Returns destination options for moving/copying wardrobe items.
 *
 * POST /api/v1/wardrobe/transfers
 *   Moves or copies one wardrobe item between wardrobe tiers. For a composite
 *   (outfit), the optional `components` field brings its same-container
 *   components along — all or nothing — with the outfit's `componentItemIds`
 *   rewritten to the components' destination ids when copies mint fresh ones.
 *
 * The wear ledger (`wardrobe_wear_stats`) is keyed by item id and is never
 * written here: a move keeps the id, so the tally follows the garment for
 * free (the source-side delete goes straight to the store, not through
 * `cleanupEquippedRefs`, so it does not drop the rows); a copy mints a fresh
 * id and is a new garment whose ledger starts empty.
 *
 * Pictures (`Wardrobe/images/<itemId>/` in the source mount) travel with every
 * transferred item: a move re-links them into the destination mount at the
 * same path and re-points their `files` rows, dropping the source links once
 * the source item is gone; a copy links them under the copy's new id with
 * fresh `files` rows, and the copy's `imageFileId` points at its own copy.
 */

import { randomUUID } from 'crypto'
import { z } from 'zod'
import { createContextHandler } from '@/lib/api/middleware'
import { successResponse, badRequest, conflict, notFound, serverError } from '@/lib/api/responses'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'
import { logger } from '@/lib/logger'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { createItem } from '@/lib/wardrobe/item-mutations'
import {
  WardrobeScopeSchema,
  groupLocationsForCharacter,
  locationKey,
  resolveWardrobeLocation,
  type WardrobeLocation,
} from '@/lib/wardrobe/location'
import {
  carryItemImages,
  commitMovedImages,
  type PendingImageMove,
} from '@/lib/wardrobe/item-images'

type TransferAction = 'move' | 'copy'
/** What travels with a composite: its same-container components, or nothing. */
type ComponentMode = 'move' | 'copy' | 'none'

interface ResolvedSource {
  location: WardrobeLocation
  item: WardrobeItem
  /**
   * Every item in the source folder (the same list the item was found in).
   * Used to gather a composite's same-folder components so they can travel
   * with it — components living in *other* tiers stay put.
   */
  containerItems: WardrobeItem[]
}

const transferRequestSchema = z
  .object({
    action: z.enum(['move', 'copy']),
    itemId: z.string().min(1),
    /**
     * Character-view source hint: the item is probed across the character's
     * reachable tiers in precedence order (vault → groups → project → General). Kept for the
     * dialog's character view, where a merged item's home tier isn't known.
     */
    sourceCharacterId: z.string().min(1).optional(),
    sourceProjectId: z.string().nullable().optional(),
    /**
     * Explicit source container. Used when the dialog is browsing a shared
     * container directly (General / a project / a group), where there is no
     * selected character to probe from and the home tier is already known.
     */
    source: z
      .object({
        scope: WardrobeScopeSchema,
        id: z.string().optional(),
      })
      .optional(),
    destination: z.object({
      scope: WardrobeScopeSchema,
      id: z.string().optional(),
    }),
    /**
     * For a composite (outfit): what to do with the components that live in
     * the same source container. `move` relocates them (ids kept), `copy`
     * duplicates them at the destination (fresh ids; the transferred outfit's
     * `componentItemIds` are rewritten to match), `none`/omitted transfers the
     * outfit alone. All-or-nothing — no per-component picking. A `copy`
     * action refuses `components: 'move'` (it would strand the original).
     */
    components: z.enum(['move', 'copy', 'none']).optional(),
  })
  .refine((body) => Boolean(body.sourceCharacterId || body.source), {
    message: 'Either sourceCharacterId or source is required',
  })
  .refine((body) => !(body.action === 'copy' && body.components === 'move'), {
    message: 'Copying an outfit cannot move its components — the original outfit still needs them',
  })

/**
 * The transitive closure of a composite's components that live in the same
 * source container. Components from other tiers (e.g. a General archetype
 * bundled into a character outfit) are excluded — they are already shared and
 * stay where they are. Cycles are tolerated via the visited set (the write
 * layer refuses to store them, but old data gets no infinite loop here).
 */
function collectContainerComponents(
  outfit: WardrobeItem,
  containerItems: readonly WardrobeItem[],
): WardrobeItem[] {
  const byId = new Map(containerItems.map((i) => [i.id, i]))
  const visited = new Set<string>([outfit.id])
  const result: WardrobeItem[] = []
  const queue = [...outfit.componentItemIds]
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (visited.has(id)) continue
    visited.add(id)
    const item = byId.get(id)
    if (!item) continue
    result.push(item)
    queue.push(...item.componentItemIds)
  }
  return result
}

/**
 * Look `itemId` up in a location. The hit carries the folder's whole item list
 * so a composite's same-folder components can be gathered.
 */
async function findInLocation(
  location: WardrobeLocation,
  itemId: string,
): Promise<ResolvedSource | null> {
  const containerItems = await location.readItems(true)
  const item = containerItems.find((i) => i.id === itemId)
  if (!item) return null
  return { location, item, containerItems }
}

/**
 * Probe the tiers a character wears from, in precedence order — their vault,
 * then their groups' stores, then the project's, then General — for the item.
 * A probe only reads: a project store that doesn't exist yet is skipped, never
 * provisioned (bug 192).
 */
async function resolveSourceItem(
  userId: string,
  sourceCharacterId: string,
  sourceProjectId: string | null,
  itemId: string,
  repos: RepositoryContainer,
): Promise<ResolvedSource | null> {
  const personal = await resolveWardrobeLocation('character', sourceCharacterId, repos, userId)
  if (!personal) return null
  const own = await findInLocation(personal, itemId)
  if (own) return own

  // The source character is the one wearing the item, so their memberships
  // are the right scope — matching how the wearable pool resolves the tier.
  // Later group mounts shadow earlier ones, so probe strongest first.
  const groups = await groupLocationsForCharacter(sourceCharacterId)
  for (const group of groups.reverse()) {
    const hit = await findInLocation(group, itemId)
    if (hit) return hit
  }

  if (sourceProjectId) {
    const project = await resolveWardrobeLocation('project', sourceProjectId, repos, userId)
    if (project) {
      const hit = await findInLocation(project, itemId)
      if (hit) return hit
    }
  }

  const general = await resolveWardrobeLocation('general', null, repos, userId)
  return general ? findInLocation(general, itemId) : null
}

/**
 * Write a transferred item at the destination, keeping its identity, history,
 * provenance and archived state (`planned` already carries the id it lands as).
 */
function createAtDestination(destination: WardrobeLocation, planned: WardrobeItem): Promise<WardrobeItem> {
  return createItem(destination, planned, {
    preserve: {
      id: planned.id,
      createdAt: planned.createdAt,
      updatedAt: planned.updatedAt,
      archivedAt: planned.archivedAt ?? null,
      imageFileId: planned.imageFileId ?? null,
      migratedFromClothingRecordId: planned.migratedFromClothingRecordId ?? null,
    },
  })
}

export const GET = createContextHandler(async (_req, { user, repos }) => {
  try {
    const [projects, groups, characters] = await Promise.all([
      repos.projects.findAll(),
      repos.groups.findAll(),
      repos.characters.findByUserId(user.id),
    ])

    return successResponse({
      destinations: {
        general: { available: true, label: 'Quilltap General' },
        projects: projects
          .map((project) => ({ id: project.id, name: project.name || 'Untitled project' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        groups: groups
          .map((group) => ({ id: group.id, name: group.name || 'Untitled group' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        users: characters
          .map((character) => ({ id: character.id, name: character.name || 'Unnamed user' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    })
  } catch (error) {
    logger.error('[WardrobeTransfers v1] Failed to list destinations', {
      userId: user.id,
    }, error instanceof Error ? error : undefined)
    return serverError('Failed to load transfer destinations')
  }
})

export const POST = createContextHandler(async (req, { user, repos }) => {
  try {
    const body = transferRequestSchema.parse(await req.json())

    const explicit = body.source
      ? await resolveWardrobeLocation(body.source.scope, body.source.id, repos, user.id)
      : null
    const source = body.source
      ? explicit && (await findInLocation(explicit, body.itemId))
      : await resolveSourceItem(
          user.id,
          body.sourceCharacterId as string,
          body.sourceProjectId ?? null,
          body.itemId,
          repos,
        )
    if (!source) {
      return notFound('Wardrobe item')
    }

    const destination = await resolveWardrobeLocation(
      body.destination.scope,
      body.destination.id,
      repos,
      user.id,
      { ensure: true },
    )
    if (!destination) {
      return badRequest('Invalid destination')
    }

    if (locationKey(source.location) === locationKey(destination)) {
      return badRequest('Source and destination are the same')
    }

    const action = body.action as TransferAction
    const componentMode: ComponentMode = body.components ?? 'none'
    const now = new Date().toISOString()
    const destinationCharacterId = destination.characterId

    // The components travelling along: the transitive closure of the outfit's
    // components that live in the same source container. All-or-nothing.
    const travellingComponents =
      componentMode === 'none'
        ? []
        : collectContainerComponents(source.item, source.containerItems)

    // Plan every write up front so id remapping is consistent across the
    // whole set. Moves keep ids; copies mint fresh ones — and every
    // `componentItemIds` reference to a travelling component is rewritten to
    // that component's destination id, so the outfit still points at the very
    // pieces that made the journey with it.
    const idMap = new Map<string, string>()
    for (const component of travellingComponents) {
      idMap.set(component.id, componentMode === 'copy' ? randomUUID() : component.id)
    }
    const remapComponentIds = (ids: readonly string[]): string[] =>
      ids.map((id) => idMap.get(id) ?? id)

    const plannedComponents: WardrobeItem[] = travellingComponents.map((component) => ({
      ...component,
      id: idMap.get(component.id) as string,
      characterId: destinationCharacterId,
      componentItemIds: remapComponentIds(component.componentItemIds),
      createdAt: componentMode === 'copy' ? now : component.createdAt,
      updatedAt: componentMode === 'copy' ? now : component.updatedAt,
    }))

    const nextItem: WardrobeItem = {
      ...source.item,
      id: action === 'copy' ? randomUUID() : source.item.id,
      characterId: destinationCharacterId,
      componentItemIds: remapComponentIds(source.item.componentItemIds),
      createdAt: action === 'copy' ? now : source.item.createdAt,
      updatedAt: action === 'copy' ? now : source.item.updatedAt,
    }

    // Refuse the whole transfer before writing anything if any planned id is
    // already taken at the destination — all-or-nothing means no half-landed
    // outfits.
    const destinationItems = await destination.readItems(true)
    const destinationIds = new Set(destinationItems.map((item) => item.id))
    for (const planned of [nextItem, ...plannedComponents]) {
      if (destinationIds.has(planned.id)) {
        return badRequest(
          `An item with the ID of "${planned.title}" already exists at the destination`,
        )
      }
    }

    // A move writes to the source too (its item and its picture links go), so
    // its writable mount is resolved before anything is written: an archived
    // source character refuses here (the tombstone), not half-way through.
    if (action === 'move' || componentMode === 'move') {
      await source.location.writableMountPointId()
    }

    // Pictures are linked at the destination before the items land, so a
    // landed item's `imageFileId` never dangles. A copy's pointer is rewritten
    // to its own copied file; a move's rows are re-pointed only after the
    // source item is gone (commitMovedImages), so a failure before then leaves
    // the source whole.
    const destinationMountPointId = await destination.writableMountPointId()
    const travellers: Array<{ original: WardrobeItem; planned: WardrobeItem; mode: 'move' | 'copy' }> = [
      ...travellingComponents.map((component, i) => ({
        original: component,
        planned: plannedComponents[i],
        mode: (componentMode === 'copy' ? 'copy' : 'move') as 'move' | 'copy',
      })),
      { original: source.item, planned: nextItem, mode: action },
    ]
    const pendingImageMoves: Array<{ itemId: string; pending: PendingImageMove }> = []
    for (const traveller of travellers) {
      const { fileIdMap, pendingMove } = await carryItemImages(repos, {
        mode: traveller.mode,
        sourceItemId: traveller.original.id,
        destinationItemId: traveller.planned.id,
        destinationMountPointId,
        userId: user.id,
      })
      const currentImage = traveller.original.imageFileId
      traveller.planned.imageFileId = currentImage ? fileIdMap.get(currentImage) ?? null : null
      if (traveller.mode === 'move') {
        pendingImageMoves.push({ itemId: traveller.original.id, pending: pendingMove })
      }
    }

    // Components land first so the outfit's references resolve the moment it
    // arrives; the write layer tolerates missing components, but there is no
    // reason to create that window.
    for (const planned of plannedComponents) {
      await createAtDestination(destination, planned)
    }
    const stored = await createAtDestination(destination, nextItem)

    if (action === 'move') {
      // `components: 'copy'` leaves the originals at the source (they were
      // duplicated, not relocated); only `'move'` removes them.
      if (componentMode === 'move') {
        for (const component of travellingComponents) {
          const removed = await source.location.delete(component.id)
          if (!removed) {
            return serverError('Failed to remove a component from source after move')
          }
        }
      }
      const removed = await source.location.delete(source.item.id)
      if (!removed) {
        return serverError('Failed to remove item from source after move')
      }
    }

    // The moved items' source-side picture links go once their items have.
    for (const { itemId, pending } of pendingImageMoves) {
      await commitMovedImages(repos, itemId, pending)
    }

    // Post-write verification: read the outfit BACK from the destination and
    // check that its component references survived the storage round-trip
    // exactly as planned — the vault serializes references as title slugs, so
    // a subtle resolution bug shows up here, not in the pre-projection value
    // `createAtDestination` returned. Anything planned-but-absent from the
    // read-back list is reported.
    const afterItems = await destination.readItems(true)
    const afterOutfit = afterItems.find((item) => item.id === stored.id)
    const readBackIds = new Set(afterOutfit?.componentItemIds ?? [])
    const unresolvedComponentIds = nextItem.componentItemIds.filter(
      (id) => !readBackIds.has(id),
    )
    if (!afterOutfit || unresolvedComponentIds.length > 0) {
      logger.error('[WardrobeTransfers v1] Transferred outfit did not read back with its planned component references', {
        userId: user.id,
        outfitId: stored.id,
        outfitFoundAtDestination: Boolean(afterOutfit),
        plannedComponentIds: nextItem.componentItemIds,
        readBackComponentIds: afterOutfit?.componentItemIds ?? [],
        unresolvedComponentIds,
        destinationScope: destination.scope,
        destinationMountPointId: destination.mountPointId,
      })
    }

    logger.info('[WardrobeTransfers v1] Wardrobe item transferred', {
      userId: user.id,
      action,
      componentMode,
      itemId: source.item.id,
      resultItemId: stored.id,
      componentsTransferred: plannedComponents.length,
      sourceScope: source.location.scope,
      destinationScope: destination.scope,
      sourceCharacterId: source.location.characterId,
      destinationCharacterId: destination.characterId,
      sourceMountPointId: source.location.mountPointId,
      destinationMountPointId: destination.mountPointId,
    })

    return successResponse({
      wardrobeItem: stored,
      action,
      componentsTransferred: plannedComponents.length,
      ...(unresolvedComponentIds.length > 0 ? { unresolvedComponentIds } : {}),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.issues.map((issue) => issue.message).join('; '))
    }
    if (error instanceof CharacterArchivedError) {
      return conflict('An archived character\'s wardrobe cannot be changed')
    }
    logger.error('[WardrobeTransfers v1] Failed to transfer item', {}, error instanceof Error ? error : undefined)
    return serverError('Failed to transfer wardrobe item')
  }
})
