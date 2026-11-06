/**
 * Which model the Green Room consults when a character chooses their own
 * opening outfit (`llm_choose`).
 *
 * By default that is the cheap LLM, like every other background task. The
 * operator may name a profile of its own (`cheapLLMSettings.
 * outfitSelectionProfileId`, Settings → Providers → Cheap LLM Settings): weighing a
 * wardrobe against a scenario, a personality, layering and the last few
 * openings is a judgment a flash model often fumbles. A designated profile
 * that no longer exists falls back to the cheap LLM rather than failing.
 *
 * @module wardrobe/green-room-model
 */

import { logger } from '@/lib/logger';
import type { ConnectionProfile } from '@/lib/schemas/types';
import { selectionFromProfile, type CheapLLMConfig, type CheapLLMSelection } from '@/lib/llm/cheap-llm';
import { selectCheapLLMFromProfiles } from '@/lib/llm/cheap-llm-user-selection';

/** The model the Green Room will call, and where the choice came from. */
export interface GreenRoomLLMSelection {
  selection: CheapLLMSelection;
  /** `designated` = the Green Room's own profile; `cheap` = the cheap-LLM ladder. */
  source: 'designated' | 'cheap';
}

/**
 * Pick the Green Room's model from an already-loaded profile set. Pure apart
 * from logging. Returns null only when there are no profiles at all.
 */
export function selectGreenRoomLLM(
  allProfiles: ConnectionProfile[],
  config: CheapLLMConfig,
): GreenRoomLLMSelection | null {
  const designatedId = config.outfitSelectionProfileId;
  if (designatedId) {
    const designated = allProfiles.find((p) => p.id === designatedId);
    if (designated) {
      logger.debug('[GreenRoomModel] Using the designated Green Room profile', {
        profileId: designated.id,
        provider: designated.provider,
        modelName: designated.modelName,
      });
      return { selection: selectionFromProfile(designated), source: 'designated' };
    }
    logger.warn('[GreenRoomModel] Designated Green Room profile not found; using the cheap LLM', {
      profileId: designatedId,
    });
  }
  const cheap = selectCheapLLMFromProfiles(allProfiles, config);
  return cheap ? { selection: cheap.selection, source: 'cheap' } : null;
}
