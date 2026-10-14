/**
 * Cycle Order — the rotation, drawn once and then kept.
 *
 * A cycle is one full pass of the room: every present character seat speaks
 * exactly once, then the cycle wraps and a new order is drawn. The order is a
 * weighted permutation — the same successive-sampling draw the per-turn
 * selection used to make one pick at a time — so the *distribution* of
 * rotations is unchanged. What changes is that the whole permutation is decided
 * up front and persisted, so every reader (the chain loop, the `?action=turn`
 * projection, the participant sidebar) sees the same answer to "who is after
 * whom", and the sidebar can show a real position rather than a guess.
 *
 * The stored value (`chat.cycleOrderParticipantIds`) is the *remaining* speakers
 * of the current cycle, in order:
 *
 *   - **Consumed** by the pure helpers in `state.ts`, at the same write
 *     chokepoints that advance `spokenThisCycleParticipantIds` — a speaker's id
 *     is struck from the list when their message lands (or when their user turn
 *     is skipped). No weights are needed to consume, so those paths stay pure.
 *   - **Drawn** by {@link resolveCycleOrder}, the one writer, when the remaining
 *     list holds nobody who can still speak. Drawing needs talkativeness, which
 *     needs the characters map, which is why it lives here and not in the
 *     repository layer.
 *
 * **The characters map must cover the whole room.** Build it with
 * {@link ./room-characters}.`loadRoomCharacters`, never by hand from
 * `getActiveCharacterParticipants` — that helper returns LLM-controlled seats
 * only, and a seat missing from the map is weighted at the 0.5 default and
 * never checked for `archivedAt`. A map built that way silently ignores the
 * talkativeness of every character the human drives.
 *
 * `selectNextSpeaker` treats the order as an overlay: it takes the first usable
 * id from the order, and falls back to the old one-at-a-time weighted pick when
 * the order is empty or stale. The client never draws or persists — it reads
 * whatever the server stored and falls back to the same guess it always made.
 */

import type { ChatParticipantBase, Character } from '@/lib/schemas/types';
import type { TurnState } from './types';
import { pickWeightedRandom } from './weighted-random';
import { getPresentCharacterSeats } from './utils';
import { turnManagerLogger as logger } from './logger';

/**
 * The chat identity {@link resolveCycleOrder} needs. The *current* rotation
 * comes from `turnState.cycleOrder` (already parsed off the row by
 * `calculateTurnStateFromHistory`), so callers never hand the raw JSON twice.
 */
export interface CycleOrderChat {
  id: string;
  participants: ChatParticipantBase[];
}

/** The narrow slice of the repositories bundle {@link resolveCycleOrder} needs. */
export interface CycleOrderRepos {
  chats: {
    update: (id: string, data: { cycleOrderParticipantIds: string }) => Promise<unknown>;
  };
}

/**
 * Parses a stored cycle order, tolerating null, malformed JSON, and non-string
 * members. A bad value reads as an empty cycle, which redraws on the next
 * selection — the field is never load-bearing enough to fail a turn over.
 */
export function parseCycleOrder(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

/**
 * The seats that take part in a rotation: present CHARACTER participants whose
 * character still exists and is not archived. User-driven seats are included —
 * they hold a place in the order, and the orchestrator pauses the chain when the
 * rotation reaches them.
 */
export function cycleCandidates(
  participants: ChatParticipantBase[],
  characters: Map<string, Character>,
): ChatParticipantBase[] {
  return getPresentCharacterSeats(participants).filter((p) => {
    const character = characters.get(p.characterId!);
    // An unknown character (not in the map) is kept: the map is built from a
    // best-effort read, and dropping a seat over a failed lookup would silently
    // shrink the room. Only a *known* archived character is excluded.
    return !character?.archivedAt;
  });
}

/**
 * Draws a fresh rotation: a weighted permutation of the candidate seats,
 * sampled without replacement, heaviest-talkers-likeliest at every position.
 *
 * `excludeFirst` keeps the seat that just spoke out of position 1, which is the
 * no-back-to-back guard the one-at-a-time algorithm applied at each wrap. They
 * stay in the permutation — just never at its head.
 */
export function drawCycleOrder(options: {
  participants: ChatParticipantBase[];
  characters: Map<string, Character>;
  excludeFirst?: string | null;
}): string[] {
  const { participants, characters, excludeFirst } = options;
  const remaining = cycleCandidates(participants, characters);
  if (remaining.length === 0) return [];

  const weightOf = (p: ChatParticipantBase) =>
    p.talkativeness ?? characters.get(p.characterId!)?.talkativeness ?? 0.5;

  const order: string[] = [];
  const pool = [...remaining];

  while (pool.length > 0) {
    // Position 1 only: hold back the previous speaker when anyone else could
    // take the floor instead.
    const eligible = order.length === 0 && excludeFirst && pool.length > 1
      ? pool.filter((p) => p.id !== excludeFirst)
      : pool;

    const { item } = pickWeightedRandom(eligible, weightOf);
    order.push(item.id);
    pool.splice(pool.indexOf(item), 1);
  }

  return order;
}

/**
 * The first seat in `order` that can still take the floor: present, not already
 * spoken this cycle, and not the seat that just spoke. Returns null when the
 * order holds nobody usable — the signal that the cycle is spent and a fresh
 * one must be drawn.
 *
 * Stale ids (a departed seat, an archived character) are skipped rather than
 * treated as terminal, so a cast change mid-cycle costs that seat its turn and
 * nothing more. A missing `order` reads as "no rotation on file" — the field is
 * newer than some hand-built turn states, and its absence must never throw.
 */
export function pickFromCycleOrder(
  order: readonly string[] | undefined,
  participants: ChatParticipantBase[],
  characters: Map<string, Character>,
  turnState: Pick<TurnState, 'spokenSinceUserTurn' | 'lastSpeakerId'>,
): string | null {
  if (!order || order.length === 0) return null;
  const usable = new Set(cycleCandidates(participants, characters).map((p) => p.id));
  for (const id of order) {
    if (!usable.has(id)) continue;
    if (turnState.spokenSinceUserTurn.includes(id)) continue;
    if (id === turnState.lastSpeakerId) continue;
    return id;
  }
  return null;
}

/**
 * Read-or-draw-and-persist: the single writer of `cycleOrderParticipantIds`.
 *
 * Returns the remaining rotation for this cycle, drawing and storing a fresh one
 * when what is on the row can no longer seat anybody. Every server path that is
 * about to ask "who speaks next" calls this first and threads the result into
 * the turn state, so all of them read one rotation instead of each drawing their
 * own.
 *
 * Late arrivals are appended rather than triggering a redraw: joining mid-cycle
 * puts you at the back of the queue, and the next cycle deals you in properly.
 */
export async function resolveCycleOrder(
  repos: CycleOrderRepos,
  chat: CycleOrderChat,
  characters: Map<string, Character>,
  turnState: Pick<TurnState, 'spokenSinceUserTurn' | 'lastSpeakerId' | 'cycleOrder'>,
): Promise<string[]> {
  const stored = turnState.cycleOrder ?? [];
  const candidates = cycleCandidates(chat.participants, characters);

  if (candidates.length === 0) return [];

  // A single-seat room has no rotation to speak of — the one character simply
  // continues. Storing a one-entry order would churn the row every turn.
  if (candidates.length === 1) return [];

  if (pickFromCycleOrder(stored, chat.participants, characters, turnState) !== null) {
    // Still usable. Seat anyone who joined mid-cycle at the back, so they are
    // not passed over twice.
    const known = new Set(stored);
    const latecomers = candidates
      .map((p) => p.id)
      .filter((id) => !known.has(id) && !turnState.spokenSinceUserTurn.includes(id));

    if (latecomers.length === 0) return stored;

    const extended = [...stored, ...latecomers];
    await persist(repos, chat, extended, 'extended');
    return extended;
  }

  const fresh = drawCycleOrder({
    participants: chat.participants,
    characters,
    excludeFirst: turnState.lastSpeakerId,
  });
  await persist(repos, chat, fresh, 'drawn');
  return fresh;
}

/**
 * Stores the rotation. A failed write is logged and swallowed: the caller still
 * has the order in memory and this turn proceeds on it, and the next selection
 * simply draws again. A bookkeeping column is never worth failing a turn over.
 */
async function persist(
  repos: CycleOrderRepos,
  chat: CycleOrderChat,
  order: string[],
  how: 'drawn' | 'extended',
): Promise<void> {
  const json = JSON.stringify(order);
  try {
    await repos.chats.update(chat.id, { cycleOrderParticipantIds: json });
    logger.debug('[Turn Manager] Cycle order persisted', {
      chatId: chat.id,
      how,
      order,
    });
  } catch (error) {
    logger.warn('[Turn Manager] Failed to persist cycle order', {
      chatId: chat.id,
      how,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
