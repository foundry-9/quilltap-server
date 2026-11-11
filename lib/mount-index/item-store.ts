/**
 * The item-store kernel — what the Wardrobe, the Inventory and the Atlas share
 * beneath their own rules (Refactor 4.13, item-family kernel).
 *
 * Each family keeps its chokepoint files (`location.ts`, `vault-writes.ts`,
 * `item-mutations.ts`, `pool.ts`) as thin bindings over this module:
 *
 * - {@link readTiers} reads the tiers of a reach and says what it could not
 *   read; {@link shadowLayers} shadows them, strongest first, first wins.
 * - {@link foldItemName} is the one name fold used for identity.
 *
 * **A whole-set rewrite never treats "unread" as "gone"** (#186): a reader
 * that rewrites a stored set from a pool consults {@link TierReads.unread}
 * before pruning what the pool could not resolve.
 *
 * Server-only.
 *
 * @module lib/mount-index/item-store
 */

import { logger } from '@/lib/logger';

/** The three item families. Their folder name and log context. */
export type ItemFamilyKind = 'wardrobe' | 'inventory' | 'atlas';

// ============================================================================
// Tier reads
// ============================================================================

/** A source the reach could not read, and why. */
export interface UnreadMount {
  mountPointId: string;
  error: string;
}

/** One tier of a reach: its mounts strongest first, and how to read one. */
export interface TierSpec<R> {
  /** The tier's mounts in the settled within-tier order (`orderMounts`), strongest first. */
  mountPointIds: readonly string[];
  /** Read one mount's records, already tagged with their origin. Throws on failure. */
  read: (mountPointId: string) => Promise<readonly R[]>;
}

/** What {@link readTiers} returns: everything in tier order, strongest first. */
export interface TierReads<R> {
  /** One layer per tier, in the order given; within a layer, strongest mount first. */
  layers: R[][];
  /** The mounts that failed to read, in tier order. */
  unread: UnreadMount[];
  /** Every mount tried, in tier order, strongest first within a tier. */
  consulted: string[];
}

/**
 * Read the tiers of a reach. The tiers are read concurrently, each tier's
 * mounts one after another strongest first; the bookkeeping is joined in tier
 * order after the reads settle, so it never depends on settlement order
 * (#155). Fails soft per mount: a failure is logged at `warn` and noted in
 * `unread`, so a caller that must not guess can tell "this tier is empty"
 * from "this tier was not read".
 */
export async function readTiers<R>(
  kind: ItemFamilyKind,
  tiers: readonly TierSpec<R>[],
): Promise<TierReads<R>> {
  const reads = await Promise.all(
    tiers.map(async (tier) => {
      const records: R[] = [];
      const consulted: string[] = [];
      const unread: UnreadMount[] = [];
      for (const mountPointId of tier.mountPointIds) {
        consulted.push(mountPointId);
        try {
          records.push(...(await tier.read(mountPointId)));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          unread.push({ mountPointId, error: message });
          logger.warn('[ItemStore] Failed to read a tier mount; skipping it', {
            kind,
            mountPointId,
            context: kind,
            error: message,
          });
        }
      }
      return { records, consulted, unread };
    }),
  );
  return {
    layers: reads.map((read) => read.records),
    unread: reads.flatMap((read) => read.unread),
    consulted: reads.flatMap((read) => read.consulted),
  };
}

/**
 * Shadow layers given strongest first: the first record to claim a key keeps
 * it. Inside a tier the earlier mount wins and across tiers the stronger tier
 * wins — one rule, one spelling. Pure; the order of the result is
 * strongest-first claim order.
 */
export function shadowLayers<R>(
  layers: ReadonlyArray<readonly R[]>,
  keyOf: (record: R) => string,
): { byKey: Map<string, R>; shadowedCount: number } {
  const byKey = new Map<string, R>();
  let shadowedCount = 0;
  for (const layer of layers) {
    for (const record of layer) {
      const key = keyOf(record);
      if (byKey.has(key)) {
        shadowedCount++;
        continue;
      }
      byKey.set(key, record);
    }
  }
  return { byKey, shadowedCount };
}

// ============================================================================
// Names (client-safe; `item-names.ts`)
// ============================================================================

export { foldItemName } from '@/lib/mount-index/item-names';
