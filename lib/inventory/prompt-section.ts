/**
 * The Inventory's prompt section — what a character carries, told to the
 * model as a trailing per-turn section.
 *
 * `buildInventorySection` reads the character's equipped set in the chat,
 * keeps objects with a `description` (what the characters know about it; kits
 * never appear, their members do), sorts them by `title ?? name` and renders
 *
 *   ## Carried and equipped
 *   - Excalibur (sword): A longsword whose blade is never dulled…
 *   - Signet ring: Proves the bearer is of House Vane.
 *
 * Never in system block 1, and no builder version is bumped: it rides the
 * uncached trailing tail beside the progressions report, after it and before
 * the inform block. **Empty is absent**: with nothing equipped-and-described
 * it returns null and the caller adds nothing, so an unrelated turn stays
 * byte-identical. A character's `imageDescription` never reaches the model
 * here — that goes to the image pipelines (`image-description.ts`).
 *
 * Reads only (no writes on the prompt path), so a turn in the job child runs
 * it exactly as the parent does. Never throws.
 *
 * Server-only.
 *
 * @module lib/inventory/prompt-section
 */

import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { loadEquippedSet } from '@/lib/inventory/equipped-set';
import { inventoryDisplayName, inventoryLabel } from '@/lib/inventory/resolve';

/** The section's heading. */
export const INVENTORY_SECTION_HEADER = '## Carried and equipped';

/** Render the section from resolved objects, or null when none has a description. Pure. */
export function renderInventorySection(items: readonly ResolvedInventoryItem[]): string | null {
  const described = items
    .filter((item) => item.kind !== 'kit' && item.description?.trim())
    .sort((a, b) => inventoryLabel(a).localeCompare(inventoryLabel(b), undefined, { sensitivity: 'base' }));
  if (described.length === 0) return null;
  const lines = described.map((item) => `- ${inventoryDisplayName(item)}: ${(item.description as string).trim()}`);
  return `${INVENTORY_SECTION_HEADER}\n${lines.join('\n')}`;
}

export interface BuildInventorySectionParams {
  chat: { id: string; projectId?: string | null; equippedInventory?: unknown };
  characterId: string;
  repos: Pick<RepositoryContainer, 'characters' | 'chats'>;
}

/** The trailing section for one character's turn, or null. */
export async function buildInventorySection(params: BuildInventorySectionParams): Promise<string | null> {
  const { chat, characterId, repos } = params;
  try {
    // Nothing stored reads no pool at all (`loadEquippedSet`), the common case; nothing to log either.
    const carried = await loadEquippedSet(repos, chat, characterId);
    if (carried.length === 0) return null;
    const section = renderInventorySection(carried);
    logger.debug('[InventorySection] Built the carried-objects section', {
      chatId: chat.id,
      characterId,
      present: section !== null,
      op: 'prompt-section',
      context: 'inventory',
    });
    return section;
  } catch (error) {
    logger.warn('[InventorySection] Failed to build the carried-objects section; turn continues', {
      chatId: chat.id,
      characterId,
      context: 'inventory',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
