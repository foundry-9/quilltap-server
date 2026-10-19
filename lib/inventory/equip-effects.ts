/**
 * Inventory change effects — what follows a gesture that changes what a
 * character carries in a chat. The one chokepoint is
 * {@link notifyInventoryChanged}:
 *
 *   - when `ctx.announce`, Pascal posts one plain line for the gesture
 *     (`systemKind: 'inventory-change'`, no roll record): *"Vivienne takes up
 *     Excalibur and a signet ring."* / *"Vivienne sets down the lantern."*;
 *   - the character's per-chat avatar is refreshed the way an outfit change
 *     refreshes it (`refreshAvatarForAppearance`), so a newly carried sword
 *     can reach the portrait.
 *
 * Arrival defaults pass `announce: false` (arrival is not a gesture), and a
 * mutation outside a chat never comes here.
 *
 * Inside a model turn the context carries the turn's
 * `pendingInventoryAnnouncements` (created by `newWardrobeTurnContainers`):
 * the change is recorded there instead, netted with the turn's other changes
 * for that character, and posted once — line and avatar refresh — by
 * {@link flushPendingInventoryAnnouncements} at turn end, so a character's
 * `inventory_*` calls and a Pascal inventory effect in one turn read as one
 * line. A give (`change.given`) always posts a line of its own, at once.
 *
 * Server-only.
 *
 * @module lib/inventory/equip-effects
 */

import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { inventoryLabel } from '@/lib/inventory/resolve';
import { refreshAvatarForAppearance } from '@/lib/wardrobe/outfit-change-effects';
import type { PendingInventoryChange, WardrobeTurnContainers } from '@/lib/wardrobe/turn-containers';
import { postPascalInventoryChange } from '@/lib/services/pascal/writer';

/** Who is changing what a character carries: the operator, the character's own tool call, or a custom tool. */
export type InventoryChangeProvenance = 'operator' | 'character' | 'pascal';

/** Who is changing what a character carries, and the turn's pending set if there is one. */
export interface InventoryChangeContext extends Pick<WardrobeTurnContainers, 'pendingInventoryAnnouncements'> {
  userId: string;
  provenance: InventoryChangeProvenance;
  /** Post Pascal's line for this gesture. False at arrival. */
  announce: boolean;
}

/** One change: what was taken up and what was set down. */
export interface InventoryChange {
  equipped: readonly ResolvedInventoryItem[];
  unequipped: readonly ResolvedInventoryItem[];
  /** Instances made from an archetype in this gesture (named "picks up"). */
  pickedUp?: readonly ResolvedInventoryItem[];
  /** A give: the object handed over and the receiver's name. */
  given?: { item: ResolvedInventoryItem; toName: string };
}

function withArticle(item: ResolvedInventoryItem, article: 'a' | 'the'): string {
  if (item.title?.trim()) return item.title.trim();
  const name = item.name.trim();
  if (article === 'the') return `the ${name}`;
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * Pascal's line for a change, or null when nothing changed. Untitled objects
 * take an article ("a signet ring" taken up, "the lantern" set down); titled
 * ones are named ("Excalibur").
 */
export function describeInventoryChange(characterName: string, change: InventoryChange): string | null {
  if (change.given) {
    return `*${characterName} hands ${withArticle(change.given.item, 'the')} to ${change.given.toName}.*`;
  }
  const clauses: string[] = [];
  const pickedIds = new Set((change.pickedUp ?? []).map((item) => item.id));
  if (change.unequipped.length > 0) {
    clauses.push(`sets down ${joinList(change.unequipped.map((item) => withArticle(item, 'the')))}`);
  }
  const takenUp = change.equipped.filter((item) => !pickedIds.has(item.id));
  if (takenUp.length > 0) {
    clauses.push(`takes up ${joinList(takenUp.map((item) => withArticle(item, 'a')))}`);
  }
  if (pickedIds.size > 0) {
    clauses.push(`picks up ${joinList((change.pickedUp ?? []).map((item) => withArticle(item, 'a')))}`);
  }
  if (clauses.length === 0) return null;
  return `*${characterName} ${clauses.join(' and ')}.*`;
}

/**
 * The effects of one gesture. Call once per equip or unequip, and only when
 * something changed. Never throws.
 */
export async function notifyInventoryChanged(
  repos: RepositoryContainer,
  chat: { id: string },
  characterId: string,
  change: InventoryChange,
  ctx: InventoryChangeContext,
): Promise<void> {
  const picked = change.pickedUp ?? [];
  if (change.equipped.length === 0 && change.unequipped.length === 0 && picked.length === 0 && !change.given) return;
  const pending = ctx.pendingInventoryAnnouncements;
  if (pending && ctx.announce && !change.given) {
    recordPendingInventoryChange(pending, { userId: ctx.userId, chatId: chat.id, characterId }, change, ctx.provenance);
    logger.debug('[InventoryEffects] Inventory change joined the turn', {
      chatId: chat.id,
      characterId,
      provenance: ctx.provenance,
      context: 'inventory',
    });
    return;
  }
  if (pending && change.given) {
    // The give posts now, so the object must not also be announced at turn
    // end as taken up or picked up by the giver.
    strikeFromPendingInventoryChange(pending, `${chat.id}:${characterId}`, change.given.item.id);
  }
  try {
    if (ctx.announce) {
      const character = await repos.characters.findById(characterId);
      const content = describeInventoryChange(character?.name ?? 'Someone', change);
      if (content) await postPascalInventoryChange({ chatId: chat.id, content });
    }
    await refreshAvatarForAppearance(
      repos,
      { userId: ctx.userId, chatId: chat.id, characterId },
      'inventory-change',
    );
    logger.debug('[InventoryEffects] Inventory change effects fired', {
      chatId: chat.id,
      characterId,
      announced: ctx.announce,
      provenance: ctx.provenance,
      equipped: change.equipped.map(inventoryLabel),
      unequipped: change.unequipped.map(inventoryLabel),
      context: 'inventory',
    });
  } catch (error) {
    logger.warn('[InventoryEffects] Inventory change effects failed', {
      chatId: chat.id,
      characterId,
      context: 'inventory',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function pushUnique(list: ResolvedInventoryItem[], item: ResolvedInventoryItem): void {
  if (!list.some((existing) => existing.id === item.id)) list.push(item);
}

/** Fold a change into the turn's pending entry for the character, netting opposites. */
export function recordPendingInventoryChange(
  pending: Map<string, PendingInventoryChange>,
  who: { userId: string; chatId: string; characterId: string },
  change: InventoryChange,
  provenance: InventoryChangeProvenance,
): void {
  const key = `${who.chatId}:${who.characterId}`;
  const entry = pending.get(key) ?? { ...who, equipped: [], unequipped: [], pickedUp: [], provenances: [] };
  if (!entry.provenances.includes(provenance)) entry.provenances.push(provenance);
  for (const item of change.equipped) {
    const undone = entry.unequipped.findIndex((other) => other.id === item.id);
    if (undone >= 0) entry.unequipped.splice(undone, 1);
    else pushUnique(entry.equipped, item);
  }
  for (const item of change.unequipped) {
    const undone = entry.equipped.findIndex((other) => other.id === item.id);
    if (undone >= 0) {
      entry.equipped.splice(undone, 1);
      // Picked up and set down in one turn: no pick-up to announce either.
      removeById(entry.pickedUp, item.id);
    } else pushUnique(entry.unequipped, item);
  }
  for (const item of change.pickedUp ?? []) pushUnique(entry.pickedUp, item);
  pending.set(key, entry);
}

function removeById(list: ResolvedInventoryItem[], id: string): void {
  const at = list.findIndex((item) => item.id === id);
  if (at >= 0) list.splice(at, 1);
}

/** Take one object out of a character's pending entry altogether (it was given away this turn). */
export function strikeFromPendingInventoryChange(
  pending: Map<string, PendingInventoryChange>,
  key: string,
  itemId: string,
): void {
  const entry = pending.get(key);
  if (!entry) return;
  removeById(entry.equipped, itemId);
  removeById(entry.unequipped, itemId);
  removeById(entry.pickedUp, itemId);
}

/**
 * Drain the turn's pending Inventory changes: one Pascal line and one avatar
 * refresh per character that changed. Idempotent: the map is cleared. Never
 * throws.
 */
export async function flushPendingInventoryAnnouncements(
  context: Pick<WardrobeTurnContainers, 'pendingInventoryAnnouncements'>,
  repos?: RepositoryContainer,
): Promise<void> {
  const pending = context.pendingInventoryAnnouncements;
  if (!pending || pending.size === 0) return;
  const entries = Array.from(pending.values());
  pending.clear();
  const effectiveRepos = repos ?? (await import('@/lib/repositories/factory')).getRepositories();
  for (const entry of entries) {
    await notifyInventoryChanged(
      effectiveRepos,
      { id: entry.chatId },
      entry.characterId,
      { equipped: entry.equipped, unequipped: entry.unequipped, pickedUp: entry.pickedUp },
      { userId: entry.userId, provenance: entry.provenances[0] ?? 'character', announce: true },
    );
  }
  logger.debug('[InventoryEffects] Drained the turn\'s Inventory announcements', {
    characters: entries.length,
    provenances: entries.map((entry) => ({ characterId: entry.characterId, provenances: entry.provenances })),
    context: 'inventory',
  });
}
