/**
 * Storyteller mode — who is asked for a bid.
 *
 * Every present, non-archived, LLM-driven CHARACTER seat is invited. Silent
 * seats are invited too (their bid prompt says they may only act or emote).
 * User-driven seats and impersonated ones are not — the operator speaks for
 * them. With the chat's talkativeness filter on (off by default), each seat
 * is invited with probability `0.25 + 0.75 × talkativeness`; the rest are
 * "kept quiet" and listed on the board, where the operator can ask anyway.
 *
 * Pure: the caller supplies the random source.
 */

import type { Character } from '@/lib/schemas/character.types';
import type { ChatParticipantBase } from '@/lib/schemas/chat.types';
import { cycleCandidates } from '@/lib/chat/turn-manager/cycle-order';
import { isUserDrivenSeat } from '@/lib/chat/turn-manager/utils';

export interface StorytellerSeat {
  participant: ChatParticipantBase;
  character: Character | undefined;
  talkativeness: number;
  silent: boolean;
}

/** The probability a seat is invited under the talkativeness filter. */
export function inviteProbability(talkativeness: number): number {
  return Math.min(1, Math.max(0, 0.25 + 0.75 * talkativeness));
}

/** Every seat a round may ask for a bid, before the filter. */
export function biddableSeats(
  participants: ChatParticipantBase[],
  characters: Map<string, Character>,
  impersonatingParticipantIds: readonly string[] | null | undefined
): StorytellerSeat[] {
  return cycleCandidates(participants, characters)
    .filter((p) => !isUserDrivenSeat(p, impersonatingParticipantIds ?? []))
    .map((participant) => {
      const character = characters.get(participant.characterId!);
      return {
        participant,
        character,
        talkativeness: participant.talkativeness ?? character?.talkativeness ?? 0.5,
        silent: participant.status === 'silent',
      };
    });
}

export function chooseInvitees(
  seats: StorytellerSeat[],
  options: { filter: boolean; random?: () => number }
): { invited: StorytellerSeat[]; keptQuiet: StorytellerSeat[] } {
  if (!options.filter) return { invited: seats, keptQuiet: [] };
  const random = options.random ?? Math.random;
  const invited: StorytellerSeat[] = [];
  const keptQuiet: StorytellerSeat[] = [];
  for (const seat of seats) {
    (random() < inviteProbability(seat.talkativeness) ? invited : keptQuiet).push(seat);
  }
  return { invited, keptQuiet };
}
