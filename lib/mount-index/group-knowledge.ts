/**
 * Group Knowledge — the per-group `Knowledge/` folder inside each group's
 * official document store. (The group's `Scenarios/` folder is addressed
 * through the scenario location, `lib/scenarios/location.ts`.)
 *
 * @module mount-index/group-knowledge
 */

import { ensureFolderPath } from '@/lib/mount-index/folder-paths';

export const GROUP_KNOWLEDGE_FOLDER = 'Knowledge';

/**
 * Idempotent: ensure the `Knowledge/` folder exists in the given mount point.
 * Returns the folder ID.
 */
export async function ensureGroupKnowledgeFolder(
  mountPointId: string,
): Promise<{ folderId: string | null }> {
  const folderId = await ensureFolderPath(mountPointId, GROUP_KNOWLEDGE_FOLDER);
  return { folderId };
}
