/**
 * Room characters — the one place a turn path loads "who is in this room".
 *
 * Every server path that asks "who speaks next" needs a `characterId → Character`
 * map first: {@link ./cycle-order}.`resolveCycleOrder` weights the rotation draw
 * by talkativeness out of it, and {@link ./selection}.`selectNextSpeaker` reads
 * `archivedAt` out of it to drop tombstoned seats. Six call sites used to build
 * that map by hand, and four of them built it from `getActiveCharacterParticipants`
 * — which, despite the name, returns only LLM-controlled seats. A seat the human
 * drives was therefore invisible to both readers: its character's talkativeness
 * never reached the draw (it fell through to the 0.5 default unless the seat
 * carried a per-chat override), and an archived character on it was never
 * excluded. Building the map over {@link getPresentCharacterSeats} instead is
 * what this module is for.
 *
 * It is also the cheaper read, which is why widening the map costs nothing.
 * `repos.characters.findById` overlays one character's vault through
 * `loadVaultFileMaps([oneMount])` — eleven vault queries plus the row — so the
 * old per-seat loops paid that eleven times over in a four-seat room.
 * `findByIds` overlays the whole room in one pass: one `IN(...)` row query and
 * one batch of vault queries, whatever the seat count.
 *
 * **Best-effort, by contract.** `cycleCandidates` documents its input as a
 * best-effort read and deliberately *keeps* a seat whose character is missing
 * from the map, so that a failed lookup costs a name rather than silently
 * shrinking the room. The batched read is what actually honours that: the list
 * overlay logs and DROPS a character whose vault is unavailable, where the
 * single-character overlay behind `findById` throws
 * `CharacterVaultUnavailableError` — which, in the old loops, threw straight out
 * of speaker selection and took the whole turn (and the read-only `?action=turn`
 * projection behind the participant sidebar) with it.
 */

import type { ChatParticipantBase, Character } from '@/lib/schemas/types';
import { getPresentCharacterSeats } from './utils';
import { turnManagerLogger as logger } from './logger';

/** The narrow slice of the repositories bundle {@link loadRoomCharacters} needs. */
export interface RoomCharacterRepos {
  characters: {
    findByIds: (ids: string[]) => Promise<Character[]>;
  };
}

export interface LoadRoomCharactersOptions {
  /**
   * Characters the caller already holds, seeded over the batch read so the
   * caller's copy wins. The message finalizer uses this for the character that
   * just spoke: it has the authoritative post-turn record in hand and must not
   * be handed a staler one.
   */
  preloaded?: ReadonlyArray<Character | null | undefined>;
}

/**
 * Loads `characterId → Character` for every character seat present in the room —
 * LLM-driven and user-driven alike — in a single batched read.
 *
 * Seats whose character cannot be read are simply absent from the map. That is
 * the documented contract of every consumer: an unknown character is treated as
 * present and unarchived at the default weight, never as a reason to drop a seat
 * or fail a turn.
 */
export async function loadRoomCharacters(
  repos: RoomCharacterRepos,
  participants: ReadonlyArray<ChatParticipantBase>,
  options?: LoadRoomCharactersOptions,
): Promise<Map<string, Character>> {
  const seats = getPresentCharacterSeats(participants);
  const ids = Array.from(new Set(seats.map((p) => p.characterId!)));

  const characters = new Map<string, Character>();

  if (ids.length > 0) {
    const rows = await repos.characters.findByIds(ids);
    for (const row of rows) {
      characters.set(row.id, row);
    }
  }

  for (const preloaded of options?.preloaded ?? []) {
    if (preloaded?.id) characters.set(preloaded.id, preloaded);
  }

  logger.debug('[Turn Manager] Room characters loaded', {
    seats: seats.length,
    requested: ids.length,
    resolved: characters.size,
  });

  // A shortfall means a seat's character row is gone or its vault is on the
  // shelf. Worth saying out loud — the room is about to be weighted and ordered
  // without it — but never worth failing a turn over.
  const missing = ids.filter((id) => !characters.has(id));
  if (missing.length > 0) {
    logger.warn('[Turn Manager] Room seats with no readable character', {
      requested: ids.length,
      missing,
    });
  }

  return characters;
}
