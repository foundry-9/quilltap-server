/**
 * Project Roster Access
 *
 * The one question the project roster answers: may this character reach the
 * project's files and shared wardrobe through their own tools?
 *
 * The roster deliberately gates nothing else. A character off the roster still
 * joins project chats, still receives the project's instructions, and still
 * benefits from automatic knowledge retrieval; what they lose is the ability to
 * open, list, search or edit project-store documents with `doc_*` /
 * `search_scriptorium`, and to pick garments from the project's `Wardrobe/`
 * folders with `wardrobe_*`.
 *
 * The policy itself (`allowAnyCharacter` OR on the roster) lives in
 * `ProjectsRepository.canCharacterParticipate`; this module is the call-site
 * chokepoint that handles the "no project" / "no character" cases and logs the
 * outcome.
 *
 * @module projects/roster-access
 */

import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';

/**
 * Whether `characterId` may use their tools on the project's files and shared
 * wardrobe.
 *
 * - No project → `true` (nothing to gate).
 * - No character → `true` (an operator surface, not a character's tool call).
 * - Otherwise the project's roster policy; a missing project or a failed
 *   lookup is a refusal (fail closed).
 */
export async function projectRosterAdmits(
  projectId: string | null | undefined,
  characterId: string | null | undefined,
): Promise<boolean> {
  if (!projectId || !characterId) return true;
  const allowed = await getRepositories().projects.canCharacterParticipate(projectId, characterId);
  logger.debug('[ProjectRoster] Tool access check', { projectId, characterId, allowed });
  return allowed;
}

/**
 * The project id a character's tools may use: `projectId` when the roster
 * admits them, `undefined` otherwise. For call sites that thread a project id
 * into a mount-pool resolution and should simply see no project tier.
 */
export async function rosterGatedProjectId(
  projectId: string | null | undefined,
  characterId: string | null | undefined,
): Promise<string | undefined> {
  if (!projectId) return undefined;
  return (await projectRosterAdmits(projectId, characterId)) ? projectId : undefined;
}

/** The refusal a character sees when they reach for a project file off-roster. */
export const PROJECT_ROSTER_REFUSAL =
  "You are not on this project's character roster, so its files are closed to you. Ask the user to add you to the roster in the project's Characters card.";
