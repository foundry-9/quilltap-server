/**
 * Wardrobe dressing instructions — the optional `Wardrobe/instructions.md`
 * file a user may keep at any wardrobe tier, addressed to the character in
 * the second person ("you prefer to wear…").
 *
 * Read in exactly one place: the `llm_choose` outfit selection ("Dress
 * Themselves"), where the winning file's content is handed to the cheap-LLM
 * prompt. The cascade runs nearest-tier-first — character vault, then group,
 * then project, then Quilltap General — and stops at the first tier whose
 * file exists with non-blank content. It deliberately influences nothing
 * else.
 *
 * @module wardrobe/wardrobe-instructions
 */

import { logger } from '@/lib/logger';
import { readVaultTextFile } from '@/lib/database/repositories/vault-overlay/vault-readers';
import {
  CHARACTER_WARDROBE_FOLDER,
  WARDROBE_INSTRUCTIONS_PATH,
} from '@/lib/mount-index/character-vault';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import {
  writeDatabaseDocument,
  deleteDatabaseDocumentIfExists,
} from '@/lib/mount-index/database-store';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { orderMounts } from '@/lib/mount-index/reach';

export type WardrobeInstructionsTier = 'character' | 'group' | 'project' | 'general';

export interface WardrobeInstructionsResult {
  /** Trimmed, non-blank instructions content. */
  content: string;
  /** Which tier won the cascade. */
  tier: WardrobeInstructionsTier;
  /** The mount the winning file was read from. */
  mountPointId: string;
}

/**
 * Resolve the dressing instructions for a character about to choose their own
 * outfit. First tier with a non-blank `Wardrobe/instructions.md` wins and the
 * search stops there; a file that exists but trims to empty counts as absent,
 * so clearing the editor behaves as "unset". Per-tier read failures degrade
 * to "not found" (`readVaultTextFile` already logs and returns null), so this
 * never throws on a broken mount.
 */
export async function resolveWardrobeInstructions(opts: {
  characterMountPointId: string | null;
  groupMountPointIds: readonly string[];
  projectMountPointIds: readonly string[];
}): Promise<WardrobeInstructionsResult | null> {
  // Probe in the settled order (`orderMounts`): nearest tier first, and
  // inside a tier the earlier mount wins — membership order for groups, the
  // official store first for the project. Never by mount id.
  const probes = orderMounts({
    characterMountPointId: opts.characterMountPointId,
    participantMountPointIds: [],
    groupMountPointIds: [...opts.groupMountPointIds],
    projectMountPointIds: [...opts.projectMountPointIds],
    globalMountPointId: await getGeneralMountPointId(),
  }).map(({ tier, mountPointId }) => ({
    tier: (tier === 'global' ? 'general' : tier) as WardrobeInstructionsTier,
    mountPointId,
  }));

  for (const { tier, mountPointId } of probes) {
    const raw = await readVaultTextFile(mountPointId, WARDROBE_INSTRUCTIONS_PATH);
    const content = raw?.trim() ?? '';
    if (content.length === 0) continue;
    logger.debug('[WardrobeInstructions] Dressing instructions resolved', {
      tier,
      mountPointId,
      contentLength: content.length,
    });
    return { content, tier, mountPointId };
  }
  return null;
}

/**
 * Read one container's own `Wardrobe/instructions.md` (no cascade — the
 * cascade is an outfit-selection runtime concern; the editor shows each tier
 * its own file). Blank or missing both come back as null.
 */
export async function readWardrobeInstructionsFile(mountPointId: string): Promise<string | null> {
  const raw = await readVaultTextFile(mountPointId, WARDROBE_INSTRUCTIONS_PATH);
  const content = raw?.trim() ?? '';
  return content.length > 0 ? content : null;
}

/**
 * Write (or, for null/blank content, remove) one container's
 * `Wardrobe/instructions.md`. Deleting a file that isn't there is a no-op, so
 * clearing an already-empty editor never errors.
 */
export async function writeWardrobeInstructionsFile(
  mountPointId: string,
  instructions: string | null,
): Promise<void> {
  const content = instructions?.trim() ?? '';
  if (content.length === 0) {
    await deleteDatabaseDocumentIfExists(mountPointId, WARDROBE_INSTRUCTIONS_PATH);
    logger.debug('[WardrobeInstructions] Dressing instructions cleared', { mountPointId });
    return;
  }
  await ensureFolderPath(mountPointId, CHARACTER_WARDROBE_FOLDER);
  await writeDatabaseDocument(mountPointId, WARDROBE_INSTRUCTIONS_PATH, content);
  logger.debug('[WardrobeInstructions] Dressing instructions written', {
    mountPointId,
    contentLength: content.length,
  });
}
