/**
 * Wearable Pool — everything one character can reach, read once per request.
 *
 * The four tiers a character dresses from, in precedence order:
 * **character > group > project > general**. The character's own vault, the
 * stores of every group the character belongs to (resolved here, per
 * character — never per chat), the chat's project stores (passed in, or
 * resolved from `chatId` behind the project roster), and Quilltap General.
 *
 * Every lookup the wardrobe needs is a walk over this in-memory pool: an item
 * by id, a composite's components to any depth, an item by title, "is this
 * mine". Nothing here re-reads a tier, so a two-level composite costs one read
 * per tier rather than a vault read per nesting level.
 *
 * A batch that dresses a whole cast against one chat shares the
 * character-independent tiers (project + General) through `sharedTiers`, so
 * they are read once for everyone.
 *
 * Server-only.
 *
 * @module lib/wardrobe/pool
 */

import { logger } from '@/lib/logger';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import {
  resolveGroupMountsForCharacter,
  resolveProjectMountPointIds,
} from '@/lib/mount-index/tiered-mount-pool';
import { rosterGatedProjectId } from '@/lib/projects/roster-access';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import {
  GENERAL_WARDROBE_ORIGIN,
  type WardrobeItemWithOrigin,
  type WardrobeOrigin,
} from '@/lib/wardrobe/wardrobe-container';

/** The shared mounts in scope for one character. */
export interface WardrobeTierMounts {
  /** Every store of every group the character belongs to, weakest first. */
  groupMountPointIds: string[];
  /** The chat's project stores. */
  projectMountPointIds: string[];
}

/** The character-independent tiers, archived included, each item tagged with its origin. */
export interface SharedTierItems {
  general: WardrobeItemWithOrigin[];
  project: WardrobeItemWithOrigin[];
}

export interface WearablePool {
  characterId: string;
  tiers: WardrobeTierMounts;
  /** Every reachable item, archived included, shadowed character > group > project > general. */
  byId: ReadonlyMap<string, WardrobeItemWithOrigin>;
  /**
   * What the character can actually wear: archived items dropped from each
   * tier *before* shadowing, so an archived personal copy never hides a
   * shared item. Filter (e.g. `isDefault`) after this, never before.
   */
  wearable(): WardrobeItemWithOrigin[];
  get(id: string): WardrobeItemWithOrigin | undefined;
  /** The ids found, in the order asked; unknown ids are skipped. */
  getMany(ids: readonly string[]): WardrobeItemWithOrigin[];
  /** Case-insensitive title match: the character's own items first (archived included), then the wearable shared set. */
  findByTitle(title: string): WardrobeItemWithOrigin | undefined;
  /** The one "is this mine" predicate: the item lives in this character's vault. */
  owns(item: Pick<WardrobeItem, 'id' | 'characterId'>): boolean;
}

export interface LoadWearablePoolOptions {
  /**
   * The operator is choosing on the character's behalf (the Salon's outfit
   * dialog), so the project roster does not apply. Character tool calls never
   * set this. Only consulted when the project tier is resolved from `chatId`.
   */
  operator?: boolean;
  /** Resolve the project tier from this chat when no project mounts are passed. */
  chatId?: string | null;
  /** Share the character-independent tiers across a batch (see {@link createSharedTierLoader}). */
  sharedTiers?: Promise<SharedTierItems>;
  /**
   * The character's own items, already read by the caller (the vault writer's
   * cycle check has just read the folder). Skips the vault read.
   */
  ownItems?: readonly WardrobeItem[];
}

/** Read a list of shared mounts weakest-first, tagging each item via `originOf`. */
async function readTier(
  repos: Pick<RepositoryContainer, 'wardrobe'>,
  mountPointIds: readonly string[],
  originOf: (mountPointId: string) => WardrobeOrigin,
): Promise<WardrobeItemWithOrigin[]> {
  if (mountPointIds.length === 0) return [];
  return repos.wardrobe.readSharedTiers(mountPointIds, true, originOf);
}

/** Read Quilltap General and the given project stores, archived included. */
export async function loadSharedTiers(
  repos: Pick<RepositoryContainer, 'wardrobe' | 'projects'>,
  projectMountPointIds: readonly string[],
  projectOrigin?: WardrobeOrigin,
): Promise<SharedTierItems> {
  const generalMountPointId = await getGeneralMountPointId();
  const [general, project] = await Promise.all([
    readTier(repos, generalMountPointId ? [generalMountPointId] : [], () => GENERAL_WARDROBE_ORIGIN),
    readTier(
      repos,
      projectMountPointIds,
      () => projectOrigin ?? { scope: 'project', id: null, name: 'Project' },
    ),
  ]);
  return { general, project };
}

/**
 * A memoised shared-tier read for a batch: the first character to ask pays
 * for it, everyone after reuses it. Lazy, so a batch that never needs a pool
 * never reads a tier.
 */
export function createSharedTierLoader(
  repos: Pick<RepositoryContainer, 'wardrobe' | 'projects'>,
  projectMountPointIds: readonly string[],
): () => Promise<SharedTierItems> {
  let pending: Promise<SharedTierItems> | null = null;
  return () => {
    if (!pending) {
      pending = loadSharedTiers(repos, projectMountPointIds).catch((error) => {
        logger.warn('[WearablePool] Failed to read shared wardrobe tiers; continuing without them', {
          projectMountCount: projectMountPointIds.length,
          context: 'wardrobe',
          error: error instanceof Error ? error.message : String(error),
        });
        return { general: [], project: [] };
      });
    }
    return pending;
  };
}

/**
 * The chat's project stores as this character may see them: none when the
 * chat has no project, or (unless `operator`) when the character is off the
 * project's roster (`lib/projects/roster-access.ts`). Fails soft to `[]`.
 */
export async function resolveProjectTierForChat(
  repos: Pick<RepositoryContainer, 'chats'>,
  chatId: string | null | undefined,
  characterId: string | null | undefined,
  options: { operator?: boolean } = {},
): Promise<string[]> {
  if (!chatId) return [];
  let projectId: string | null = null;
  try {
    const chat = await repos.chats.findById(chatId);
    projectId = chat?.projectId ?? null;
  } catch (error) {
    logger.warn('[WearablePool] Project lookup for chat failed', {
      chatId,
      context: 'wardrobe',
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
  if (!projectId) return [];
  const gated = options.operator ? projectId : await rosterGatedProjectId(projectId, characterId);
  if (!gated) {
    logger.debug('[WearablePool] Character off project roster — project wardrobe withheld', {
      chatId,
      projectId,
      characterId,
      context: 'wardrobe',
    });
    return [];
  }
  return resolveProjectMountPointIds(gated);
}

/** Shadow tiers weakest-first into one id map. */
function shadow(tiers: ReadonlyArray<readonly WardrobeItemWithOrigin[]>): Map<string, WardrobeItemWithOrigin> {
  const byId = new Map<string, WardrobeItemWithOrigin>();
  for (const tier of tiers) {
    for (const item of tier) byId.set(item.id, item);
  }
  return byId;
}

/**
 * Build a pool from tiers already in hand. Pure — the loader below and tests
 * both come through here, so the precedence and archived rules live once.
 */
export function buildWearablePool(
  characterId: string,
  tierMounts: WardrobeTierMounts,
  layers: {
    own: readonly WardrobeItemWithOrigin[];
    group: readonly WardrobeItemWithOrigin[];
    project: readonly WardrobeItemWithOrigin[];
    general: readonly WardrobeItemWithOrigin[];
  },
): WearablePool {
  const weakestFirst = [layers.general, layers.project, layers.group, layers.own];
  const byId = shadow(weakestFirst);
  let wearableCache: WardrobeItemWithOrigin[] | null = null;

  const wearable = (): WardrobeItemWithOrigin[] => {
    if (!wearableCache) {
      wearableCache = Array.from(
        shadow(weakestFirst.map((tier) => tier.filter((item) => !item.archivedAt))).values(),
      );
    }
    return wearableCache;
  };

  const ownIds = new Set(layers.own.map((item) => item.id));

  return {
    characterId,
    tiers: tierMounts,
    byId,
    wearable,
    get: (id) => byId.get(id),
    getMany: (ids) => {
      const out: WardrobeItemWithOrigin[] = [];
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const item = byId.get(id);
        if (item) out.push(item);
      }
      return out;
    },
    findByTitle: (title) => {
      const wanted = title.trim().toLowerCase();
      if (!wanted) return undefined;
      const own = layers.own.find((item) => item.title.toLowerCase() === wanted);
      if (own) return own;
      return wearable().find((item) => !ownIds.has(item.id) && item.title.toLowerCase() === wanted);
    },
    owns: (item) => item.characterId === characterId && ownIds.has(item.id),
  };
}

/**
 * Load a character's wearable pool. Pass the project tier when the caller
 * already holds it; otherwise give `chatId` and it is resolved (roster-gated)
 * here. The group tier is always resolved here. Each tier fails soft on its
 * own: one unreadable store narrows the pool, it never empties it.
 */
export async function loadWearablePool(
  repos: Pick<RepositoryContainer, 'wardrobe' | 'projects' | 'chats'>,
  characterId: string,
  projectMountPointIds?: readonly string[],
  opts: LoadWearablePoolOptions = {},
): Promise<WearablePool> {
  const projectIds =
    projectMountPointIds !== undefined
      ? Array.from(projectMountPointIds)
      : await resolveProjectTierForChat(repos, opts.chatId, characterId, { operator: opts.operator });

  const [groups, shared, own] = await Promise.all([
    resolveGroupMountsForCharacter(characterId),
    opts.sharedTiers ?? createSharedTierLoader(repos, projectIds)(),
    opts.ownItems
      ? Promise.resolve(Array.from(opts.ownItems))
      : repos.wardrobe.findByCharacterId(characterId, true).catch((error) => {
          logger.warn('[WearablePool] Failed to read the character wardrobe; using shared tiers alone', {
            characterId,
            context: 'wardrobe',
            error: error instanceof Error ? error.message : String(error),
          });
          return [] as WardrobeItem[];
        }),
  ]);

  const groupOriginByMount = new Map<string, WardrobeOrigin>();
  for (const { group, mountPointIds } of groups) {
    for (const mountPointId of mountPointIds) {
      groupOriginByMount.set(mountPointId, { scope: 'group', id: group.id, name: group.name });
    }
  }
  const groupMountPointIds = Array.from(groupOriginByMount.keys());
  const group = await readTier(repos, groupMountPointIds, (mp) => groupOriginByMount.get(mp)!).catch(
    (error) => {
      logger.warn('[WearablePool] Failed to read the group wardrobe tier; skipping it', {
        characterId,
        context: 'wardrobe',
        error: error instanceof Error ? error.message : String(error),
      });
      return [] as WardrobeItemWithOrigin[];
    },
  );

  const ownOrigin: WardrobeOrigin = { scope: 'character', id: characterId, name: '' };
  const pool = buildWearablePool(
    characterId,
    { groupMountPointIds, projectMountPointIds: projectIds },
    {
      own: own.map((item) => ({ ...item, characterId, origin: ownOrigin })),
      group,
      project: shared.project,
      general: shared.general,
    },
  );

  logger.debug('[WearablePool] Loaded wearable pool', {
    characterId,
    ownCount: own.length,
    groupCount: group.length,
    projectCount: shared.project.length,
    generalCount: shared.general.length,
    reachable: pool.byId.size,
    groupMountCount: groupMountPointIds.length,
    projectMountCount: projectIds.length,
    context: 'wardrobe',
  });
  return pool;
}

/**
 * Every item reachable from a set of root ids, transitively through
 * `componentItemIds` — a pure walk over the pool, for callers that want a
 * small lookup (a composite and its parts) rather than the whole pool.
 */
export function componentGraph(pool: WearablePool, rootIds: readonly string[]): Map<string, WardrobeItemWithOrigin> {
  const out = new Map<string, WardrobeItemWithOrigin>();
  const queue = [...rootIds];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (out.has(id)) continue;
    const item = pool.get(id);
    if (!item) continue;
    out.set(id, item);
    queue.push(...(item.componentItemIds ?? []));
  }
  return out;
}

/**
 * One pool per cast member for a chat, sharing the project and General reads
 * across the cast. Each character still sees only their own groups. The
 * operator is reading (the outfit summary), so the project roster doesn't
 * apply.
 */
export async function loadCastPools(
  repos: Pick<RepositoryContainer, 'wardrobe' | 'projects' | 'chats'>,
  projectId: string | null | undefined,
  characterIds: readonly string[],
): Promise<Map<string, WearablePool>> {
  const projectMountPointIds = await resolveProjectMountPointIds(projectId ?? null);
  const sharedTiers = createSharedTierLoader(repos, projectMountPointIds)();
  const pools = await Promise.all(
    characterIds.map((characterId) =>
      loadWearablePool(repos, characterId, projectMountPointIds, { sharedTiers }),
    ),
  );
  return new Map(characterIds.map((id, i) => [id, pools[i]]));
}
