/**
 * Wardrobe containers — the four places a wardrobe item or outfit can live.
 *
 * A *container* is a browsable wardrobe location: a character's personal vault,
 * the singleton Quilltap General library, a project's document store, or a
 * group's document store. The wardrobe dialog's top selector picks one, and
 * every scoped mutation (create / edit / duplicate / star / delete) routes to
 * the container's own API endpoints via the URL helpers below.
 *
 * Client-safe: no server-only imports. Shared by the dialog, the item editor,
 * and the transfer dialog so the scope encoding can't drift between them.
 *
 * @module lib/wardrobe/wardrobe-container
 */

import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

export type WardrobeContainerScope = 'character' | 'general' | 'project' | 'group'

export interface WardrobeContainer {
  scope: WardrobeContainerScope
  /** Owning entity id — null only for the singleton `general` scope. */
  id: string | null
}

export const GENERAL_CONTAINER: WardrobeContainer = { scope: 'general', id: null }

/** Display name of the singleton General library, as an origin chip spells it. */
export const GENERAL_WARDROBE_NAME = 'Quilltap General'

/**
 * Which wardrobe a collection read found an item in. A read-time annotation
 * attached by the list endpoints on the way out — never persisted, never
 * exported, never accepted on create/update. A garment has no idea which
 * project it lives in; the read that found it does.
 */
export interface WardrobeOrigin {
  scope: WardrobeContainerScope
  /** Container id; null for `general`. */
  id: string | null
  /** Display name, resolved server-side. */
  name: string
}

/** The origin every Quilltap General read attaches. */
export const GENERAL_WARDROBE_ORIGIN: WardrobeOrigin = {
  scope: 'general',
  id: null,
  name: GENERAL_WARDROBE_NAME,
}

export type WardrobeItemWithOrigin = WardrobeItem & { origin: WardrobeOrigin }

/**
 * A listed item that may carry an origin — the prop type for list components,
 * which also render items from callers that never fetched through a
 * collection read (a fixture, an equipped id resolved from elsewhere).
 */
export type ListedWardrobeItem = WardrobeItem & { origin?: WardrobeOrigin }

/**
 * The one place the origin chip text is spelled. Returns null for a
 * character-owned item (a garment in its own vault is not "shared from"
 * anywhere) and for an item that arrived without an origin.
 */
export function wardrobeOriginLabel(origin: WardrobeOrigin | null | undefined): string | null {
  if (!origin) return null
  switch (origin.scope) {
    case 'general':
      return `Shared · ${GENERAL_WARDROBE_NAME}`
    case 'project':
      return `Project · ${origin.name}`
    case 'group':
      return `Group · ${origin.name}`
    case 'character':
      return null
  }
}

/** Tag every item in a collection read with the container it came from. */
export function withOrigin(
  items: readonly WardrobeItem[],
  origin: WardrobeOrigin,
): WardrobeItemWithOrigin[] {
  return items.map((item) => ({ ...item, origin }))
}

/**
 * The container a listed item is addressed through — where its item routes
 * (edit, star, archive, delete, picture) live. The `origin` the collection
 * read attached wins: a garment borrowed from a group or project is addressed
 * through that group or project, never through Quilltap General. Without an
 * origin (a fixture, an item resolved from elsewhere) a character-owned item
 * lives in its character's vault and anything else is taken for a General
 * archetype, the only shared tier that needs no id to address.
 */
export function containerForListedItem(
  item: Pick<WardrobeItem, 'characterId'> & { origin?: WardrobeOrigin | null },
): WardrobeContainer {
  if (item.origin) return { scope: item.origin.scope, id: item.origin.id }
  return item.characterId ? { scope: 'character', id: item.characterId } : GENERAL_CONTAINER
}

/**
 * One readable wardrobe tier: a container's own collection, or (with
 * `groups`) the merged group tier a character reaches, served by
 * `GET /api/v1/characters/[id]/wardrobe?scope=group`.
 */
export interface WardrobeTier {
  container: WardrobeContainer
  /** Character scope only: read the character's group tier instead of their vault. */
  groups?: boolean
}

/** Cache identity of a tier — the `tierKey` half of `queryKeys.wardrobe.list`. */
export function wardrobeTierKey(tier: WardrobeTier): string {
  return `${encodeWardrobeContainer(tier.container)}${tier.groups ? '|groups' : ''}`
}

/** Collection URL of a tier, honouring the archived opt-in. */
export function wardrobeTierUrl(tier: WardrobeTier, opts?: { includeArchived?: boolean }): string {
  if (!tier.groups) return wardrobeCollectionUrl(tier.container, opts)
  return withWardrobeArchivedParam(
    `${baseCollectionUrl(tier.container)}?scope=group`,
    opts?.includeArchived === true,
  )
}

/**
 * Merge tier lists into one pool, nearest first (character > group > project
 * > general); the first copy of an id wins.
 *
 * Without `includeArchived` this is `mergeWearableTiers`
 * (`lib/wardrobe/wearable-pool.ts`): archived items leave EACH tier before the
 * shadowing, so an archived personal copy never hides a live shared item of
 * the same id. With it (a "Show archived" view, the editor's candidate list,
 * a composite's resolution pool), the full per-tier lists are shadowed as they
 * stand.
 */
export function mergeWardrobeTiers<T extends Pick<WardrobeItem, 'id' | 'archivedAt'>>(
  tiers: ReadonlyArray<readonly T[] | undefined>,
  opts?: { includeArchived?: boolean },
): T[] {
  const includeArchived = opts?.includeArchived === true
  const seen = new Set<string>()
  const out: T[] = []
  for (const tier of tiers) {
    for (const item of tier ?? []) {
      if (!includeArchived && item.archivedAt) continue
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
  }
  return out
}

/** Serialize a container for use as a `<select>` option value (`scope:id`). */
export function encodeWardrobeContainer(container: WardrobeContainer): string {
  return `${container.scope}:${container.id ?? ''}`
}

/** Parse a `<select>` option value back into a container, or null if mangled. */
export function decodeWardrobeContainer(value: string): WardrobeContainer | null {
  const [scopeRaw, idRaw] = value.split(':', 2)
  if (
    scopeRaw !== 'character' &&
    scopeRaw !== 'general' &&
    scopeRaw !== 'project' &&
    scopeRaw !== 'group'
  ) {
    return null
  }
  const id = idRaw && idRaw.length > 0 ? idRaw : null
  if (scopeRaw !== 'general' && !id) return null
  return { scope: scopeRaw, id }
}

/** True when two containers name the same place. */
export function sameWardrobeContainer(
  a: WardrobeContainer | null | undefined,
  b: WardrobeContainer | null | undefined,
): boolean {
  if (!a || !b) return false
  return a.scope === b.scope && (a.id ?? null) === (b.id ?? null)
}

/**
 * Collection endpoint for a container (list with GET, create with POST).
 *
 * `opts.includeArchived` appends the opt-in every wardrobe list endpoint
 * honours. Building it here — the one place these URLs are spelled — is what
 * keeps the param from drifting, and means a caller that simply doesn't ask
 * gets the archived-free list by construction.
 */
export function wardrobeCollectionUrl(
  container: WardrobeContainer,
  opts?: { includeArchived?: boolean },
): string {
  return withWardrobeArchivedParam(baseCollectionUrl(container), opts?.includeArchived === true)
}

function baseCollectionUrl(container: WardrobeContainer): string {
  switch (container.scope) {
    case 'character':
      return `/api/v1/characters/${container.id}/wardrobe`
    case 'project':
      return `/api/v1/projects/${container.id}/wardrobe`
    case 'group':
      return `/api/v1/groups/${container.id}/wardrobe`
    case 'general':
      return '/api/v1/wardrobe'
  }
}

/** Append `?includeArchived=true` to any wardrobe URL, query string or not. */
export function withWardrobeArchivedParam(url: string, includeArchived: boolean): string {
  if (!includeArchived) return url
  return `${url}${url.includes('?') ? '&' : '?'}includeArchived=true`
}

/** Item endpoint for a container (GET / PUT / DELETE one item). */
export function wardrobeItemUrl(container: WardrobeContainer, itemId: string): string {
  return `${baseCollectionUrl(container)}/${itemId}`
}
