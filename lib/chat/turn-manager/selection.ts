/**
 * Turn Selection Algorithm
 *
 * Implements the weighted random selection algorithm for choosing
 * the next speaker in multi-character chats.
 */

import { turnManagerLogger as logger } from './logger';
import type { TurnState, TurnSelectionResult } from './types';
import type { ChatParticipantBase, Character } from '@/lib/schemas/types';

/**
 * Selects the next speaker based on turn state and talkativeness weights.
 *
 * Algorithm:
 * 1. If queue is not empty, pop and return first queued participant
 * 2. If user hasn't spoken since all characters got a turn, return null (user's turn)
 * 3. Filter out:
 *    - The last speaker (unless they're the only character)
 *    - Participants who have spoken since user's last turn
 *    - Inactive participants
 * 4. If no eligible speakers remain, return null (user's turn, cycle complete)
 * 5. For eligible speakers, calculate weighted random selection based on talkativeness
 */
export function selectNextSpeaker(
  participants: ChatParticipantBase[],
  characters: Map<string, Character>,
  turnState: TurnState,
  userParticipantId: string | null
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

  // Get active LLM-controlled participants only (user-controlled don't take autonomous turns)
  const activeCharacterParticipants = participants.filter(
    p => p.isActive && p.characterId &&
    (p.controlledBy === 'llm' || (p.controlledBy === undefined && p.type === 'CHARACTER'))
  );
  // If no active characters, it's always user's turn
  if (activeCharacterParticipants.length === 0) {
    return {
      nextSpeakerId: null,
      reason: 'user_turn',
      cycleComplete: true,
    };
  }

  // Special case: only one character
  if (activeCharacterParticipants.length === 1) {
    const onlyCharacter = activeCharacterParticipants[0];

    // If they just spoke...
    if (turnState.lastSpeakerId === onlyCharacter.id) {
      // In all-LLM chats, let them continue speaking (monologue mode)
      if (userParticipantId === null) {
        return {
          nextSpeakerId: onlyCharacter.id,
          reason: 'only_character',
          cycleComplete: true, // Signal cycle complete for pause logic
        };
      }
      // Otherwise, it's user's turn
      return {
        nextSpeakerId: null,
        reason: 'user_turn',
        cycleComplete: true,
      };
    }

    // Otherwise, they speak
    return {
      nextSpeakerId: onlyCharacter.id,
      reason: 'only_character',
      cycleComplete: false,
    };
  }

  // Step 3: Filter eligible speakers
  const eligibleParticipants = activeCharacterParticipants.filter(p => {
    // Filter out last speaker (unless queued - but we already checked queue)
    if (p.id === turnState.lastSpeakerId) {
      return false;
    }

    // Filter out those who have spoken since user's last turn
    if (turnState.spokenSinceUserTurn.includes(p.id)) {
      return false;
    }

    return true;
  });
  // Step 4: If no eligible speakers, cycle is complete
  if (eligibleParticipants.length === 0) {
    // If there's no user-controlled participant (all-LLM chat), start a new cycle
    // instead of returning user's turn
    if (userParticipantId === null) {
      // Select from all active characters except the last speaker
      const newCycleParticipants = activeCharacterParticipants.filter(
        p => p.id !== turnState.lastSpeakerId
      );

      if (newCycleParticipants.length > 0) {
        // Use weighted selection for new cycle
        const weights: Record<string, number> = {};
        let totalWeight = 0;

        for (const participant of newCycleParticipants) {
          const character = characters.get(participant.characterId!);
          const talkativeness = character?.talkativeness ?? 0.5;
          weights[participant.id] = talkativeness;
          totalWeight += talkativeness;
        }

        if (totalWeight === 0) {
          for (const participant of newCycleParticipants) {
            weights[participant.id] = 1;
            totalWeight += 1;
          }
        }

        const randomValue = Math.random() * totalWeight;
        let cumulative = 0;
        let selectedId: string | null = null;

        for (const participant of newCycleParticipants) {
          cumulative += weights[participant.id];
          if (randomValue < cumulative) {
            selectedId = participant.id;
            break;
          }
        }

        if (!selectedId) {
          selectedId = newCycleParticipants[0].id;
        }

        return {
          nextSpeakerId: selectedId,
          reason: 'weighted_selection',
          cycleComplete: true, // Signal that we completed a cycle (for pause logic)
          debug: {
            eligibleSpeakers: newCycleParticipants.map(p => p.id),
            weights,
            randomValue,
            allLLMNewCycle: true,
          },
        };
      }
    }
    return {
      nextSpeakerId: null,
      reason: 'cycle_complete',
      cycleComplete: true,
    };
  }

  // Step 5: Weighted random selection based on talkativeness
  const weights: Record<string, number> = {};
  let totalWeight = 0;

  for (const participant of eligibleParticipants) {
    const character = characters.get(participant.characterId!);
    // Default talkativeness is 0.5 if character not found or no talkativeness set
    const talkativeness = character?.talkativeness ?? 0.5;
    weights[participant.id] = talkativeness;
    totalWeight += talkativeness;
  }

  // If total weight is 0 (shouldn't happen with valid talkativeness), use equal weights
  if (totalWeight === 0) {
    logger.warn('[Turn Manager] Total weight is 0, using equal weights');
    for (const participant of eligibleParticipants) {
      weights[participant.id] = 1;
      totalWeight += 1;
    }
  }

  // Generate random value and select based on cumulative weights
  const randomValue = Math.random() * totalWeight;
  let cumulative = 0;
  let selectedId: string | null = null;

  for (const participant of eligibleParticipants) {
    cumulative += weights[participant.id];
    if (randomValue < cumulative) {
      selectedId = participant.id;
      break;
    }
  }

  // Fallback to last eligible participant if random selection somehow failed
  if (!selectedId && eligibleParticipants.length > 0) {
    selectedId = eligibleParticipants[eligibleParticipants.length - 1].id;
    logger.warn('[Turn Manager] Random selection fallback', { selectedId });
  }
  return {
    nextSpeakerId: selectedId,
    reason: 'weighted_selection',
    cycleComplete: false,
    debug: {
      eligibleSpeakers: eligibleParticipants.map(p => p.id),
      weights,
      randomValue,
    },
  };
}
