/**
 * The Green Room's shared machinery: which model it consults when a character
 * chooses their own opening outfit (`llm_choose`) and, with it, what they
 * carry in (`lib/inventory/green-room.ts`); how long it waits; and which of
 * the seat's subprompts ride in.
 *
 * By default that is the cheap LLM, like every other background task. The
 * operator may name a profile of its own (`cheapLLMSettings.
 * outfitSelectionProfileId`, Settings → Providers → Cheap LLM Settings): weighing a
 * wardrobe against a scenario, a personality, layering and the last few
 * openings is a judgment a flash model often fumbles. A designated profile
 * that no longer exists falls back to the cheap LLM rather than failing.
 * The inventory pass uses the same model.
 *
 * @module chat/opening/green-room/model
 */

import { logger } from '@/lib/logger';
import type { ConnectionProfile } from '@/lib/schemas/types';
import { selectionFromProfile, type CheapLLMConfig, type CheapLLMSelection } from '@/lib/llm/cheap-llm';
import { selectCheapLLMFromProfiles } from '@/lib/llm/cheap-llm-user-selection';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { SubpromptForPrompt } from '@/lib/subprompts/subprompts';

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

/**
 * How long the Green Room waits on its model for one character's decision —
 * an outfit or a pocketful of objects — before giving up and falling back to
 * that character's defaults.
 *
 * A healthy call on a cheap model is a second or two. Observed in the wild: a
 * provider that took 2m32s to emit 19 tokens, which — back when the outfit
 * loop was serial — stalled the entire chat-creation request behind one
 * character. Concurrency stops one straggler from blocking the others; this
 * stops a straggler from blocking the chat.
 *
 * The underlying request is not aborted, only abandoned; it will still be
 * billed and still land in the LLM log.
 */
export const GREEN_ROOM_LLM_TIMEOUT_MS = 60_000;

/** Sentinel distinguishing "gave up waiting" from any legitimate resolution. */
export const GREEN_ROOM_TIMED_OUT: unique symbol = Symbol('green-room-llm-timed-out');

/**
 * Resolve `work`, or {@link GREEN_ROOM_TIMED_OUT} if it takes longer than `ms`.
 *
 * The timer is always cleared so a fast resolution doesn't hold the event loop
 * open, and a late rejection from `work` is absorbed by the race rather than
 * surfacing as an unhandled rejection.
 */
export function withGreenRoomTimeout<T>(
  work: Promise<T>,
  ms: number = GREEN_ROOM_LLM_TIMEOUT_MS,
): Promise<T | typeof GREEN_ROOM_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<typeof GREEN_ROOM_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(GREEN_ROOM_TIMED_OUT), ms);
  });
  return Promise.race([work, guard]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * The subprompts in play for `characterId`'s LLM-controlled seat in `chatId`,
 * resolved from the persisted participant record. `[]` when the chat or seat
 * cannot be found, or on any read error — a Green Room decision never waits
 * on this.
 */
export async function resolveGreenRoomSubprompts(
  repos: Pick<RepositoryContainer, 'chats'>,
  chatId: string,
  characterId: string,
): Promise<SubpromptForPrompt[]> {
  try {
    const chat = await repos.chats.findById(chatId);
    const seat = chat?.participants.find(
      (p) => p.characterId === characterId && p.controlledBy !== 'user' && p.status !== 'removed',
    );
    const selected = seat?.selectedSubpromptIds ?? [];
    if (selected.length === 0) return [];
    // Loaded lazily: the subprompts module reaches into the mount-index
    // document store, which the Green Room otherwise never touches.
    const { resolveSelectedSubprompts } = await import('@/lib/subprompts/subprompts');
    return await resolveSelectedSubprompts(characterId, selected);
  } catch (error) {
    logger.warn('[GreenRoomModel] Could not read subprompts for the green room — continuing without', {
      chatId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
