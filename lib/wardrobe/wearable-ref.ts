/**
 * Wearable references — the one lookup rule for a string that names a
 * garment or outfit.
 *
 * A wearable reference (a Pascal wardrobe effect's `items[]` entry, a
 * `wardrobe_*` tool's title argument) is an id or a case-insensitive title.
 * The rule is id first, then title, in the pool's own precedence order —
 * which the caller has already applied. The server's `findInPool` /
 * `WearablePool.findByTitle` and every Workbench surface that displays a
 * reference come through here, so the two can never disagree about which
 * garment a string names.
 *
 * Client-safe (no server imports).
 *
 * Design of record: docs/developer/features/complete/pascal-wardrobe-effect-picker.md §2.1
 *
 * @module lib/wardrobe/wearable-ref
 */

import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { scanPlaceholders } from '@/lib/pascal/placeholders';

type RefTarget = Pick<WardrobeItem, 'id' | 'title'>;

/**
 * The first item in `pool` whose title matches `title`, trimmed and
 * case-insensitive. The title half of {@link resolveWearableRef}, and the
 * whole of the server pool's `findByTitle`.
 */
export function matchWearableTitle<T extends RefTarget>(pool: readonly T[], title: string): T | undefined {
  const wanted = title.trim().toLowerCase();
  if (!wanted) return undefined;
  return pool.find((item) => item.title.toLowerCase() === wanted);
}

/** True when a reference carries a `{{…}}` placeholder and so is chosen at run time. */
export function isTemplatedWearableRef(ref: string): boolean {
  return scanPlaceholders(ref).length > 0;
}

/**
 * The one lookup rule for a wearable reference: id first, then
 * case-insensitive title, the pool's own-items-first order already applied by
 * the caller. A templated reference is never resolved — its garment is chosen
 * when the tool runs.
 */
export function resolveWearableRef<T extends RefTarget>(pool: readonly T[], ref: string): T | undefined {
  const trimmed = ref.trim();
  if (!trimmed || isTemplatedWearableRef(trimmed)) return undefined;
  return pool.find((item) => item.id === trimmed) ?? matchWearableTitle(pool, trimmed);
}
