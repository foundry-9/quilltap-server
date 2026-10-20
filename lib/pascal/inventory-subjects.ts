/**
 * Pascal's Inventory subjects — the read side of the bag (spec
 * inventory-tools-and-pascal §5.3–5.5), stated once for every reader.
 *
 * - The `inventory` subject asks an object's state (`equipped` / `carried` /
 *   `reachable` / `absent`) with `eq` / `neq`; `inventoryCount` asks how many
 *   kin are equipped, with the ordering ladder.
 * - The `$inventory` operand reads one `metadata` key of one object, typed by
 *   its fallback.
 *
 * Fail-soft like `metadata`, and in the same direction: with no context (a
 * run nobody made, or a vault that could not be read) every comparator
 * DECLINES — including `eq: "absent"`, `neq`, and `lt: 1` — exactly as
 * `metadataComparatorHolds` declines on a missing key. Only a real context
 * ever yields `absent` or `0`.
 *
 * Every reference resolves through the context, which resolves through
 * `resolveInventoryRef` (`lib/inventory/refs.ts`).
 *
 * CLIENT-SAFE: pure, no logger. The Workbench runs it against a mock
 * inventory.
 *
 * @module lib/pascal/inventory-subjects
 */

import type { InventoryContext, InventoryState } from '@/lib/inventory/refs';
import { splitInventoryReference } from './placeholders';
import { compareOrdered } from './metadata-match';
import { gateGroups, type ToolGate } from './custom-tool.types';

export type { InventoryContext, InventoryState } from '@/lib/inventory/refs';

/** The four states, as the schema's enum spells them. */
export const INVENTORY_STATE_VALUES = ['equipped', 'carried', 'reachable', 'absent'] as const;

/** The parts of a `$inventory` operand: `<ref>.metadata.<key>`, split at the first `.metadata.`. */
export function parseInventoryOperand(path: string): { ref: string; key: string } | null {
  const parts = splitInventoryReference(path);
  if (!parts || parts.field !== 'metadata' || !parts.key) return null;
  return { ref: parts.ref, key: parts.key };
}

/**
 * Resolve a `$inventory` operand. Total: returns the object's metadata value
 * only when it exists and its `typeof` matches the fallback's, else the
 * fallback. A null context, an unparseable path or an absent object all fall
 * back.
 */
export function resolveInventoryValue(
  operand: { $inventory: string; fallback: number | string | boolean },
  ctx: InventoryContext | null | undefined,
): number | string | boolean {
  if (!ctx) return operand.fallback;
  const parsed = parseInventoryOperand(operand.$inventory);
  if (!parsed) return operand.fallback;
  const value = ctx.item(parsed.ref)?.metadata?.[parsed.key];
  if (typeof value !== typeof operand.fallback) return operand.fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : operand.fallback;
  return value as string | boolean;
}

/** Why a comparator declined, for a caller that logs it. */
export type InventoryDecline = (reason: string) => void;

/** An `inventory` state comparator with its operands already resolved. */
export interface ResolvedInventoryStateTest {
  eq?: string;
  neq?: string;
}

/** Whether a state test holds for `ref`. Null context → declines. */
export function inventoryStateHolds(
  test: ResolvedInventoryStateTest,
  ref: string,
  ctx: InventoryContext | null | undefined,
  onDecline?: InventoryDecline,
): boolean {
  if (!ctx) {
    onDecline?.('no inventory to read (nobody in particular rolled, or the vault could not be read)');
    return false;
  }
  const state: InventoryState = ctx.state(ref);
  if (test.eq !== undefined && state !== test.eq) return false;
  if (test.neq !== undefined && state === test.neq) return false;
  return true;
}

/** An `inventoryCount` comparator with its operands already resolved to numbers. */
export type ResolvedInventoryCountTest = Partial<Record<'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq', number>>;

/** Whether a count test holds for `ref`. Null context → declines. */
export function inventoryCountHolds(
  test: ResolvedInventoryCountTest,
  ref: string,
  ctx: InventoryContext | null | undefined,
  onDecline?: InventoryDecline,
): boolean {
  if (!ctx) {
    onDecline?.('no inventory to count (nobody in particular rolled, or the vault could not be read)');
    return false;
  }
  const count = ctx.equippedKinCount(ref);
  for (const key of ['gt', 'gte', 'lt', 'lte'] as const) {
    const operand = test[key];
    if (operand !== undefined && !compareOrdered(key, count, operand)) return false;
  }
  if (test.eq !== undefined && count !== test.eq) return false;
  if (test.neq !== undefined && count === test.neq) return false;
  return true;
}

/** True when a gate clause names an Inventory subject (`inventory`, `inventoryCount` or `inventoryAggregate`) in any group. */
export function gateNamesInventory(gate: ToolGate | undefined): boolean {
  return (
    !!gate &&
    gateGroups(gate).some(
      (group) =>
        Object.keys(group.inventory ?? {}).length > 0 ||
        Object.keys(group.inventoryCount ?? {}).length > 0 ||
        Object.keys(group.inventoryAggregate ?? {}).length > 0
    )
  );
}
