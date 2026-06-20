/**
 * Tiered Mount Pool — single source of truth for the "tri-tier" content pattern.
 *
 * Several features read content from up to five tiers of document stores,
 * ranked by how "close" the store is to the responding character:
 *
 *   1. character — the responding character's own vault
 *   2. participant — the vaults of the OTHER characters present in a chat
 *      (multi-character document access only; not a search/knowledge tier)
 *   3. group — the official + linked stores of every group the RESPONDING
 *      character is a member of (per-character, NOT per-chat — a character never
 *      gains a co-participant's group stores)
 *   4. project — every store linked to the active chat's project
 *   5. global — the singleton "Quilltap General" mount
 *
 * Knowledge injection (`lib/chat/context/knowledge-injector.ts`), the
 * scriptorium search tool (`lib/tools/handlers/search-scriptorium-handler.ts`),
 * wardrobe resolution (`lib/database/repositories/wardrobe.repository.ts`), and
 * the document-edit path resolver (`lib/doc-edit/path-resolver.ts`) all used to
 * re-derive this triple with their own (subtly divergent) dedup rules. This
 * module consolidates that logic so:
 *
 *   - the dedup order is defined exactly once (`dedupeTierTriple`);
 *   - the resolution (DB lookups, ownership gate, participant vaults, graceful
 *     global-null) lives in one place (`resolveTieredMountPool`);
 *   - features can test mount membership uniformly (`classifyMountTier`,
 *     `flattenTierPool`).
 *
 * @module mount-index/tiered-mount-pool
 */

import { getGeneralMountPointId } from '@/lib/instance-settings';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';

const errMsg = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Which tier a given mount point belongs to within a resolved pool. */
export type MountTier = 'character' | 'participant' | 'group' | 'project' | 'global';

/**
 * The inputs needed to resolve a pool. Provide ids; the helper does the DB
 * lookups. `characterMountPointId` may be passed pre-resolved to skip the
 * character lookup on hot paths (ignored when `requireOwnership` forces a
 * lookup).
 */
export interface TierContext {
  /**
   * Calling user. Required only when `requireOwnership` is set — the ownership
   * gate fails closed (excludes the character vault) when this is absent.
   */
  userId?: string;
  /** Responding character id — resolved to its vault mount. */
  characterId?: string | null;
  /**
   * Pre-resolved responding-character vault mount. Used as a fast path by
   * callers that already hold the character object. Ignored when
   * `requireOwnership` is set (ownership demands a fresh lookup).
   */
  characterMountPointId?: string | null;
  /**
   * Other character ids whose vaults should be admitted as the `participant`
   * tier. Only consulted when `includeParticipants` is set.
   */
  characterIds?: string[];
  /** Active chat's project id — resolved to its linked store mounts. */
  projectId?: string | null;
}

export interface TierResolveOptions {
  /**
   * Gate the character vault on ownership: only admit it when the character's
   * `userId` matches the context `userId`. Used by character tool handlers
   * (the scriptorium search). Off by default — callers that already vetted the
   * character (the per-turn context builder) skip the extra lookup.
   */
  requireOwnership?: boolean;
  /**
   * Resolve `characterIds` into the `participant` tier. Used by the document
   * path resolver to admit every chat participant's vault.
   */
  includeParticipants?: boolean;
}

/** A resolved, deduped pool. Each mount appears in exactly one bucket. */
export interface TieredMountPool {
  characterMountPointId: string | null;
  participantMountPointIds: string[];
  groupMountPointIds: string[];
  projectMountPointIds: string[];
  globalMountPointId: string | null;
}

/**
 * The scoped-tier subset that search/knowledge consumers care about. Excludes
 * the participant tier (which is resolved/deduped separately). `groupMountPointIds`
 * is optional so callers that predate the group tier (e.g. the knowledge injector's
 * local dedup) can omit it and get the legacy character/project/global behavior.
 */
export interface TierTriple {
  characterMountPointId: string | null;
  groupMountPointIds?: string[];
  projectMountPointIds: string[];
  globalMountPointId: string | null;
}

/**
 * Canonical dedup for the scoped-tier set. A mount must never enter more than
 * one tier; precedence among the scoped tiers is
 * **character > group > project > global**. (The participant tier is deduped
 * separately in `resolveTieredMountPool` — it sits between character and group
 * in the overall ranking but is never subject to this triple's dedup because it
 * carries peer vaults, not the responding character's own scoped stores.) This
 * is the ONE place the scoped dedup rule is implemented — every resolver and the
 * knowledge injector funnel through it so the priority can't drift.
 */
export function dedupeTierTriple(
  triple: TierTriple,
): Omit<TieredMountPool, 'participantMountPointIds'> {
  const characterMountPointId = triple.characterMountPointId ?? null;

  // Group: closest after character. Drop any mount that equals the character
  // vault; dedup within the group set.
  const groupSeen = new Set<string>();
  const groupMountPointIds: string[] = [];
  for (const id of triple.groupMountPointIds ?? []) {
    if (!id) continue;
    if (id === characterMountPointId) continue;
    if (groupSeen.has(id)) continue;
    groupSeen.add(id);
    groupMountPointIds.push(id);
  }

  // Global: nulled when it collides with a closer tier (character or group).
  // A project collision is resolved by dropping the project mount (below),
  // preserving the legacy global-over-project edge case — which never arises for
  // the "Quilltap General" singleton in practice.
  let globalMountPointId = triple.globalMountPointId ?? null;
  if (
    globalMountPointId &&
    (globalMountPointId === characterMountPointId || groupSeen.has(globalMountPointId))
  ) {
    globalMountPointId = null;
  }

  // Project: excludes character, every group mount, and global; dedup within.
  const seen = new Set<string>();
  const projectMountPointIds: string[] = [];
  for (const id of triple.projectMountPointIds ?? []) {
    if (!id) continue;
    if (id === characterMountPointId) continue;
    if (groupSeen.has(id)) continue;
    if (id === globalMountPointId) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    projectMountPointIds.push(id);
  }

  return { characterMountPointId, groupMountPointIds, projectMountPointIds, globalMountPointId };
}

/**
 * Resolve just the project tier — the document stores linked to a project.
 * A cheap helper for callers (wardrobe equip paths, background jobs) that only
 * need the project tier and not the full character/global pool. Returns `[]`
 * for a missing project id or on lookup failure.
 */
export async function resolveProjectMountPointIds(
  projectId: string | null | undefined,
): Promise<string[]> {
  if (!projectId) return [];
  try {
    const repos = getRepositories();
    const links = await repos.projectDocMountLinks.findByProjectId(projectId);
    return links.map((l) => l.mountPointId);
  } catch (error) {
    logger.warn('Project mount lookup failed', { projectId, error: errMsg(error) });
    return [];
  }
}

/**
 * Resolve just the group tier — the union of the official store and every linked
 * store across all groups the given character is a member of. Keyed on the
 * RESPONDING character (never the chat): a character only ever sees its own
 * groups' stores. A cheap helper for callers that only need the group tier.
 * Returns `[]` for a missing character id or on any lookup failure (fails soft).
 */
export async function resolveGroupMountPointIdsForCharacter(
  characterId: string | null | undefined,
): Promise<string[]> {
  if (!characterId) return [];
  try {
    const repos = getRepositories();
    const memberships = await repos.groupCharacterMembers.findByCharacterId(characterId);
    if (memberships.length === 0) return [];
    const ids = new Set<string>();
    for (const membership of memberships) {
      try {
        // findByIdRaw avoids a store read on this hot path — we only need the
        // group's officialMountPointId pointer, not its hydrated content.
        const group = await repos.groups.findByIdRaw(membership.groupId);
        if (group?.officialMountPointId) ids.add(group.officialMountPointId);
        const links = await repos.groupDocMountLinks.findByGroupId(membership.groupId);
        for (const link of links) ids.add(link.mountPointId);
      } catch (error) {
        logger.warn('Group store lookup failed for membership', {
          groupId: membership.groupId,
          characterId,
          error: errMsg(error),
        });
      }
    }
    return [...ids];
  } catch (error) {
    logger.warn('Group mount lookup failed', { characterId, error: errMsg(error) });
    return [];
  }
}

/**
 * Resolve the project tier from a chat id — loads the chat, then its project's
 * linked stores. Convenience for callers (background jobs, tool handlers) that
 * hold a chat id but not a project id. Returns `[]` when the chat is project-less
 * or on lookup failure.
 */
export async function resolveProjectMountPointIdsForChat(
  chatId: string | null | undefined,
): Promise<string[]> {
  if (!chatId) return [];
  try {
    const repos = getRepositories();
    const chat = await repos.chats.findById(chatId);
    return resolveProjectMountPointIds(chat?.projectId ?? null);
  } catch (error) {
    logger.warn('Project mount lookup for chat failed', { chatId, error: errMsg(error) });
    return [];
  }
}

/**
 * Resolve the tri-tier mount pool for a context. Does the DB lookups, applies
 * the optional ownership gate and participant inclusion, then dedups via
 * `dedupeTierTriple`. Degrades gracefully: any tier whose lookup fails (or
 * whose mount isn't provisioned) simply drops out rather than throwing.
 */
export async function resolveTieredMountPool(
  ctx: TierContext,
  opts: TierResolveOptions = {},
): Promise<TieredMountPool> {
  const { requireOwnership = false, includeParticipants = false } = opts;
  const repos = getRepositories();

  // 1. Responding character's vault (optionally ownership-gated).
  let characterMountPointId: string | null = null;
  if (requireOwnership) {
    if (ctx.characterId) {
      try {
        const character = await repos.characters.findById(ctx.characterId);
        if (character && character.userId === ctx.userId) {
          characterMountPointId = character.characterDocumentMountPointId ?? null;
        }
      } catch (error) {
        logger.warn('Character vault lookup failed', { error: errMsg(error) });
      }
    }
  } else if (ctx.characterMountPointId) {
    characterMountPointId = ctx.characterMountPointId;
  } else if (ctx.characterId) {
    try {
      const character = await repos.characters.findById(ctx.characterId);
      characterMountPointId = character?.characterDocumentMountPointId ?? null;
    } catch (error) {
      logger.warn('Character vault lookup failed', { error: errMsg(error) });
    }
  }

  // 2. Group stores — official + linked stores of every group the RESPONDING
  //    character belongs to. Per-character (keyed on ctx.characterId), never the
  //    chat: a character never gains a co-participant's group stores. Fails soft.
  const groupMountPointIds: string[] = ctx.characterId
    ? await resolveGroupMountPointIdsForCharacter(ctx.characterId)
    : [];

  // 3. Project-linked stores.
  let projectMountPointIds: string[] = [];
  if (ctx.projectId) {
    try {
      const links = await repos.projectDocMountLinks.findByProjectId(ctx.projectId);
      projectMountPointIds = links.map((l) => l.mountPointId);
    } catch (error) {
      logger.warn('Project mount lookup failed', {
        projectId: ctx.projectId,
        error: errMsg(error),
      });
    }
  }

  // 4. Quilltap General singleton (null during the pre-provisioning window).
  let globalMountPointId: string | null = null;
  try {
    globalMountPointId = await getGeneralMountPointId();
  } catch {
    /* general mount not provisioned yet */
  }

  // 5. Canonical dedup of the scoped tiers (character > group > project > global).
  const deduped = dedupeTierTriple({
    characterMountPointId,
    groupMountPointIds,
    projectMountPointIds,
    globalMountPointId,
  });

  // 6. Participant vaults — admitted into their own tier, excluded from every
  //    other resolved tier (including group) so each mount classifies into
  //    exactly one bucket.
  const participantMountPointIds: string[] = [];
  if (includeParticipants && ctx.characterIds && ctx.characterIds.length > 0) {
    const excluded = new Set<string>([
      ...(deduped.characterMountPointId ? [deduped.characterMountPointId] : []),
      ...deduped.groupMountPointIds,
      ...deduped.projectMountPointIds,
      ...(deduped.globalMountPointId ? [deduped.globalMountPointId] : []),
    ]);
    const seen = new Set<string>();
    for (const characterId of ctx.characterIds) {
      if (!characterId) continue;
      try {
        const character = await repos.characters.findById(characterId);
        const mp = character?.characterDocumentMountPointId;
        if (mp && !excluded.has(mp) && !seen.has(mp)) {
          seen.add(mp);
          participantMountPointIds.push(mp);
        }
      } catch (error) {
        logger.warn('Participant vault lookup failed', {
          characterId,
          error: errMsg(error),
        });
      }
    }
  }

  const pool: TieredMountPool = { ...deduped, participantMountPointIds };
  return pool;
}

/**
 * Flatten a pool into a deduped id list. `scope` narrows the selection the same
 * way the scriptorium search tool does ('character' | 'project' | 'all').
 * `includeParticipants` folds the participant tier into the result (the
 * document path resolver wants it; search does not).
 */
export function flattenTierPool(
  pool: TieredMountPool,
  opts: { scope?: 'all' | 'character' | 'group' | 'project'; includeParticipants?: boolean } = {},
): string[] {
  const { scope = 'all', includeParticipants = false } = opts;
  const ids = new Set<string>();
  const addCharacterTier = () => {
    if (pool.characterMountPointId) ids.add(pool.characterMountPointId);
    if (includeParticipants) {
      for (const id of pool.participantMountPointIds) ids.add(id);
    }
  };
  if (scope === 'character') {
    addCharacterTier();
  } else if (scope === 'group') {
    for (const id of pool.groupMountPointIds) ids.add(id);
  } else if (scope === 'project') {
    for (const id of pool.projectMountPointIds) ids.add(id);
  } else {
    addCharacterTier();
    for (const id of pool.groupMountPointIds) ids.add(id);
    for (const id of pool.projectMountPointIds) ids.add(id);
    if (pool.globalMountPointId) ids.add(pool.globalMountPointId);
  }
  return [...ids];
}

/**
 * Classify which tier a mount belongs to within a resolved pool, or `null` when
 * the mount is outside the pool. Precedence: character > participant > group >
 * project > global.
 */
export function classifyMountTier(
  mountPointId: string,
  pool: TieredMountPool,
): MountTier | null {
  if (mountPointId === pool.characterMountPointId) return 'character';
  if (pool.participantMountPointIds.includes(mountPointId)) return 'participant';
  if (pool.groupMountPointIds.includes(mountPointId)) return 'group';
  if (pool.projectMountPointIds.includes(mountPointId)) return 'project';
  if (mountPointId === pool.globalMountPointId) return 'global';
  return null;
}
