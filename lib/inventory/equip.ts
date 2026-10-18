/**
 * Equip and unequip — the chokepoints a gesture in the Salon (and, later, a
 * tool) calls to change what a character carries in one chat.
 *
 * Plan, then write (spec §5.6):
 *
 *   1. Load the character's pool and the current equipped set (ids that no
 *      longer resolve are dropped here, and so pruned by this write).
 *   2. Expand kits: an archetype member becomes an instance in the
 *      character's vault (an unequipped instance they already own is reused
 *      rather than a fresh one minted), an item member is itself, and a
 *      member that does not resolve is reported in `skipped`.
 *   3. Refuse archetypes and archived objects named directly
 *      (`NOT_EQUIPPABLE`), and check the cap: `count(equipped kin) + planned
 *      kin + 1 ≤ maxEquipped`, or the whole call fails (`CAP_EXCEEDED`) with
 *      nothing written — instantiations included.
 *   4. Write the instances, then one `setEquippedInventory`, then
 *      `notifyInventoryChanged`.
 *
 * Unequip never fails on state: ids not carried are reported. A kit
 * unequips every member present (and the instances of its archetype
 * members) and keeps the instances.
 *
 * Writes for one chat are serialised, so two gestures cannot each read a
 * stale set. Plain async functions, so the tools and Pascal's effects call
 * them.
 *
 * {@link pickUpItems} is the third gesture (a character's `inventory_pick_up`
 * and a Pascal `pick_up` effect): an instance of each named archetype is made
 * in the character's vault root and, by default, equipped — the cap checked
 * over the whole plan *before* any instance is written, so a breach creates
 * nothing.
 *
 * Server-only.
 *
 * @module lib/inventory/equip
 */

import { logger } from '@/lib/logger';
import { publishRealtime } from '@/lib/realtime/bus';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { runSerialized } from '@/lib/database/repositories/vault-overlay/item-folder-ops';
import {
  InventoryCapExceededError,
  InventoryInvalidParentError,
  InventoryNotEquippableError,
  InventoryRefusal,
} from '@/lib/inventory/errors';
import { notifyInventoryChanged, type InventoryChangeContext } from '@/lib/inventory/equip-effects';
import { readEquippedSet } from '@/lib/inventory/equipped-set';
import { instantiate } from '@/lib/inventory/item-mutations';
import { resolveInventoryLocation } from '@/lib/inventory/location';
import { loadInventoryPool, type InventoryPool } from '@/lib/inventory/pool';
import { isKin } from '@/lib/inventory/resolve';

export type { InventoryChangeContext } from '@/lib/inventory/equip-effects';

/** The chat as equip needs it. */
export interface EquipChat {
  id: string;
  projectId?: string | null;
  equippedInventory?: unknown;
  participants?: ReadonlyArray<{ type?: string | null; characterId?: string | null; status?: string | null }>;
}

export type SkipReason = 'missing' | 'archived' | 'is_kit';

export interface EquipResult {
  /** Everything newly carried (instances created for kits included). */
  equipped: ResolvedInventoryItem[];
  /** Instances minted for a kit's archetype members. */
  created: ResolvedInventoryItem[];
  /** Kit members that could not be carried, and why. */
  skipped: Array<{ id: string; kitId: string; reason: SkipReason }>;
  /** Ids asked for that were already carried. */
  alreadyEquipped: string[];
}

export interface UnequipResult {
  unequipped: ResolvedInventoryItem[];
  /** Ids asked for that were not carried. */
  notEquipped: string[];
}

type Repos = RepositoryContainer;

/** The character is not seated in the chat (a 400). */
export class InventoryNotAParticipantError extends InventoryRefusal {
  constructor(characterId: string) {
    super('NOT_A_PARTICIPANT', `Character ${characterId} is not a participant of this chat`, 400, { characterId });
    this.name = 'InventoryNotAParticipantError';
  }
}

function assertParticipant(chat: EquipChat, characterId: string): void {
  const seated = (chat.participants ?? []).some(
    (p) => p.characterId === characterId && p.status !== 'removed',
  );
  if (!seated) {
    logger.info('[InventoryEquip] Refused', { code: 'NOT_A_PARTICIPANT', chatId: chat.id, characterId, context: 'inventory' });
    throw new InventoryNotAParticipantError(characterId);
  }
}

/** Re-read the chat so a serialised write sees the set as it is now. */
async function freshChat(repos: Repos, chat: EquipChat): Promise<EquipChat> {
  return ((await repos.chats.findById(chat.id)) as EquipChat | null) ?? chat;
}

function poolFor(repos: Repos, chat: EquipChat, characterId: string): Promise<InventoryPool> {
  return loadInventoryPool(repos, { characterId, chatId: chat.id, projectId: chat.projectId ?? null });
}

/** One planned object: an existing one, or an archetype to instantiate. */
type Planned =
  | { kind: 'existing'; item: ResolvedInventoryItem }
  | { kind: 'instantiate'; archetype: ResolvedInventoryItem; kitFolder: string | null };

interface EquipOptions {
  /**
   * Arrival: an object that would breach its cap is dropped with a `warn`
   * instead of failing the call, and a direct id that is not carriable is
   * skipped.
   */
  lenient?: boolean;
  /**
   * Objects written by this same call that the pool may not see yet (a
   * just-created object, in the job child where a buffered file write is not
   * readable). Looked up after the pool.
   */
  known?: readonly ResolvedInventoryItem[];
}

/**
 * Run `fn` holding a chat's carried-set lock — the one every write of
 * `chats.equippedInventory` takes, since `setEquippedInventory` is a
 * read-modify-write of the whole map. Inside it, equip through
 * {@link equipItemsHoldingLock}, never {@link equipItems} (the chain is not
 * re-entrant).
 */
export function withChatInventoryLock<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
  return runSerialized(`inventory-equip:${chatId}`, fn);
}

/** {@link equipItems} for a caller already inside {@link withChatInventoryLock}. */
export function equipItemsHoldingLock(
  repos: Repos,
  chat: EquipChat,
  characterId: string,
  ids: readonly string[],
  ctx: InventoryChangeContext,
  opts: EquipOptions = {},
): Promise<EquipResult> {
  assertParticipant(chat, characterId);
  return equipUnserialized(repos, chat, characterId, ids, ctx, opts);
}

/**
 * Equip objects (and kits) for one character in one chat. See the module
 * header for the plan-then-write contract.
 */
export function equipItems(
  repos: Repos,
  chat: EquipChat,
  characterId: string,
  ids: readonly string[],
  ctx: InventoryChangeContext,
  opts: EquipOptions = {},
): Promise<EquipResult> {
  assertParticipant(chat, characterId);
  return withChatInventoryLock(chat.id, () => equipUnserialized(repos, chat, characterId, ids, ctx, opts));
}

async function equipUnserialized(
  repos: Repos,
  staleChat: EquipChat,
  characterId: string,
  ids: readonly string[],
  ctx: InventoryChangeContext,
  opts: EquipOptions,
): Promise<EquipResult> {
  const chat = await freshChat(repos, staleChat);
  const pool = await poolFor(repos, chat, characterId);
  const current = readEquippedSet(chat, characterId, pool);
  const currentIds = new Set(current.map((item) => item.id));
  const carriedParents = new Set(current.map((item) => item.parentId).filter((id): id is string => !!id));

  const result: EquipResult = { equipped: [], created: [], skipped: [], alreadyEquipped: [] };
  const planned: Planned[] = [];
  const plannedIds = new Set<string>();
  const plannedArchetypes = new Set<string>();

  const planExisting = (item: ResolvedInventoryItem) => {
    if (currentIds.has(item.id)) {
      result.alreadyEquipped.push(item.id);
      return;
    }
    if (plannedIds.has(item.id)) return;
    plannedIds.add(item.id);
    planned.push({ kind: 'existing', item });
  };

  // Own, unarchived, uncarried instances of an archetype, for reuse.
  const spareInstances = (archetypeId: string) =>
    pool.own
      .filter((record) => record.parentId === archetypeId && !record.archivedAt && !currentIds.has(record.id) && !plannedIds.has(record.id))
      .map((record) => pool.resolve(record));

  const known = new Map((opts.known ?? []).map((item) => [item.id, item]));
  for (const id of Array.from(new Set(ids))) {
    const item = pool.resolveId(id) ?? known.get(id);
    if (!item || item.archivedAt || item.isArchetype) {
      const reason = !item ? 'missing' : item.archivedAt ? 'archived' : 'archetype';
      if (opts.lenient) {
        logger.debug('[InventoryEquip] Arrival skipped an object that cannot be carried', { chatId: chat.id, characterId, itemId: id, reason, context: 'inventory' });
        continue;
      }
      logger.info('[InventoryEquip] Refused', { code: 'NOT_EQUIPPABLE', chatId: chat.id, characterId, itemId: id, reason, context: 'inventory' });
      throw new InventoryNotEquippableError(id, reason);
    }
    if (item.kind !== 'kit') {
      planExisting(item);
      continue;
    }
    // A kit: expand its members.
    for (const memberId of item.itemIds) {
      const member = pool.resolveId(memberId);
      if (!member) {
        result.skipped.push({ id: memberId, kitId: item.id, reason: 'missing' });
      } else if (member.archivedAt) {
        result.skipped.push({ id: memberId, kitId: item.id, reason: 'archived' });
      } else if (member.kind === 'kit') {
        result.skipped.push({ id: memberId, kitId: item.id, reason: 'is_kit' });
      } else if (member.isArchetype) {
        if (carriedParents.has(member.id)) {
          result.alreadyEquipped.push(member.id);
        } else if (!plannedArchetypes.has(member.id)) {
          plannedArchetypes.add(member.id);
          const spare = spareInstances(member.id)[0];
          if (spare) planExisting(spare);
          else planned.push({ kind: 'instantiate', archetype: member, kitFolder: pool.owns(item.id) ? item.folder : null });
        }
      } else {
        planExisting(member);
      }
    }
  }

  // The cap, checked over the whole plan before anything is written. An
  // instance-to-be has its archetype's name and cap.
  const counted: Array<Pick<ResolvedInventoryItem, 'name'>> = [...current];
  const accepted: Planned[] = [];
  for (const plan of planned) {
    const subject = plan.kind === 'existing' ? plan.item : plan.archetype;
    const kin = counted.filter((other) => isKin(other, subject)).length;
    if (kin + 1 > subject.maxEquipped) {
      const error = new InventoryCapExceededError(subject.id, subject.title || subject.name, subject.maxEquipped);
      if (opts.lenient) {
        logger.warn('[InventoryEquip] Arrival dropped an object over its cap', {
          chatId: chat.id,
          characterId,
          itemId: subject.id,
          cap: subject.maxEquipped,
          context: 'inventory',
        });
        continue;
      }
      logger.info('[InventoryEquip] Refused', { code: error.code, chatId: chat.id, characterId, itemId: subject.id, cap: subject.maxEquipped, context: 'inventory' });
      throw error;
    }
    counted.push(subject);
    accepted.push(plan);
  }

  if (accepted.length === 0) {
    logger.debug('[InventoryEquip] Nothing new to carry', { chatId: chat.id, characterId, alreadyEquipped: result.alreadyEquipped, skipped: result.skipped, context: 'inventory' });
    return result;
  }

  // Writes: instances first, then the one set write.
  if (accepted.some((plan) => plan.kind === 'instantiate')) {
    const vault = await resolveInventoryLocation('character', characterId, repos, ctx.userId);
    if (!vault) throw new Error(`Character ${characterId} has no vault to hold a kit's instances`);
    for (const plan of accepted) {
      if (plan.kind !== 'instantiate') continue;
      const { item } = await instantiate(repos, vault, plan.archetype.id, { folder: plan.kitFolder ?? undefined, pool });
      result.created.push(item);
      result.equipped.push(item);
    }
  }
  for (const plan of accepted) if (plan.kind === 'existing') result.equipped.push(plan.item);

  await repos.chats.setEquippedInventory(chat.id, characterId, [
    ...current.map((item) => item.id),
    ...result.equipped.map((item) => item.id),
  ]);
  publishRealtime('chats', chat.id);
  logger.debug('[InventoryEquip] Equipped', {
    op: 'equip',
    chatId: chat.id,
    characterId,
    equipped: result.equipped.map((item) => item.id),
    created: result.created.map((item) => item.id),
    skipped: result.skipped,
    alreadyEquipped: result.alreadyEquipped,
    context: 'inventory',
  });
  await notifyInventoryChanged(repos, chat, characterId, { equipped: result.equipped, unequipped: [] }, ctx);
  return result;
}

/** Unequip objects (and kits) for one character in one chat. Never fails on state. */
export function unequipItems(
  repos: Repos,
  chat: EquipChat,
  characterId: string,
  ids: readonly string[],
  ctx: InventoryChangeContext,
): Promise<UnequipResult> {
  assertParticipant(chat, characterId);
  return withChatInventoryLock(chat.id, async () => {
    const fresh = await freshChat(repos, chat);
    const pool = await poolFor(repos, fresh, characterId);
    const current = readEquippedSet(fresh, characterId, pool);
    const removing = new Set<string>();
    const notEquipped: string[] = [];

    for (const id of Array.from(new Set(ids))) {
      const item = pool.resolveId(id);
      if (item?.kind === 'kit') {
        for (const memberId of item.itemIds) {
          for (const carried of current) {
            if (carried.id === memberId || carried.parentId === memberId) removing.add(carried.id);
          }
        }
        continue;
      }
      if (current.some((carried) => carried.id === id)) removing.add(id);
      else notEquipped.push(id);
    }

    const unequipped = current.filter((item) => removing.has(item.id));
    if (unequipped.length > 0) {
      await repos.chats.setEquippedInventory(
        fresh.id,
        characterId,
        current.filter((item) => !removing.has(item.id)).map((item) => item.id),
      );
      publishRealtime('chats', fresh.id);
    }
    logger.debug('[InventoryEquip] Unequipped', {
      op: 'unequip',
      chatId: fresh.id,
      characterId,
      unequipped: unequipped.map((item) => item.id),
      notEquipped,
      context: 'inventory',
    });
    await notifyInventoryChanged(repos, fresh, characterId, { equipped: [], unequipped }, ctx);
    return { unequipped, notEquipped };
  });
}

export interface PickUpResult {
  /** The instances made, in archetype order. */
  created: ResolvedInventoryItem[];
  /** Whether they were equipped. */
  equipped: boolean;
}

/**
 * Pick up an instance of each archetype for one character in one chat: the
 * instances land at the root of the character's vault (`title` overrides
 * the archetype's, when given) and, unless `equip` is false, are equipped.
 * When equipping, the cap is checked over the whole plan first —
 * `count(equipped kin) + planned kin + 1 ≤ maxEquipped` — and a breach throws
 * `CAP_EXCEEDED` with nothing written. A non-archetype is `INVALID_PARENT`.
 */
export function pickUpItems(
  repos: Repos,
  chat: EquipChat,
  characterId: string,
  archetypeIds: readonly string[],
  ctx: InventoryChangeContext,
  opts: { title?: string | null; equip?: boolean } = {},
): Promise<PickUpResult> {
  assertParticipant(chat, characterId);
  const equip = opts.equip !== false;
  return withChatInventoryLock(chat.id, async () => {
    const fresh = await freshChat(repos, chat);
    const pool = await poolFor(repos, fresh, characterId);
    const current = readEquippedSet(fresh, characterId, pool);

    const archetypes: ResolvedInventoryItem[] = [];
    for (const id of archetypeIds) {
      const archetype = pool.resolveId(id);
      if (!archetype || !archetype.isArchetype || archetype.archivedAt) {
        const error = new InventoryInvalidParentError(
          archetype && !archetype.isArchetype
            ? `"${archetype.title || archetype.name}" is not an archetype; equip it instead`
            : 'The parent must be an archetype this character can reach',
          { archetypeId: id },
        );
        logger.info('[InventoryEquip] Refused', { code: error.code, chatId: fresh.id, characterId, archetypeId: id, context: 'inventory' });
        throw error;
      }
      archetypes.push(archetype);
    }

    if (equip) {
      const counted: Array<Pick<ResolvedInventoryItem, 'name'>> = [...current];
      for (const archetype of archetypes) {
        const kin = counted.filter((other) => isKin(other, archetype)).length;
        if (kin + 1 > archetype.maxEquipped) {
          const error = new InventoryCapExceededError(archetype.id, archetype.title || archetype.name, archetype.maxEquipped);
          logger.info('[InventoryEquip] Refused', { code: error.code, op: 'pick-up', chatId: fresh.id, characterId, itemId: archetype.id, cap: archetype.maxEquipped, context: 'inventory' });
          throw error;
        }
        counted.push(archetype);
      }
    }

    const vault = await resolveInventoryLocation('character', characterId, repos, ctx.userId);
    if (!vault) throw new Error(`Character ${characterId} has no vault to pick an object up into`);
    const created: ResolvedInventoryItem[] = [];
    const title = opts.title?.trim();
    for (const archetype of archetypes) {
      const { item } = await instantiate(repos, vault, archetype.id, {
        pool,
        ...(title ? { overrides: { title } } : {}),
      });
      created.push(item);
    }
    publishRealtime('inventory');

    if (equip && created.length > 0) {
      await repos.chats.setEquippedInventory(fresh.id, characterId, [
        ...current.map((item) => item.id),
        ...created.map((item) => item.id),
      ]);
      publishRealtime('chats', fresh.id);
    }
    logger.debug('[InventoryEquip] Picked up', {
      op: 'pick-up',
      chatId: fresh.id,
      characterId,
      archetypes: archetypes.map((item) => item.id),
      created: created.map((item) => item.id),
      equipped: equip,
      context: 'inventory',
    });
    await notifyInventoryChanged(
      repos,
      fresh,
      characterId,
      { equipped: equip ? created : [], unequipped: [], pickedUp: created },
      ctx,
    );
    return { created, equipped: equip };
  });
}
