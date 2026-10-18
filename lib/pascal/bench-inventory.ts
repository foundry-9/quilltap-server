/**
 * The Proving Bench's Inventory lens — a mock bag an author types so `when`
 * rows and gates on `inventory` / `inventoryCount` can be proved without a
 * character (spec inventory-tools-and-pascal §5.8).
 *
 * Each row names a reference, its state, and optionally how many kin are
 * equipped (default: 1 when equipped, else 0). A reference no row names reads
 * `absent` with a count of 0. The bench cannot tell whether an object
 * exists, so `item()` is always null: `{{inventory.<ref>.title}}` and the
 * other fields render as written, and every `$inventory` operand falls back.
 *
 * CLIENT-SAFE: pure.
 *
 * @module lib/pascal/bench-inventory
 */

import { z } from 'zod';
import type { InventoryContext, InventoryState } from '@/lib/inventory/refs';
import { INVENTORY_STATE_VALUES } from './inventory-subjects';

/** One mock row, as the bench sends it. */
export const MockInventoryRowSchema = z.strictObject({
  ref: z.string().min(1).max(200),
  state: z.enum(INVENTORY_STATE_VALUES),
  count: z.number().int().min(0).max(999).optional(),
});
export type MockInventoryRow = z.infer<typeof MockInventoryRowSchema>;

/** The bench body's `inventory` field. */
export const MockInventorySchema = z.array(MockInventoryRowSchema).max(64);

/** A context over mock rows. Later rows for the same reference win. */
export function mockInventoryContext(rows: readonly MockInventoryRow[]): InventoryContext {
  const byRef = new Map<string, { state: InventoryState; count: number }>();
  for (const row of rows) {
    const key = row.ref.trim().toLowerCase();
    if (!key) continue;
    byRef.set(key, { state: row.state, count: row.count ?? (row.state === 'equipped' ? 1 : 0) });
  }
  const lookup = (ref: string) => byRef.get(ref.trim().toLowerCase());
  return {
    characterId: 'bench',
    chatId: null,
    state: (ref) => lookup(ref)?.state ?? 'absent',
    equippedKinCount: (ref) => lookup(ref)?.count ?? 0,
    item: () => null,
  };
}
