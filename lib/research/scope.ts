/**
 * The research kit's scope — where a research tool may look (research kit §5.1).
 *
 * `resolveResearchScope` is the one place a tool context becomes a scope:
 *
 *  - the operator surface (`operatorSurface`) → `everything`: every enabled
 *    store, and the records (conversations, characters, groups, projects);
 *  - a pre-built mount pool (`mountPool`, the Scenario Builder) → `pool`:
 *    exactly the pool's stores, flattened with the participant tier; no records.
 *
 * Anything else refuses. A tool narrows with a `store` argument, resolved here
 * by name (case-insensitive — store names are one namespace) or by owner
 * shorthand (`character:Amy`, `project:The Estate`, `group:Estate Staff`,
 * `general`) through `resolveOwnerStore` (`lib/mount-index/reach.ts`). No tool
 * walks a tier by hand. A store outside the scope is "not found", with the
 * nearest names offered.
 *
 * @module lib/research/scope
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getRepositories } from '@/lib/repositories/factory'
import { getAccessibleMountPoints, type AccessibleMountPoint } from '@/lib/doc-edit/path-resolver'
import { flattenTierPool, type TieredMountPool } from '@/lib/mount-index/tiered-mount-pool'
import { classifyMount, resolveOwnerStore, type OwnerScope } from '@/lib/mount-index/reach'
import { foldName, nearestByName } from './text'

const logger = createServiceLogger('ResearchScope')

export type ResearchScope =
  | { kind: 'everything' } // operator surface
  | { kind: 'pool'; pool: TieredMountPool } // Scenario Builder

/** What a tool context carries that decides the scope. */
export interface ResearchScopeContext {
  userId: string
  operatorSurface?: boolean
  mountPool?: TieredMountPool
}

export type ScopeResolution =
  | { ok: true; scope: ResearchScope }
  | { ok: false; error: string }

/** The one door from a tool context to a research scope. */
export function resolveResearchScope(ctx: ResearchScopeContext): ScopeResolution {
  if (ctx.operatorSurface && ctx.mountPool) {
    return { ok: false, error: 'The tool context is misconfigured (operator surface and mount pool together).' }
  }
  if (ctx.operatorSurface) return { ok: true, scope: { kind: 'everything' } }
  if (ctx.mountPool) return { ok: true, scope: { kind: 'pool', pool: ctx.mountPool } }
  return { ok: false, error: 'The research tools are only available to the operator\'s surfaces.' }
}

/** A store in scope, with its owner when it has one. */
export interface ScopedStore extends AccessibleMountPoint {
  /** Owner kind and name for an official store (vault, project, group, General); null for a linked store. */
  owner: { scope: OwnerScope; name: string } | null
}

/** Every store the scope reaches. */
export async function storesInScope(scope: ResearchScope): Promise<AccessibleMountPoint[]> {
  return scope.kind === 'everything'
    ? getAccessibleMountPoints({ operatorOverride: true })
    : getAccessibleMountPoints({ mountPool: scope.pool })
}

/** The ids of every store the scope reaches, without loading the rows. */
export function poolMountIds(pool: TieredMountPool): string[] {
  return flattenTierPool(pool, { includeParticipants: true })
}

/** Attach each store's owner (raw reads; a broken owner costs a null). */
export async function withOwners(stores: AccessibleMountPoint[]): Promise<ScopedStore[]> {
  const repos = getRepositories()
  const out: ScopedStore[] = []
  for (const store of stores) {
    let owner: ScopedStore['owner'] = null
    try {
      const info = await classifyMount(store.id, repos)
      if (info) owner = { scope: info.scope, name: info.ownerName }
    } catch (error) {
      logger.debug('Store owner lookup failed', {
        mountPointId: store.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    out.push({ ...store, owner })
  }
  return out
}

export type StoreResolution =
  | { ok: true; store: AccessibleMountPoint }
  | { ok: false; error: string }

const OWNER_SHORTHAND = /^(character|project|group)\s*:\s*(.+)$/i

/** Find a character, project or group by name (case-insensitive), raw rows. */
async function findOwnerIdByName(kind: 'character' | 'project' | 'group', name: string): Promise<string | null> {
  const repos = getRepositories()
  const needle = foldName(name)
  const rows: Array<{ id: string; name: string; archivedAt?: string | null }> =
    kind === 'character'
      ? await repos.characters.findAllRaw()
      : kind === 'project'
        ? await repos.projects.findAllRaw()
        : await repos.groups.findAllRaw()
  const exact = rows.filter((r) => foldName(r.name) === needle || r.id === name.trim())
  const live = exact.filter((r) => !r.archivedAt)
  const pick = live[0] ?? exact[0]
  if (pick) return pick.id
  const partial = rows.filter((r) => foldName(r.name).includes(needle) && !r.archivedAt)
  return partial.length === 1 ? partial[0].id : null
}

/**
 * Resolve a `store` argument within the scope: a store name (or id), or an
 * owner shorthand. Out of scope or unknown → not found, with the nearest
 * names in scope.
 */
export async function resolveStoreArg(
  scope: ResearchScope,
  ref: string,
  userId: string,
): Promise<StoreResolution> {
  const stores = await storesInScope(scope)
  const trimmed = ref.trim()
  let targetId: string | null = null

  const shorthand = OWNER_SHORTHAND.exec(trimmed)
  if (/^general$/i.test(trimmed) || shorthand) {
    const kind = (shorthand ? shorthand[1].toLowerCase() : 'general') as OwnerScope
    const ownerId = kind === 'general' ? null : await findOwnerIdByName(kind as 'character' | 'project' | 'group', shorthand![2])
    if (kind === 'general' || ownerId) {
      const owned = await resolveOwnerStore(kind, ownerId, getRepositories(), userId, { archived: 'allow', context: 'research' })
      targetId = owned?.mountPointId ?? null
    }
  } else {
    const needle = foldName(trimmed)
    targetId = stores.find((s) => s.id === trimmed || foldName(s.name) === needle)?.id ?? null
  }

  const store = targetId ? stores.find((s) => s.id === targetId) : undefined
  if (store) {
    logger.debug('Research store resolved', { ref: trimmed, mountPointId: store.id, scope: scope.kind })
    return { ok: true, store }
  }
  const nearest = nearestByName(trimmed.replace(OWNER_SHORTHAND, '$2'), stores.map((s) => s.name), 3)
  logger.debug('Research store not found in scope', { ref: trimmed, scope: scope.kind, nearest })
  return {
    ok: false,
    error: `No store "${trimmed}" in reach.${nearest.length > 0 ? ` Nearest: ${nearest.map((n) => `"${n}"`).join(', ')}.` : ''} Call list_documents with no arguments for the list of stores.`,
  }
}
