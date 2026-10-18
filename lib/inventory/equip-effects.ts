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
 * Server-only.
 *
 * @module lib/inventory/equip-effects
 */

import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { inventoryLabel } from '@/lib/inventory/resolve';
import { refreshAvatarForAppearance } from '@/lib/wardrobe/outfit-change-effects';
import { postPascalInventoryChange } from '@/lib/services/pascal/writer';

/** Who is changing what a character carries. The tools spec adds `character` and `pascal`. */
export interface InventoryChangeContext {
  userId: string;
  provenance: 'operator';
  /** Post Pascal's line for this gesture. False at arrival. */
  announce: boolean;
}

/** One change: what was taken up and what was set down. */
export interface InventoryChange {
  equipped: readonly ResolvedInventoryItem[];
  unequipped: readonly ResolvedInventoryItem[];
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
  const clauses: string[] = [];
  if (change.unequipped.length > 0) {
    clauses.push(`sets down ${joinList(change.unequipped.map((item) => withArticle(item, 'the')))}`);
  }
  if (change.equipped.length > 0) {
    clauses.push(`takes up ${joinList(change.equipped.map((item) => withArticle(item, 'a')))}`);
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
  if (change.equipped.length === 0 && change.unequipped.length === 0) return;
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
