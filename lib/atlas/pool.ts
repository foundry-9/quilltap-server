/**
 * Atlas Pool — the entries one character can reach, and the entries a chat's
 * present cast can reach between them.
 *
 * Four tiers in precedence order, **character > group > project > general**:
 * the character's own vault, the stores of every group they belong to, the
 * project's stores, and Quilltap General. Archived entries are dropped per
 * tier *before* shadowing, so an archived personal entry never hides a shared
 * one. Shadowing is by canonical name, case-insensitively: a character's own
 * "Convertible" replaces the project's for that character. Inside a tier the
 * earlier mount wins (`orderMounts` order, as `reach.ts` settles it).
 *
 * The project roster is not consulted (atlas spec §2): the project's Atlas is
 * the world of the chat.
 *
 * Server-only.
 *
 * @module lib/atlas/pool
 */

import { logger } from '@/lib/logger';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { castGroupMounts, groupMountsFor, groupOriginMap } from '@/lib/mount-index/reach';
import { resolveProjectMountPointIds } from '@/lib/mount-index/tiered-mount-pool';
import { readAtlasRecords } from '@/lib/atlas/vault-readers';
import { GENERAL_ATLAS_ORIGIN, type AtlasLocation } from '@/lib/atlas/location';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { AtlasEntryWithOrigin, AtlasOrigin, AtlasRecord } from '@/lib/schemas/atlas.types';
import { isParticipantPresent, type ParticipantStatus } from '@/lib/schemas/chat.types';

/** An entry with the tier it was read from. Every pool entry carries both. */
export type PooledAtlasEntry = AtlasRecord & { origin: AtlasOrigin; mountPointId: string };

/** What one pool or view holds, strongest first. */
export interface AtlasPool {
  /** Live entries, shadowed by canonical name, strongest tier first. */
  entries: readonly PooledAtlasEntry[];
  /** How many live entries a stronger one hid. */
  shadowedCount: number;
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase();

/**
 * Shadow layers given strongest first: archived dropped per layer, then the
 * first entry to claim a canonical name keeps it. Pure.
 */
export function shadowAtlasLayers(layers: readonly (readonly PooledAtlasEntry[])[]): AtlasPool {
  const seen = new Set<string>();
  const entries: PooledAtlasEntry[] = [];
  let shadowedCount = 0;
  for (const layer of layers) {
    for (const entry of layer) {
      if (entry.archivedAt) continue;
      const key = nameKey(entry.name);
      if (seen.has(key)) {
        shadowedCount++;
        continue;
      }
      seen.add(key);
      entries.push(entry);
    }
  }
  return { entries, shadowedCount };
}

/** Read mounts (strongest first, each fail-soft), tagging every record. */
async function readMounts(
  mountPointIds: readonly string[],
  originOf: (mountPointId: string) => AtlasOrigin,
): Promise<PooledAtlasEntry[]> {
  const out: PooledAtlasEntry[] = [];
  for (const mountPointId of mountPointIds) {
    try {
      const records = await readAtlasRecords(mountPointId);
      for (const record of records) out.push({ ...record, origin: originOf(mountPointId), mountPointId });
    } catch (error) {
      logger.warn('[AtlasPool] Failed to read an Atlas tier; skipping it', {
        mountPointId,
        context: 'atlas',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}

async function projectOrigin(
  repos: Partial<Pick<RepositoryContainer, 'projects'>>,
  projectId: string | null,
): Promise<AtlasOrigin> {
  let name = 'Project';
  if (projectId && repos.projects) {
    try {
      name = (await repos.projects.findById(projectId))?.name || name;
    } catch (error) {
      logger.warn('[AtlasPool] Project name lookup failed', {
        projectId,
        context: 'atlas',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { scope: 'project', id: projectId, name };
}

/** A character's own vault mount and origin, or null for none (or an archived character). */
async function ownTierOf(
  repos: Pick<RepositoryContainer, 'characters'>,
  characterId: string,
): Promise<{ mountPointId: string; origin: AtlasOrigin } | null> {
  try {
    const character = await repos.characters.findByIdRaw(characterId);
    if (!character || character.archivedAt || !character.characterDocumentMountPointId) return null;
    return {
      mountPointId: character.characterDocumentMountPointId,
      origin: { scope: 'character', id: characterId, name: character.name ?? '' },
    };
  } catch (error) {
    logger.warn('[AtlasPool] Character lookup failed; no character tier', {
      characterId,
      context: 'atlas',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Load one character's Atlas pool: own vault, groups, the project's stores and
 * General, shadowed. Each tier fails soft.
 */
export async function loadAtlasPool(
  repos: Pick<RepositoryContainer, 'characters'> & Partial<Pick<RepositoryContainer, 'projects'>>,
  opts: { characterId: string; projectId?: string | null },
): Promise<AtlasPool> {
  const { characterId } = opts;
  const projectId = opts.projectId ?? null;
  const [own, groups, projectMounts, generalMountPointId, projectTag] = await Promise.all([
    ownTierOf(repos, characterId),
    groupMountsFor(characterId),
    resolveProjectMountPointIds(projectId),
    getGeneralMountPointId(),
    projectOrigin(repos, projectId),
  ]);
  const groupOrigins = groupOriginMap(groups);
  const [ownLayer, groupLayer, projectLayer, generalLayer] = await Promise.all([
    own ? readMounts([own.mountPointId], () => own.origin) : Promise.resolve([]),
    readMounts(Array.from(groupOrigins.keys()), (mp) => groupOrigins.get(mp) as AtlasOrigin),
    readMounts(projectMounts.filter((mp) => mp !== own?.mountPointId), () => projectTag),
    readMounts(generalMountPointId ? [generalMountPointId] : [], () => GENERAL_ATLAS_ORIGIN),
  ]);
  const pool = shadowAtlasLayers([ownLayer, groupLayer, projectLayer, generalLayer]);
  logger.debug('[AtlasPool] Loaded atlas pool', {
    characterId,
    projectId,
    tiersRead: { own: !!own, groups: groupOrigins.size, project: projectMounts.length, general: !!generalMountPointId },
    ownCount: ownLayer.length,
    groupCount: groupLayer.length,
    projectCount: projectLayer.length,
    generalCount: generalLayer.length,
    kept: pool.entries.length,
    shadowed: pool.shadowedCount,
    op: 'pool',
    context: 'atlas',
  });
  return pool;
}

/** What {@link loadCastAtlasView} needs of a chat. */
export interface AtlasViewChat {
  id: string;
  projectId?: string | null;
  participants?: ReadonlyArray<{ characterId?: string | null; status?: ParticipantStatus | null; type?: string }>;
}

/**
 * The cast view: the entries the chat's present seats reach between them, for
 * pictures and chips. Strongest first: each present seat's vault in
 * participant order, then the cast's groups, then the project, then General;
 * shadowed by canonical name, so of two seats each with their own
 * "Convertible" the earlier seat's wins.
 */
export async function loadCastAtlasView(
  repos: Pick<RepositoryContainer, 'characters'> & Partial<Pick<RepositoryContainer, 'projects'>>,
  opts: { chat: AtlasViewChat },
): Promise<AtlasPool> {
  const { chat } = opts;
  const characterIds: string[] = [];
  for (const participant of chat.participants ?? []) {
    if (!participant.characterId) continue;
    if (participant.status && !isParticipantPresent(participant.status)) continue;
    if (!characterIds.includes(participant.characterId)) characterIds.push(participant.characterId);
  }
  return loadAtlasViewFor(repos, { characterIds, projectId: chat.projectId ?? null, chatId: chat.id });
}

/**
 * The view for a set of characters and a project (strongest first as
 * {@link loadCastAtlasView}). With no characters it is the project plus
 * General — what an image call with no chat reads.
 */
export async function loadAtlasViewFor(
  repos: Pick<RepositoryContainer, 'characters'> & Partial<Pick<RepositoryContainer, 'projects'>>,
  opts: { characterIds: readonly string[]; projectId?: string | null; chatId?: string | null },
): Promise<AtlasPool> {
  const projectId = opts.projectId ?? null;
  const owns = await Promise.all(opts.characterIds.map((id) => ownTierOf(repos, id)));
  const ownTiers = owns.filter((own): own is { mountPointId: string; origin: AtlasOrigin } => own !== null);
  const ownMounts = new Set(ownTiers.map((own) => own.mountPointId));
  const [groupMounts, projectMounts, generalMountPointId, projectTag, groupsByCharacter] = await Promise.all([
    opts.characterIds.length > 0 ? castGroupMounts(opts.characterIds) : Promise.resolve([] as string[]),
    resolveProjectMountPointIds(projectId),
    getGeneralMountPointId(),
    projectOrigin(repos, projectId),
    Promise.all(opts.characterIds.map((id) => groupMountsFor(id))),
  ]);
  const groupOrigins = groupOriginMap(groupsByCharacter.flat());
  const groupOnly = groupMounts.filter((mp) => !ownMounts.has(mp));
  const projectOnly = projectMounts.filter((mp) => !ownMounts.has(mp) && !groupOnly.includes(mp));
  const ownLayers = await Promise.all(ownTiers.map((own) => readMounts([own.mountPointId], () => own.origin)));
  const [groupLayer, projectLayer, generalLayer] = await Promise.all([
    readMounts(groupOnly, (mp) => groupOrigins.get(mp) ?? { scope: 'group', id: null, name: 'Group' }),
    readMounts(projectOnly, () => projectTag),
    readMounts(generalMountPointId ? [generalMountPointId] : [], () => GENERAL_ATLAS_ORIGIN),
  ]);
  const view = shadowAtlasLayers([...ownLayers, groupLayer, projectLayer, generalLayer]);
  logger.debug('[AtlasPool] Loaded cast atlas view', {
    chatId: opts.chatId ?? null,
    projectId,
    seats: opts.characterIds.length,
    vaults: ownTiers.length,
    groupMounts: groupOnly.length,
    projectMounts: projectOnly.length,
    kept: view.entries.length,
    shadowed: view.shadowedCount,
    op: 'cast-view',
    context: 'atlas',
  });
  return view;
}

/**
 * What else is reachable from a location, for the editor's overlap notices:
 * a character's whole pool (without a project), a shared tier itself plus
 * General, General alone. Unshadowed — the notices want every holder.
 */
export async function loadAtlasPoolForLocation(
  repos: Pick<RepositoryContainer, 'characters'> & Partial<Pick<RepositoryContainer, 'projects'>>,
  location: AtlasLocation,
): Promise<PooledAtlasEntry[]> {
  const tag = (records: readonly AtlasRecord[], origin: AtlasOrigin, mountPointId: string): PooledAtlasEntry[] =>
    records.filter((r) => !r.archivedAt).map((r) => ({ ...r, origin, mountPointId }));
  if (location.characterId) {
    const groups = groupOriginMap(await groupMountsFor(location.characterId));
    const generalMountPointId = await getGeneralMountPointId();
    const layers = await Promise.all([
      location.readEntries(false).then((records) => tag(records, location.origin, location.mountPointId)),
      readMounts(Array.from(groups.keys()), (mp) => groups.get(mp) as AtlasOrigin),
      readMounts(generalMountPointId ? [generalMountPointId] : [], () => GENERAL_ATLAS_ORIGIN),
    ]);
    return layers.flat().filter((entry) => !entry.archivedAt);
  }
  const own = tag(await location.readEntries(false), location.origin, location.mountPointId);
  if (location.scope === 'general') return own;
  const generalMountPointId = await getGeneralMountPointId();
  const general = generalMountPointId ? await readMounts([generalMountPointId], () => GENERAL_ATLAS_ORIGIN) : [];
  return [...own, ...general.filter((entry) => !entry.archivedAt)];
}

/** Tag a tier's records for the wire. */
export function withOrigin(location: AtlasLocation, record: AtlasRecord): AtlasEntryWithOrigin {
  return { ...record, origin: location.origin, mountPointId: location.mountPointId };
}
