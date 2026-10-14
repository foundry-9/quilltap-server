/**
 * Turn Selection Algorithm
 *
 * Implements the weighted random selection algorithm for choosing
 * the next speaker in multi-character chats.
 */

import { turnManagerLogger as logger } from './logger';
import type { TurnState, TurnSelectionResult } from './types';
import type { ChatEvent, ChatParticipantBase, Character } from '@/lib/schemas/types';
import { isParticipantPresent } from '@/lib/schemas/types';
import { isUserDrivenSeat } from './utils';
import { computeSpokenThisCycleAfterMessage } from './state';
import { pickWeightedRandom } from './weighted-random';
import { parseCycleOrder, pickFromCycleOrder } from './cycle-order';

/**
 * Selects the next speaker based on turn state and talkativeness weights.
 *
 * Both LLM-controlled and user-controlled CHARACTER participants are in the
 * rotation, each weighted by their character's `talkativeness`. The orchestrator
 * stops the chain when the selection lands on a user-controlled participant
 * (the chat then waits for the human to type or click Skip).
 *
 * Algorithm:
 * 1. If the manual queue is not empty, pop and return its head.
 * 2. Otherwise, follow `turnState.cycleOrder` — the rotation drawn for this
 *    cycle by `resolveCycleOrder` — taking its first member who can still
 *    speak. This is the ordinary path once a cycle is under way.
 * 3. With no usable rotation (a fresh chat, a spent cycle, or a client whose
 *    row has none yet), fall back to the original one-at-a-time weighted pick
 *    from { active CHARACTER participants } minus { last speaker, anyone in
 *    spokenThisCycle }.
 * 4. If no candidates remain (cycle complete), wrap: weighted-random pick from
 *    { active - last speaker }. The orchestrator clears spokenThisCycle on wrap.
 *
 * Steps 3 and 4 are the pre-rotation algorithm, kept as the fallback: the draw
 * in step 2 is the same successive weighted sampling, so following a drawn order
 * and picking one at a time produce the same distribution of rotations.
 */
export function selectNextSpeaker(
  participants: ChatParticipantBase[],
  characters: Map<string, Character>,
  turnState: TurnState,
  _userParticipantId: string | null,
  impersonatingParticipantIds?: readonly string[] | null
): TurnSelectionResult {
  // Step 1: Check queue first
  if (turnState.queue.length > 0) {
    const nextFromQueue = turnState.queue[0];
    return {
      nextSpeakerId: nextFromQueue,
      reason: 'queue',
      cycleComplete: false,
    };
  }

  // All present CHARACTER participants are in the rotation — including
  // user-controlled ones. Their talkativeness biases ordering; when picked, the
  // orchestrator pauses the chain so the human can type or skip.
  const activeCharacterParticipants = participants.filter((p) => {
    if (p.type !== 'CHARACTER' || !isParticipantPresent(p.status) || !p.characterId) return false;
    const character = characters.get(p.characterId);
    return !character?.archivedAt;
  });

  if (activeCharacterParticipants.length === 0) {
    return {
      nextSpeakerId: null,
      reason: 'user_turn',
      cycleComplete: true,
    };
  }

  // Special case: only one CHARACTER participant. If they just spoke, let them
  // continue (monologue / single-speaker chat); the no-back-to-back guard is
  // pointless with nobody else to alternate with.
  if (activeCharacterParticipants.length === 1) {
    const onlyCharacter = activeCharacterParticipants[0];
    return buildResult(onlyCharacter, 'only_character', false, impersonatingParticipantIds);
  }

  // Step 2: The rotation drawn for this cycle, if there is one. `resolveCycleOrder`
  // (`cycle-order.ts`) draws and persists it before any server path asks this
  // question, so every reader gets the same answer and nobody re-rolls a turn
  // that was already decided. `debug.weights` is empty here on purpose: the
  // weighting happened once, at the draw, not at this pick.
  const fromOrder = pickFromCycleOrder(
    turnState.cycleOrder,
    activeCharacterParticipants,
    characters,
    turnState,
  );
  if (fromOrder) {
    const ordered = activeCharacterParticipants.find(p => p.id === fromOrder)!;
    return buildResult(ordered, 'cycle_order', false, impersonatingParticipantIds, {
      eligibleSpeakers: [...turnState.cycleOrder],
      weights: {},
    });
  }

  // Step 3: No stored rotation to follow (a fresh chat, a spent cycle, or a
  // client reading a row that has none yet). Fall back to the original
  // one-at-a-time weighted pick from eligible (not last speaker, not yet
  // spoken this cycle).
  const eligibleParticipants = activeCharacterParticipants.filter(p => {
    if (p.id === turnState.lastSpeakerId) return false;
    if (turnState.spokenSinceUserTurn.includes(p.id)) return false;
    return true;
  });

  if (eligibleParticipants.length > 0) {
    const pick = pickWeighted(eligibleParticipants, characters);
    return buildResult(pick.participant, 'weighted_selection', false, impersonatingParticipantIds, {
      eligibleSpeakers: eligibleParticipants.map(p => p.id),
      weights: pick.weights,
      randomValue: pick.randomValue,
    });
  }

  // Step 4: Cycle wrapped. Weighted-random pick from { all - last speaker }.
  // The orchestrator clears spokenThisCycle when it observes cycleComplete=true.
  const newCycleParticipants = activeCharacterParticipants.filter(
    p => p.id !== turnState.lastSpeakerId,
  );

  if (newCycleParticipants.length === 0) {
    // Only the last speaker is left (shouldn't happen with >=2 participants),
    // but be defensive.
    return {
      nextSpeakerId: null,
      reason: 'cycle_complete',
      cycleComplete: true,
    };
  }

  const wrapPick = pickWeighted(newCycleParticipants, characters);
  return buildResult(wrapPick.participant, 'weighted_selection', true, impersonatingParticipantIds, {
    eligibleSpeakers: newCycleParticipants.map(p => p.id),
    weights: wrapPick.weights,
    randomValue: wrapPick.randomValue,
    allLLMNewCycle: true,
  });
}

/**
 * Who speaks next *after* a user's just-typed message — projected one step past
 * a post that has NOT been persisted yet.
 *
 * The first-responder decision on a fresh user send happens before the message
 * is written to history, so `calculateTurnStateFromHistory` would still resolve
 * to the poster (whose turn it currently is), not the seat that follows them.
 * This helper advances the persisted cycle exactly the way the message write will
 * (via {@link computeSpokenThisCycleAfterMessage}, so the projection and the
 * eventual persisted state agree), sets the poster as `lastSpeakerId`, then runs
 * the normal full-rotation {@link selectNextSpeaker} over ALL participants — with
 * the cycle's stored rotation, so the projection follows the same order the real
 * turn will.
 *
 * The caller uses this to detect when the floor after a human's post belongs to
 * ANOTHER seat the human drives — in which case the chat pauses for that seat
 * instead of forcing an LLM to answer every human turn (the fair-rotation fix for
 * rooms where the human drives two or more seats alongside a single LLM).
 */
export function selectNextSpeakerAfterUserMessage(
  participants: ChatParticipantBase[],
  characters: Map<string, Character>,
  posterParticipantId: string,
  persistedSpokenThisCycleJson: string | null | undefined,
  turnQueueJson: string | null | undefined,
  userParticipantId: string | null,
  impersonatingParticipantIds?: readonly string[] | null,
  cycleOrderJson?: string | null,
): TurnSelectionResult {
  const syntheticPost = {
    type: 'message',
    role: 'USER',
    participantId: posterParticipantId,
  } as unknown as ChatEvent;

  const advancedJson = computeSpokenThisCycleAfterMessage(
    syntheticPost,
    participants,
    persistedSpokenThisCycleJson ?? null,
  );

  const parseIds = (json: string | null | undefined): string[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  };

  // `advancedJson === null` means the write is a no-op (poster already recorded,
  // no wrap) — keep the persisted set as-is.
  const spokenSinceUserTurn = advancedJson !== null
    ? parseIds(advancedJson)
    : parseIds(persistedSpokenThisCycleJson);

  const turnState: TurnState = {
    spokenSinceUserTurn,
    lastSpeakerId: posterParticipantId,
    queue: parseIds(turnQueueJson),
    currentTurnParticipantId: null,
    // The projection reads the stored rotation but never draws one: it is asking
    // a hypothetical ("who would follow this post?"), and a draw made here would
    // be persisted by nobody and contradicted by the real selection.
    cycleOrder: parseCycleOrder(cycleOrderJson),
  };

  return selectNextSpeaker(
    participants,
    characters,
    turnState,
    userParticipantId,
    impersonatingParticipantIds,
  );
}

function buildResult(
  participant: ChatParticipantBase,
  reason: TurnSelectionResult['reason'],
  cycleComplete: boolean,
  impersonatingParticipantIds?: readonly string[] | null,
  debug?: TurnSelectionResult['debug'],
): TurnSelectionResult {
  // A seat the human owns OR is impersonating this session takes a *user* turn —
  // the orchestrator pauses the chain so the human types or skips. Impersonation
  // is an overlay (Bug 44): `controlledBy` stays `'llm'`, so consult the overlay
  // rather than the bare column, otherwise a weighted pick would try to generate
  // an LLM response as the character the human is speaking for.
  const isUserDriven = isUserDrivenSeat(participant, impersonatingParticipantIds);
  return {
    nextSpeakerId: participant.id,
    reason: isUserDriven ? 'user_turn' : reason,
    cycleComplete,
    debug,
  };
}

/**
 * Weighted-random pick — re-exported from {@link ./weighted-random} so the
 * long-standing `@/lib/chat/turn-manager/selection` import path keeps working.
 * Shared by the per-turn speaker selection, the whole-cycle rotation draw, and
 * the opening-character pick at chat creation, so the three can never drift.
 */
export { pickWeightedRandom } from './weighted-random';

function pickWeighted(
  candidates: ChatParticipantBase[],
  characters: Map<string, Character>,
): { participant: ChatParticipantBase; weights: Record<string, number>; randomValue: number } {
  const picked = pickWeightedRandom(candidates, (p) => {
    // Per-chat override (participant.talkativeness) wins; fall back to the
    // character's value; final default is 0.5.
    return p.talkativeness ?? characters.get(p.characterId!)?.talkativeness ?? 0.5;
  });
  if (picked.equalWeights) {
    logger.warn('[Turn Manager] Total talkativeness is 0, using equal weights');
  }
  const weights: Record<string, number> = {};
  candidates.forEach((p, i) => {
    weights[p.id] = picked.weights[i];
  });
  return { participant: picked.item, weights, randomValue: picked.randomValue };
}
