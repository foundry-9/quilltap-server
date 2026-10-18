/**
 * Inventory references — the one rule that turns a string into objects.
 *
 * A reference names an object by its id, else its title, else its name,
 * case-insensitively (spec inventory-tools-and-pascal §5.1). Every
 * `inventory_*` tool, Pascal's `inventory` / `inventoryCount` subjects, the
 * `{{inventory.*}}` placeholders, the `$inventory` operand and the
 * `inventory` effect resolve through here; nothing else re-derives
 * id-or-title-or-name. A reference that resolves to nothing is `absent`,
 * never an error.
 *
 * Also the {@link InventoryContext}: what one tool call or one custom-tool run
 * knows about the rolling character's bag, built once and handed to every
 * reader. The server builds it from a pool and a chat
 * (`lib/inventory/context.ts`); the Proving Bench builds a mock one
 * (`lib/pascal/bench-inventory.ts`).
 *
 * Client-safe: pure.
 *
 * @module lib/inventory/refs
 */

import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { isKin, kitState } from '@/lib/inventory/resolve';

/** Where an object stands for the rolling character in this chat. */
export type InventoryState = 'equipped' | 'carried' | 'reachable' | 'absent';

/** The four states, best first. */
export const INVENTORY_STATES: readonly InventoryState[] = ['equipped', 'carried', 'reachable', 'absent'];

/** The resolved objects a character can reach, and which of them are their own. */
export interface ResolvedInventoryPool {
  /** Every reachable object, resolved; the holder's own archived ones included. */
  items: readonly ResolvedInventoryItem[];
  /** True when the object lives in the holder's own tier. */
  owns(id: string): boolean;
}

export interface InventoryRefMatch {
  item: ResolvedInventoryItem;
  equipped: boolean;
  own: boolean;
}

export interface ResolveInventoryRefOptions {
  /** Archetypes match too (a pick-up names one). Default false. */
  includeArchetypes?: boolean;
  /** The holder's own archived objects match too (a restore names one). Default false. */
  includeArchived?: boolean;
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** A pool's objects by id, built once per pool (its `items` array) and reused. */
const byIdCache = new WeakMap<readonly ResolvedInventoryItem[], Map<string, ResolvedInventoryItem>>();

function byIdOf(pool: ResolvedInventoryPool): Map<string, ResolvedInventoryItem> {
  let byId = byIdCache.get(pool.items);
  if (!byId) {
    byId = new Map(pool.items.map((candidate) => [candidate.id, candidate]));
    byIdCache.set(pool.items, byId);
  }
  return byId;
}

/** Is this object carried? A kit is carried when every member is. */
function isEquippedIn(
  item: ResolvedInventoryItem,
  pool: ResolvedInventoryPool,
  equippedIds: ReadonlySet<string>,
): boolean {
  if (item.kind !== 'kit') return equippedIds.has(item.id);
  const byId = byIdOf(pool);
  const equipped = Array.from(equippedIds)
    .map((id) => byId.get(id))
    .filter((candidate): candidate is ResolvedInventoryItem => !!candidate);
  return kitState(item, equipped, (id) => byId.get(id)) === 'all';
}

/**
 * id → title → name, case-insensitive, over the resolved pool. The first rule
 * that matches anything wins; matches come own tier first. Archetypes and
 * archived objects are excluded unless asked.
 */
export function resolveInventoryRef(
  ref: string,
  pool: ResolvedInventoryPool,
  equippedIds: ReadonlySet<string>,
  opts: ResolveInventoryRefOptions = {},
): InventoryRefMatch[] {
  const wanted = norm(ref);
  if (!wanted) return [];
  const candidates = pool.items.filter(
    (item) =>
      (opts.includeArchetypes || !item.isArchetype) &&
      (!item.archivedAt || (opts.includeArchived && pool.owns(item.id))),
  );
  const rules: Array<(item: ResolvedInventoryItem) => boolean> = [
    (item) => norm(item.id) === wanted,
    (item) => !!item.title && norm(item.title) === wanted,
    (item) => norm(item.name) === wanted,
  ];
  for (const rule of rules) {
    const hits = candidates.filter(rule);
    if (hits.length === 0) continue;
    const matches = hits.map((item) => ({
      item,
      equipped: isEquippedIn(item, pool, equippedIds),
      own: pool.owns(item.id),
    }));
    // Own tier before shared; otherwise the pool's order.
    return [...matches.filter((m) => m.own), ...matches.filter((m) => !m.own)];
  }
  return [];
}

/** The best state among the matches: equipped > carried > reachable > absent. */
export function stateOf(matches: readonly InventoryRefMatch[]): InventoryState {
  const carriable = matches.filter((m) => !m.item.isArchetype && !m.item.archivedAt);
  if (carriable.some((m) => m.equipped)) return 'equipped';
  if (carriable.some((m) => m.own)) return 'carried';
  if (carriable.length > 0) return 'reachable';
  return 'absent';
}

/** Equipped kin (same resolved name, case-insensitive) of `name`. */
export function equippedKinCountByName(
  name: string,
  pool: ResolvedInventoryPool,
  equippedIds: ReadonlySet<string>,
): number {
  return pool.items.filter(
    (item) => equippedIds.has(item.id) && !item.archivedAt && item.kind !== 'kit' && isKin(item, { name }),
  ).length;
}

/** Equipped kin of the first match's resolved name (an archetype reference counts its instances). */
export function equippedKinCount(
  ref: string,
  pool: ResolvedInventoryPool,
  equippedIds: ReadonlySet<string>,
): number {
  const first = resolveInventoryRef(ref, pool, equippedIds, { includeArchetypes: true })[0];
  return first ? equippedKinCountByName(first.item.name, pool, equippedIds) : 0;
}

/**
 * For a gesture: the match to act on — the first equipped one for unequip,
 * the first unequipped, carriable one for equip (kits allowed), own tier
 * before shared. Null when none qualifies.
 */
export function pickForGesture(
  matches: readonly InventoryRefMatch[],
  action: 'equip' | 'unequip',
): InventoryRefMatch | null {
  if (action === 'unequip') return matches.find((m) => m.equipped) ?? null;
  return matches.find((m) => !m.equipped && !m.item.isArchetype && !m.item.archivedAt) ?? null;
}

// ============================================================================
// The context one call or one run reads
// ============================================================================

/** What one tool call or one custom-tool run knows about the rolling character's bag. */
export interface InventoryContext {
  characterId: string;
  chatId: string | null;
  /** The best state of a reference. */
  state(ref: string): InventoryState;
  /** Equipped kin of a reference. */
  equippedKinCount(ref: string): number;
  /** The object a reference reads as (equipped first, then own, then shared), or null. */
  item(ref: string): ResolvedInventoryItem | null;
  /** The real pool and equipped ids; absent on a mock (the bench). */
  pool?: ResolvedInventoryPool;
  equippedIds?: ReadonlySet<string>;
}

/** Build a context over a resolved pool and the character's equipped ids. Pure. */
export function inventoryContextFrom(
  characterId: string,
  chatId: string | null,
  pool: ResolvedInventoryPool,
  equippedIds: ReadonlySet<string>,
): InventoryContext {
  return {
    characterId,
    chatId,
    pool,
    equippedIds,
    state: (ref) => stateOf(resolveInventoryRef(ref, pool, equippedIds)),
    equippedKinCount: (ref) => equippedKinCount(ref, pool, equippedIds),
    item: (ref) => {
      const matches = resolveInventoryRef(ref, pool, equippedIds);
      return (matches.find((m) => m.equipped) ?? matches.find((m) => m.own) ?? matches[0])?.item ?? null;
    },
  };
}
