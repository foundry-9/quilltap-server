/**
 * Turn Order Computation
 *
 * Computes the turn order for display in the participant sidebar.
 * This is display-only logic — it does NOT affect the actual turn selection algorithm.
 *
 * The ordering reflects who is currently generating, who is next, who is queued,
 * who is still to come in this cycle's rotation, and who has already spoken.
 * Inactive participants are placed at the end with no position number.
 *
 * Positions below the queue used to be a *guess* — everyone still eligible,
 * sorted by talkativeness, because the next pick had not been made yet and could
 * not be known. Since the whole cycle is now drawn up front
 * (`chat.cycleOrderParticipantIds`, see `cycle-order.ts`), `turnState.cycleOrder`
 * gives the real sequence and the sidebar shows it. The talkativeness sort
 * survives only as the fallback for a chat with no rotation on file yet.
 */

import type { TurnState, TurnSelectionResult } from './types';
import type { ParticipantData } from '@/components/chat/ParticipantCard';
import { isParticipantPresent } from '@/lib/schemas/types';

/**
 * Status values for turn order entries.
 */
export type TurnOrderStatus =
  | 'generating'   // Currently generating a response (#1 during generation)
  | 'next'         // Next speaker from turn selection result
  | 'queued'       // In the manual queue
  | 'eligible'     // Eligible to speak (hasn't spoken this cycle, not last speaker)
  | 'user-turn'    // User's slot in the cycle
  | 'spoken'       // Already spoke this cycle
  | 'silent'       // Participant is silent (present but not speaking)
  | 'absent'       // Participant is absent
  | 'inactive';    // Participant is inactive

/**
 * A single entry in the predicted turn order.
 */
export interface TurnOrderEntry {
  /** The participant ID */
  participantId: string;
  /** Display position (1-based), or null for inactive participants */
  position: number | null;
  /** The status category for styling */
  status: TurnOrderStatus;
}

/**
 * Options for computing the predicted turn order.
 */
interface ComputeTurnOrderOptions {
  /** All participants in the chat (including inactive) */
  participants: ParticipantData[];
  /** Current turn state */
  turnState: TurnState;
  /** Current turn selection result (may be null before first selection) */
  turnSelectionResult: TurnSelectionResult | null;
  /** Whether a response is currently being generated */
  isGenerating: boolean;
  /** The participant currently generating a response */
  respondingParticipantId?: string | null;
  /** The user's participant ID (user-controlled character) */
  userParticipantId: string | null;
}

/**
 * Computes the predicted turn order for display purposes.
 *
 * Ordering priority:
 * 1. Currently generating participant (#1 if generating)
 * 2. Next speaker from turnSelectionResult (#2 if generating, #1 if not)
 * 3. Queue entries (in order)
 * 4. Eligible participants (not spoken this cycle, not last speaker) sorted by talkativeness desc
 * 5. User character (at their cycle position)
 * 6. Already-spoken participants
 * 7. Inactive participants (position = null)
 */
export function computePredictedTurnOrder(options: ComputeTurnOrderOptions): TurnOrderEntry[] {
  const {
    participants,
    turnState,
    turnSelectionResult,
    isGenerating,
    respondingParticipantId,
    userParticipantId,
  } = options;

  const entries: TurnOrderEntry[] = [];
  const placed = new Set<string>();

  // Track which IDs we've already assigned a position to
  const addEntry = (participantId: string, status: TurnOrderStatus) => {
    if (placed.has(participantId)) return;
    // Verify participant exists
    if (!participants.some(p => p.id === participantId)) return;
    placed.add(participantId);
    entries.push({
      participantId,
      position: status === 'inactive' ? null : entries.filter(e => e.status !== 'inactive').length + 1,
      status,
    });
  };

  // 1. Currently generating participant
  if (isGenerating && respondingParticipantId) {
    addEntry(respondingParticipantId, 'generating');
  }

  // 2. Next speaker from turn selection result
  if (turnSelectionResult?.nextSpeakerId) {
    // Only add as 'next' if not already placed as generating
    if (!placed.has(turnSelectionResult.nextSpeakerId)) {
      addEntry(turnSelectionResult.nextSpeakerId, 'next');
    }
  }

  // 3. Queue entries (in order)
  for (const queuedId of turnState.queue) {
    addEntry(queuedId, 'queued');
  }

  // Separate active vs inactive participants
  const activeParticipants = participants.filter(p => isParticipantPresent(p.status || 'active'));
  const inactiveParticipants = participants.filter(p => !isParticipantPresent(p.status || 'active'));

  // 4. Still to come this cycle. With a drawn rotation these are in the order
  // they will actually speak; without one (a chat whose cycle has not started,
  // or a client whose row predates the rotation) they fall back to the old
  // talkativeness-descending guess.
  //
  // The user's own seat holds a place in the rotation, but it is positioned in
  // step 5 rather than here, so it keeps its distinct `user-turn` styling.
  const stillToCome = activeParticipants.filter(p => {
    if (placed.has(p.id)) return false;
    if (p.id === userParticipantId) return false; // User handled separately
    if (turnState.spokenSinceUserTurn.includes(p.id)) return false;
    if (p.id === turnState.lastSpeakerId) return false;
    // Must be LLM-controlled (or undefined type CHARACTER)
    if (p.controlledBy === 'user') return false;
    return true;
  });

  const rotationIndex = new Map<string, number>();
  // Absent on a turn state built before the rotation existed — read as "none".
  (turnState.cycleOrder ?? []).forEach((id, index) => rotationIndex.set(id, index));

  const eligible = [...stillToCome].sort((a, b) => {
    const aRank = rotationIndex.get(a.id);
    const bRank = rotationIndex.get(b.id);
    // Anyone in the rotation comes before anyone who is not (a latecomer whose
    // seat the current cycle never dealt in).
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    const talkA = a.character?.talkativeness ?? 0.5;
    const talkB = b.character?.talkativeness ?? 0.5;
    return talkB - talkA; // Descending
  });

  for (const p of eligible) {
    addEntry(p.id, 'eligible');
  }

  // 5. User character at their cycle position
  if (userParticipantId && !placed.has(userParticipantId)) {
    const userP = participants.find(p => p.id === userParticipantId);
    if (userP && isParticipantPresent(userP.status || 'active')) {
      // If it's the user's turn (nextSpeakerId is null and not generating), place as user-turn
      const isUserTurn = turnSelectionResult?.nextSpeakerId === null && !isGenerating;
      addEntry(userParticipantId, isUserTurn ? 'user-turn' : 'user-turn');
    }
  }

  // 6. Already-spoken participants (active but already spoke this cycle)
  const spoken = activeParticipants
    .filter(p => {
      if (placed.has(p.id)) return false;
      return true;
    })
    .sort((a, b) => {
      const talkA = a.character?.talkativeness ?? 0.5;
      const talkB = b.character?.talkativeness ?? 0.5;
      return talkB - talkA;
    });

  for (const p of spoken) {
    addEntry(p.id, 'spoken');
  }

  // 7. Inactive participants (no position)
  for (const p of inactiveParticipants) {
    if (!placed.has(p.id)) {
      placed.add(p.id);
      // Check if participant has 'absent' or 'removed' status
      const pStatus = (p as any).status;
      let turnOrderStatus: TurnOrderStatus = 'inactive';
      if (pStatus === 'absent') {
        turnOrderStatus = 'absent';
      } else if (pStatus === 'silent') {
        turnOrderStatus = 'silent';
      }
      entries.push({
        participantId: p.id,
        position: null,
        status: turnOrderStatus,
      });
    }
  }

  return entries;
}
