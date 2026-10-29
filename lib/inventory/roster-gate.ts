/**
 * The project roster at the Inventory — the wardrobe's rule
 * (`lib/projects/roster-access.ts`) applied to the project's `Inventory/`.
 *
 * The roster closes the shelf, not the hand. A character the project's roster
 * does not admit cannot, through their own tools or a custom tool's effects,
 * see, take up or pick up an object on the project's shelf. Whatever they are
 * already carrying stays theirs to see and set down — the operator may have
 * handed it to them, and the carried set is rewritten whole, so hiding a
 * carried object would drop it. The operator's own gestures, arrival defaults
 * and every reader of what is carried (the prompt section, the image
 * pipelines) are not gated, exactly as the wardrobe's are not.
 *
 * Server-only.
 *
 * @module lib/inventory/roster-gate
 */

import { logger } from '@/lib/logger';
import { projectRosterAdmits } from '@/lib/projects/roster-access';
import type { InventoryChangeProvenance } from '@/lib/inventory/equip-effects';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';

/** Whether a gesture is the character's own (a tool call or a custom tool), and so roster-gated. */
export function isCharacterGesture(provenance: InventoryChangeProvenance): boolean {
  return provenance !== 'operator';
}

/**
 * Whether the project's shelf is open to this character's own reach: no
 * project, or the roster admits them. A failed lookup closes it.
 */
export async function projectShelfOpenTo(projectId: string | null | undefined, characterId: string): Promise<boolean> {
  if (!projectId) return true;
  try {
    return await projectRosterAdmits(projectId, characterId);
  } catch (error) {
    logger.warn('[InventoryRoster] Roster lookup failed; the project shelf stays closed', {
      projectId,
      characterId,
      context: 'inventory',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** An object on the project's shelf that the character is not carrying: what a closed shelf hides. */
export function isOnClosedShelf(
  item: Pick<ResolvedInventoryItem, 'id' | 'origin'>,
  carriedIds: ReadonlySet<string>,
): boolean {
  return item.origin?.scope === 'project' && !carriedIds.has(item.id);
}
