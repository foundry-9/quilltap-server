/**
 * Reach — what a character, or a cast, can reach, settled once.
 *
 * Quilltap has one idea about stores: a character reaches four tiers,
 * **character vault > group stores > project stores > Quilltap General**,
 * nearer shadowing farther. `tiered-mount-pool.ts` is the forward walk for one
 * character; this module is everything around it that used to be copied at
 * call sites:
 *
 *   - {@link resolveOwnerStore} — `{ scope, id }` to the owner's official
 *     store (the three `resolveXxxLocation` chokepoints are wrappers over it).
 *     Only a writer passes `ensure`; a read never provisions.
 *   - {@link groupMountsFor} / {@link groupOriginMap} — the group tier kept
 *     grouped, in membership order, and the "which group is this mount"
 *     origin map.
 *   - {@link resolveCastPool} / {@link castGroupMounts} — a cast's reach (the
 *     Scenario Builder, the operator's document picker, the cast's scenario
 *     menu): the union over the live cast.
 *   - {@link orderMounts} / {@link bucketMounts} — a pool as an ordered probe
 *     list, or as knowledge tiers with their literal-phrase boosts.
 *   - {@link classifyMount} — the reverse question: whose store is this mount?
 *
 * Settled rules (Refactor 4.12, tier walk §5.1):
 *
 *   - The project tier is every linked store, the official store first.
 *   - A character's group tier is the character's own groups; a cast's is the
 *     union over the live cast.
 *   - Inside a tier, the earlier mount wins: membership order, and the first
 *     group to claim a shared store keeps it. Readers that shadow
 *     weakest-first reverse {@link orderMounts}' order; nobody sorts by id.
 *   - The project roster and a disabled store are named options on the
 *     forward walk (`roster`, `enabled`), never applied around it.
 *   - An archived character's vault still reads (its items stay visible) and
 *     refuses writes; scenarios refuse it outright, by option.
 *
 * Server-only.
 *
 * @module mount-index/reach
 */

import { getGeneralMountPointId } from '@/lib/instance-settings';
import { logger } from '@/lib/logger';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { ensureOwnerOfficialStore } from '@/lib/mount-index/ensure-owner-store';
import {
  dedupeTierTriple,
  resolveGroupMountsForCharacter,
  resolveMountPointIdsForGroup,
  resolveProjectMountPointIds,
  type GroupMounts,
  type MountTier,
  type TieredMountPool,
} from '@/lib/mount-index/tiered-mount-pool';
import {
  LITERAL_BOOST_CHARACTER,
  LITERAL_BOOST_GLOBAL,
  LITERAL_BOOST_GROUP,
  LITERAL_BOOST_PROJECT,
} from '@/lib/embedding/literal-boost';
import { getRepositories, type RepositoryContainer } from '@/lib/repositories/factory';

export type { GroupMounts, MountTier, TieredMountPool } from '@/lib/mount-index/tiered-mount-pool';

const errMsg = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The four owners a store can belong to. */
export type OwnerScope = 'character' | 'group' | 'project' | 'general';

/** The slice of a raw character row the reach helpers hand back. */
export interface ReachCharacterRow {
  id: string;
  name: string;
  userId: string;
  archivedAt?: string | null;
  characterDocumentMountPointId?: string | null;
  defaultScenarioId?: string | null;
}

// ============================================================================
// Owner → official store
// ============================================================================

export interface ResolveOwnerStoreOptions {
  /**
   * Provision a missing project/group store and heal `folder` inside it (for
   * General, only the folder). For writers only — a read probe omits it and
   * gets null for a store that does not exist yet. `onFolderFailure` decides
   * whether a folder that cannot be made is logged and swallowed (the write
   * re-creates it) or rethrown (the caller must see it).
   */
  ensure?: { folder: string; onFolderFailure: 'swallow' | 'throw' };
  /**
   * `allow`: an archived character's vault resolves (it reads; writes refuse
   * at the writer). `refuse`: an archived character resolves to null.
   */
  archived: 'allow' | 'refuse';
  /** A tag for the log lines, e.g. `'wardrobe'`. */
  context?: string;
}

/** An owner's store, as {@link resolveOwnerStore} found it. */
export interface OwnerStore {
  scope: OwnerScope;
  mountPointId: string;
  /** The owner: a character, project or group; `id: null` for General. */
  owner: { id: string | null; name: string };
  /** The raw character row, for the character scope. */
  character?: ReachCharacterRow;
}

async function ensureOwnerFolder(
  mountPointId: string,
  ensure: NonNullable<ResolveOwnerStoreOptions['ensure']>,
  context: string | undefined,
): Promise<void> {
  try {
    await ensureFolderPath(mountPointId, ensure.folder);
  } catch (error) {
    logger.warn(`[Reach] Failed to ensure ${ensure.folder} folder`, {
      mountPointId,
      folder: ensure.folder,
      context,
      error: errMsg(error),
    });
    if (ensure.onFolderFailure === 'throw') throw error;
  }
}

/**
 * Resolve `{ scope, id }` to the owner's store, or null when the owner is
 * missing (or, for a character, not `userId`'s, or archived under
 * `archived: 'refuse'`), when a non-General scope arrives without an id, or
 * when the store does not exist and `ensure` is off (or cannot be made).
 *
 * Reads are raw: only the owner's name and store pointer are wanted, and a
 * broken vault overlay should cost a null rather than a throw.
 */
export async function resolveOwnerStore(
  scope: OwnerScope,
  id: string | null | undefined,
  repos: Pick<RepositoryContainer, 'characters' | 'projects' | 'groups'>,
  userId: string,
  opts: ResolveOwnerStoreOptions,
): Promise<OwnerStore | null> {
  const { ensure, context } = opts;

  if (scope === 'general') {
    const mountPointId = await getGeneralMountPointId();
    if (!mountPointId) return null;
    if (ensure) await ensureOwnerFolder(mountPointId, ensure, context);
    return { scope, mountPointId, owner: { id: null, name: 'Quilltap General' } };
  }

  if (!id) return null;

  if (scope === 'character') {
    const character = (await repos.characters.findByIdRaw(id)) as ReachCharacterRow | null;
    if (!character || character.userId !== userId) return null;
    if (opts.archived === 'refuse' && character.archivedAt) {
      logger.debug('[Reach] Archived character refused', { characterId: id, context });
      return null;
    }
    const mountPointId = character.characterDocumentMountPointId;
    if (!mountPointId) return null;
    return { scope, mountPointId, owner: { id: character.id, name: character.name }, character };
  }

  const owner =
    scope === 'project' ? await repos.projects.findByIdRaw(id) : await repos.groups.findByIdRaw(id);
  if (!owner) return null;

  let mountPointId: string | null;
  if (ensure) {
    const fallbackName = owner.name || (scope === 'project' ? 'Project' : 'Group');
    const ensured = await ensureOwnerOfficialStore(scope, owner.id, fallbackName);
    if (!ensured) return null;
    mountPointId = ensured.mountPointId;
    await ensureOwnerFolder(mountPointId, ensure, context);
  } else {
    mountPointId = owner.officialMountPointId ?? null;
  }
  if (!mountPointId) return null;

  return { scope, mountPointId, owner: { id: owner.id, name: owner.name } };
}

// ============================================================================
// Group tier, kept grouped
// ============================================================================

/**
 * A character's group tier, one entry per group in membership order, each
 * with its official store first; a store shared by two groups is credited to
 * the first. `includeEmpty` keeps groups with no stores (a listing of the
 * character's groups, not a walk).
 */
export const groupMountsFor = resolveGroupMountsForCharacter;

/** A group-tier origin, in the shape the wardrobe and inventory both tag with. */
export interface GroupOrigin {
  scope: 'group';
  id: string;
  name: string;
}

/** Mount → the group it hangs in, for tagging a group-tier read. Keeps the tier's order. */
export function groupOriginMap(groups: readonly GroupMounts[]): Map<string, GroupOrigin> {
  const out = new Map<string, GroupOrigin>();
  for (const { group, mountPointIds } of groups) {
    for (const mountPointId of mountPointIds) {
      if (!out.has(mountPointId)) out.set(mountPointId, { scope: 'group', id: group.id, name: group.name });
    }
  }
  return out;
}

// ============================================================================
// A cast's reach
// ============================================================================

/**
 * The group stores a cast reaches: the groups named outright (in the order
 * given), then each character's groups in cast order, deduped, the first
 * claim kept. The caller decides who is in the cast. Fails soft per group.
 */
export async function castGroupMounts(
  characterIds: readonly string[],
  groupIds: readonly string[] = [],
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (ids: readonly string[]) => {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  };
  for (const groupId of new Set(groupIds.filter(Boolean))) {
    add(await resolveMountPointIdsForGroup(groupId));
  }
  for (const characterId of new Set(characterIds.filter(Boolean))) {
    add((await groupMountsFor(characterId)).flatMap((g) => g.mountPointIds));
  }
  return out;
}

/** A cast's pool: the cast's vaults in the participant tier, and who owns each. */
export interface CastPool extends TieredMountPool {
  /** The live cast members' vaults, in cast order (a vault deduped into a scoped tier is absent). */
  castVaults: Array<{ characterId: string; mountPointId: string }>;
  /** The cast members that count: the caller's, not archived. */
  liveCharacterIds: string[];
}

/**
 * What a cast can reach, before or outside any one character's turn: every
 * live cast member's vault (participant tier), the groups named outright plus
 * the union of the cast's groups, the project's stores and Quilltap General.
 * There is no acting character, so `characterMountPointId` is null; flatten
 * with `includeParticipants: true`.
 *
 * An archived character is a tombstone and contributes nothing (never
 * `ensureCharacterVault` one here). Any tier whose lookup fails drops out with
 * a `warn`; this never throws.
 */
export async function resolveCastPool(opts: {
  userId: string;
  projectId?: string | null;
  characterIds: readonly string[];
  /** Groups named outright (a run launched from a group's page). */
  groupIds?: readonly string[];
}): Promise<CastPool> {
  const repos = getRepositories();
  const castIds = [...new Set(opts.characterIds.filter(Boolean))];

  // 1. Live cast vaults. Raw reads: only the vault pointer, owner and archive flag.
  const liveCharacterIds: string[] = [];
  const vaults: Array<{ characterId: string; mountPointId: string }> = [];
  for (const characterId of castIds) {
    try {
      const character = await repos.characters.findByIdRaw(characterId);
      if (!character) continue;
      if (character.userId && character.userId !== opts.userId) continue;
      if (character.archivedAt) {
        logger.debug('[Reach] Archived cast member contributes nothing to the pool', { characterId });
        continue;
      }
      liveCharacterIds.push(characterId);
      if (character.characterDocumentMountPointId) {
        vaults.push({ characterId, mountPointId: character.characterDocumentMountPointId });
      }
    } catch (error) {
      logger.warn('[Reach] Cast vault lookup failed; tier dropped for this character', {
        characterId,
        error: errMsg(error),
      });
    }
  }

  // 2–4. Group, project and General tiers.
  const groupMountPointIds = await castGroupMounts(liveCharacterIds, opts.groupIds ?? []);
  const projectMountPointIds = await resolveProjectMountPointIds(opts.projectId ?? null);
  let globalMountPointId: string | null = null;
  try {
    globalMountPointId = await getGeneralMountPointId();
  } catch (error) {
    logger.warn('[Reach] Quilltap General lookup failed; global tier dropped', { error: errMsg(error) });
  }

  // 5. Scoped-tier dedup, then the cast vaults excluded from every scoped
  //    tier so each mount classifies into exactly one bucket.
  const deduped = dedupeTierTriple({
    characterMountPointId: null,
    groupMountPointIds,
    projectMountPointIds,
    globalMountPointId,
  });
  const excluded = new Set<string>([
    ...deduped.groupMountPointIds,
    ...deduped.projectMountPointIds,
    ...(deduped.globalMountPointId ? [deduped.globalMountPointId] : []),
  ]);
  const seen = new Set<string>();
  const castVaults = vaults.filter(({ mountPointId }) => {
    if (excluded.has(mountPointId) || seen.has(mountPointId)) return false;
    seen.add(mountPointId);
    return true;
  });

  const pool: CastPool = {
    ...deduped,
    participantMountPointIds: castVaults.map((v) => v.mountPointId),
    castVaults,
    liveCharacterIds,
  };
  logger.debug('[Reach] Resolved cast pool', {
    castCount: castIds.length,
    liveCastCount: liveCharacterIds.length,
    namedGroupCount: opts.groupIds?.length ?? 0,
    participants: pool.participantMountPointIds.length,
    groups: pool.groupMountPointIds.length,
    projects: pool.projectMountPointIds.length,
    hasGlobal: !!pool.globalMountPointId,
  });
  return pool;
}

// ============================================================================
// A pool, ordered
// ============================================================================

/** The tiers in precedence order, nearest first. */
const TIER_ORDER: readonly MountTier[] = ['character', 'participant', 'group', 'project', 'global'];

/**
 * A pool as a probe list, strongest first: tier by tier, and inside a tier in
 * the pool's own order (membership order for groups, the official store first
 * for the project). The first probe that answers wins. A reader that shadows
 * weakest-first reverses this. Participants are left out unless asked for.
 */
export function orderMounts(
  pool: TieredMountPool,
  opts: { includeParticipants?: boolean } = {},
): Array<{ tier: MountTier; mountPointId: string }> {
  const byTier: Record<MountTier, readonly string[]> = {
    character: pool.characterMountPointId ? [pool.characterMountPointId] : [],
    participant: opts.includeParticipants ? pool.participantMountPointIds : [],
    group: pool.groupMountPointIds,
    project: pool.projectMountPointIds,
    global: pool.globalMountPointId ? [pool.globalMountPointId] : [],
  };
  const seen = new Set<string>();
  const ordered: Array<{ tier: MountTier; mountPointId: string }> = [];
  for (const tier of TIER_ORDER) {
    for (const mountPointId of byTier[tier]) {
      if (seen.has(mountPointId)) continue;
      seen.add(mountPointId);
      ordered.push({ tier, mountPointId });
    }
  }
  return ordered;
}

/** A knowledge tier: the mounts searched together and the literal-phrase boost they earn. */
export interface KnowledgeBucket {
  tier: 'character' | 'group' | 'project' | 'global';
  mountPointIds: string[];
  boost: number;
}

/**
 * A pool as the knowledge searches' tiers, nearest first, each with its
 * literal-phrase boost so a hit in a closer voice outranks the same hit
 * further out. `scope` narrows as the scriptorium search does;
 * `participantsAsCharacter` puts a cast pool's vaults where the character
 * tier would be (there is no acting character).
 */
export function bucketMounts(
  pool: TieredMountPool,
  opts: { scope?: 'all' | 'character' | 'group' | 'project'; participantsAsCharacter?: boolean } = {},
): KnowledgeBucket[] {
  const scope = opts.scope ?? 'all';
  const want = (tier: 'character' | 'group' | 'project') => scope === 'all' || scope === tier;
  const buckets: KnowledgeBucket[] = [];
  if (want('character') && pool.characterMountPointId) {
    buckets.push({ tier: 'character', mountPointIds: [pool.characterMountPointId], boost: LITERAL_BOOST_CHARACTER });
  }
  if (want('character') && opts.participantsAsCharacter && pool.participantMountPointIds.length > 0) {
    buckets.push({ tier: 'character', mountPointIds: [...pool.participantMountPointIds], boost: LITERAL_BOOST_CHARACTER });
  }
  if (want('group') && pool.groupMountPointIds.length > 0) {
    buckets.push({ tier: 'group', mountPointIds: [...pool.groupMountPointIds], boost: LITERAL_BOOST_GROUP });
  }
  if (want('project') && pool.projectMountPointIds.length > 0) {
    buckets.push({ tier: 'project', mountPointIds: [...pool.projectMountPointIds], boost: LITERAL_BOOST_PROJECT });
  }
  if (scope === 'all' && pool.globalMountPointId) {
    buckets.push({ tier: 'global', mountPointIds: [pool.globalMountPointId], boost: LITERAL_BOOST_GLOBAL });
  }
  return buckets;
}

// ============================================================================
// Mount → owner
// ============================================================================

/** Whose store a mount is. */
export interface MountOwnerInfo {
  scope: OwnerScope;
  /** The character, project or group id; null for General. */
  ownerId: string | null;
  ownerName: string;
  /** True only for an archived character's vault. */
  archived: boolean;
  /** The raw character row, for a vault. */
  character?: ReachCharacterRow;
}

/**
 * The reverse question: which owner's store is this mount — General, a
 * character's vault, or a project's or group's *official* store — or null for
 * any other store (a linked store belongs to no one owner). Raw reads; the
 * caller filters (another user's or an archived character, say).
 */
export async function classifyMount(
  mountPointId: string,
  repos: Pick<RepositoryContainer, 'characters' | 'projects' | 'groups'> = getRepositories(),
): Promise<MountOwnerInfo | null> {
  if (mountPointId === (await getGeneralMountPointId())) {
    return { scope: 'general', ownerId: null, ownerName: 'Quilltap General', archived: false };
  }
  const character = (await repos.characters.findByDocumentMountPointIdRaw(mountPointId)) as ReachCharacterRow | null;
  if (character) {
    return {
      scope: 'character',
      ownerId: character.id,
      ownerName: character.name,
      archived: !!character.archivedAt,
      character,
    };
  }
  const project = await repos.projects.findByOfficialMountPointIdRaw(mountPointId);
  if (project) return { scope: 'project', ownerId: project.id, ownerName: project.name, archived: false };
  const group = await repos.groups.findByOfficialMountPointIdRaw(mountPointId);
  if (group) return { scope: 'group', ownerId: group.id, ownerName: group.name, archived: false };
  return null;
}
