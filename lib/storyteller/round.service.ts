/**
 * Storyteller rounds — the lifecycle.
 *
 * 1. **Open** (`openStorytellerRound`): an operator post in a storyteller
 *    chat opens a round. Every invited seat is asked for a bid in parallel;
 *    each card streams to the send's SSE stream as it lands, and the stream
 *    closes once every bid is in or the board timeout passes. Late bids still
 *    land on the round row and reach the board through realtime.
 * 2. **Choose**: the operator runs a selection in order, all at once, or lets
 *    the round lie. "Ask anyway" adds one late bid for a seat kept quiet.
 * 3. **Speak** (`runStorytellerRound`): the chosen seats take real turns,
 *    each limited to its bid's tier, then the floor returns to the operator.
 *    Storyteller mode never chains past the round.
 *
 * Bids are not part of the record: the round row holds them only while the
 * round is open (the LLM log keeps every call), and closing clears them.
 * Design of record: docs/developer/features/complete/storyteller-mode.md.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { publishRealtime } from '@/lib/realtime/bus';
import { processSingleton } from '@/lib/utils/process-singleton';
import { loadRoomCharacters } from '@/lib/chat/turn-manager/room-characters';
import { calculateTurnStateFromHistory } from '@/lib/chat/turn-manager/state';
import { resolveCycleOrder } from '@/lib/chat/turn-manager/cycle-order';
import { findUserParticipant } from '@/lib/chat/turn-manager/utils';
import { isCurrentTurnStopped } from '@/lib/chat/turn-control';
import {
  TIER_EFFECT_CEILING,
  type StorytellerBid,
  type StorytellerOrder,
  type StorytellerRound,
  type StorytellerSelection,
} from '@/lib/schemas/storyteller.types';
import type { MessageEvent } from '@/lib/schemas/chat.types';
import { cardFromOutcome } from './cards';
import { biddableSeats, chooseInvitees, type StorytellerSeat } from './invite';
import { runWithStorytellerRoundId } from './round-context';
import type { StorytellerBidCallOutcome, StorytellerTurnContext } from './types';

const CONTEXT = 'storyteller.round';

/** How long the send's stream waits for bids before handing the board over (D-open 1). */
export const STORYTELLER_BOARD_TIMEOUT_MS = 45_000;

/** At most this many concurrent speaking turns per connection profile (D-open 2). */
export const STORYTELLER_CONCURRENCY_PER_PROFILE = 4;

type Repos = ReturnType<typeof getRepositories>;

/** Serialises writes to one round's row (bids land concurrently). */
const roundLocks = processSingleton('storyteller.roundLocks', () => new Map<string, Promise<unknown>>());

function withRoundLock<T>(roundId: string, fn: () => Promise<T>): Promise<T> {
  const previous = roundLocks.get(roundId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  roundLocks.set(roundId, next);
  void next.finally(() => {
    if (roundLocks.get(roundId) === next) roundLocks.delete(roundId);
  });
  return next;
}

function nowIso(): string {
  return new Date().toISOString();
}

export { cardFromOutcome };

function pendingCard(seat: StorytellerSeat, status: 'pending' | 'kept-quiet'): StorytellerBid {
  return {
    participantId: seat.participant.id,
    characterId: seat.participant.characterId!,
    characterName: seat.character?.name ?? 'Unknown',
    status,
    statedTier: null,
    tier: null,
    tierRaised: false,
    tools: [],
    plan: null,
    reason: status === 'kept-quiet' ? 'Kept quiet this round (talkativeness)' : null,
    talkativeness: seat.talkativeness,
    silent: seat.silent,
    askedAt: status === 'pending' ? nowIso() : null,
    answeredAt: null,
  };
}

async function recordCard(repos: Repos, round: StorytellerRound, card: StorytellerBid): Promise<StorytellerRound | null> {
  const updated = await withRoundLock(round.id, () => repos.storytellerRounds.recordBid(round.id, card));
  if (updated) publishRealtime('storytellerRounds', round.chatId);
  return updated;
}

/** Ask one seat for a bid and record the card. Never throws. */
async function bidForSeat(params: {
  repos: Repos;
  round: StorytellerRound;
  userId: string;
  card: StorytellerBid;
}): Promise<StorytellerBid> {
  const { repos, round, userId, card } = params;
  let outcome: StorytellerBidCallOutcome;
  try {
    const { runStorytellerBid } = await import('@/lib/services/chat-message/orchestrator.service');
    outcome = await runWithStorytellerRoundId(round.id, () =>
      runStorytellerBid({ chatId: round.chatId, userId, participantId: card.participantId, roundId: round.id })
    );
  } catch (error) {
    outcome = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const answered = cardFromOutcome(card, outcome);
  logger.info('Storyteller bid landed', {
    context: CONTEXT,
    chatId: round.chatId,
    roundId: round.id,
    participantId: card.participantId,
    status: answered.status,
    tier: answered.tier,
  });
  await recordCard(repos, round, answered);
  return answered;
}

/** Close the chat's open or running round, if it has one. */
export async function abandonStorytellerRound(
  chatId: string,
  reason: 'superseded' | 'abandoned' = 'abandoned'
): Promise<void> {
  const repos = getRepositories();
  const active = await repos.storytellerRounds.findActiveForChat(chatId);
  if (!active) return;
  await withRoundLock(active.id, () => repos.storytellerRounds.markClosed(active.id, reason));
  publishRealtime('storytellerRounds', chatId);
  logger.info('Storyteller round closed unrun', { context: CONTEXT, chatId, roundId: active.id, reason });
}

/**
 * Open a round for an operator post and gather the bids. Resolves once every
 * bid is in or the board timeout passes; later bids keep landing on the row.
 */
export async function openStorytellerRound(params: {
  chatId: string;
  userId: string;
  triggerMessageId: string | null;
  onRound?: (round: StorytellerRound) => void;
  onBid?: (bid: StorytellerBid) => void;
  timeoutMs?: number;
}): Promise<StorytellerRound> {
  const { chatId, userId, triggerMessageId } = params;
  const repos = getRepositories();

  // A new post while a round is open closes that round unrun.
  await abandonStorytellerRound(chatId, 'superseded');

  const chat = await repos.chats.findById(chatId);
  if (!chat) throw new Error('Chat not found');
  const characters = await loadRoomCharacters(repos, chat.participants);
  const seats = biddableSeats(chat.participants, characters, chat.impersonatingParticipantIds);
  const { invited, keptQuiet } = chooseInvitees(seats, { filter: chat.storytellerInviteFilter === true });

  const round = await repos.storytellerRounds.create({
    chatId,
    triggerMessageId,
    status: 'open',
    bids: [...invited.map((seat) => pendingCard(seat, 'pending')), ...keptQuiet.map((seat) => pendingCard(seat, 'kept-quiet'))],
    selection: null,
    closedReason: null,
    closedAt: null,
  });
  publishRealtime('storytellerRounds', chatId);
  params.onRound?.(round);
  logger.info('Storyteller round opened', {
    context: CONTEXT,
    chatId,
    roundId: round.id,
    invited: invited.length,
    keptQuiet: keptQuiet.length,
  });

  const pending = round.bids
    .filter((card) => card.status === 'pending')
    .map((card) =>
      bidForSeat({ repos, round, userId, card }).then((answered) => {
        params.onBid?.(answered);
        return answered;
      })
    );

  const timeoutMs = params.timeoutMs ?? STORYTELLER_BOARD_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    Promise.allSettled(pending).then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (timedOut) {
    logger.info('Storyteller board timeout — the board opens with bids still out', {
      context: CONTEXT,
      chatId,
      roundId: round.id,
      timeoutMs,
    });
  }
  return (await repos.storytellerRounds.findById(round.id)) ?? round;
}

/** "Ask anyway": one late bid for a seat that was kept quiet (or failed). */
export async function askStorytellerAnyway(params: {
  chatId: string;
  userId: string;
  roundId: string;
  participantId: string;
}): Promise<StorytellerBid> {
  const repos = getRepositories();
  const round = await repos.storytellerRounds.findById(params.roundId);
  if (!round || round.chatId !== params.chatId || round.status !== 'open') {
    throw new StorytellerRoundError('That round is no longer open', 409);
  }
  const card = round.bids.find((bid) => bid.participantId === params.participantId);
  if (!card) throw new StorytellerRoundError('That seat is not on this round', 404);
  const asking: StorytellerBid = { ...card, status: 'pending', reason: null, askedAt: nowIso(), answeredAt: null };
  await recordCard(repos, round, asking);
  return bidForSeat({ repos, round, userId: params.userId, card: asking });
}

/** "Let it lie": select nobody; the floor stays with the operator. */
export async function letStorytellerRoundLie(params: { chatId: string; roundId: string }): Promise<void> {
  const repos = getRepositories();
  const round = await repos.storytellerRounds.findById(params.roundId);
  if (!round || round.chatId !== params.chatId || round.status !== 'open') {
    throw new StorytellerRoundError('That round is no longer open', 409);
  }
  const selection: StorytellerSelection = { participantIds: [], order: null, chosenAt: nowIso(), names: [] };
  await withRoundLock(round.id, () => repos.storytellerRounds.markClosed(round.id, 'let-lie', selection));
  publishRealtime('storytellerRounds', params.chatId);
  logger.info('Storyteller round let lie', { context: CONTEXT, chatId: params.chatId, roundId: round.id });
}

export class StorytellerRoundError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'StorytellerRoundError';
  }
}

/** One planned speaking turn. */
export interface StorytellerPlannedTurn {
  bid: StorytellerBid;
  participantId: string;
  characterName: string;
  /** Speaks in the concurrent group (all-at-once Simple / Lookup). */
  concurrent: boolean;
  /** The seat's connection profile — the concurrency cap is per profile. */
  profileKey: string;
}

/**
 * Validate a selection against a round and put it in speaking order: the
 * turn manager's drawn rotation (drawn now if no cycle is under way), with
 * all-at-once Simple / Lookup seats first as one concurrent group (D10).
 */
export async function planStorytellerRun(params: {
  chatId: string;
  roundId: string;
  participantIds: string[];
  order: StorytellerOrder;
}): Promise<{ round: StorytellerRound; turns: StorytellerPlannedTurn[] }> {
  const repos = getRepositories();
  const round = await repos.storytellerRounds.findById(params.roundId);
  if (!round || round.chatId !== params.chatId || round.status !== 'open') {
    throw new StorytellerRoundError('That round is no longer open', 409);
  }
  const chosen = [...new Set(params.participantIds)];
  if (chosen.length === 0) throw new StorytellerRoundError('Choose at least one bid, or let the round lie', 400);
  const bids = chosen.map((id) => {
    const bid = round.bids.find((b) => b.participantId === id);
    if (!bid || bid.status !== 'bid' || !bid.tier) {
      throw new StorytellerRoundError('Only a seat that bid to speak can be chosen', 400);
    }
    return bid;
  });
  if (bids.some((bid) => bid.tier === 'destroy') && bids.length > 1) {
    throw new StorytellerRoundError('A Destroy bid must be chosen on its own', 400);
  }

  const chat = await repos.chats.findById(params.chatId);
  if (!chat) throw new StorytellerRoundError('Chat not found', 404);
  const characters = await loadRoomCharacters(repos, chat.participants);
  const messages = (await repos.chats.getMessages(params.chatId)).filter(
    (m): m is MessageEvent => m.type === 'message'
  );
  const turnState = calculateTurnStateFromHistory({
    messages,
    participants: chat.participants,
    userParticipantId: findUserParticipant(chat.participants)?.id ?? null,
    spokenThisCycleParticipantIds: chat.spokenThisCycleParticipantIds,
    cycleOrderParticipantIds: chat.cycleOrderParticipantIds,
  });
  const cycle = await resolveCycleOrder(repos, chat, characters, turnState);
  const rank = (id: string) => {
    const index = cycle.indexOf(id);
    return index === -1 ? cycle.length + chosen.indexOf(id) : index;
  };
  const ordered = [...bids].sort((a, b) => rank(a.participantId) - rank(b.participantId));

  const turns: StorytellerPlannedTurn[] = ordered.map((bid) => ({
    bid,
    participantId: bid.participantId,
    characterName: bid.characterName,
    concurrent: params.order === 'simultaneous' && (bid.tier === 'simple' || bid.tier === 'lookup'),
    profileKey: chat.participants.find((p) => p.id === bid.participantId)?.connectionProfileId ?? 'default',
  }));
  // All at once: the concurrent group first, then the Act / Destroy tail in rotation order.
  turns.sort((a, b) => Number(b.concurrent) - Number(a.concurrent));
  return { round, turns };
}

/** The result of one speaking turn, as the round runner needs it. */
export interface StorytellerTurnOutcome {
  spoke: boolean;
  yielded: boolean;
  messageId?: string | null;
  sceneTrackingContext?: import('@/lib/services/chat-message/types').ProcessMessageResult['sceneTrackingContext'];
}

/**
 * Run a planned round. `runTurn` runs one speaking turn (the orchestrator's
 * continue-mode turn); `onTurnStart` / `onTurnEnd` let the caller stream.
 * Returns how the round ended. The concurrent group runs at most
 * {@link STORYTELLER_CONCURRENCY_PER_PROFILE} at a time.
 */
export async function runStorytellerRound(params: {
  chatId: string;
  round: StorytellerRound;
  turns: StorytellerPlannedTurn[];
  order: StorytellerOrder;
  runTurn: (turn: StorytellerPlannedTurn, context: StorytellerTurnContext) => Promise<StorytellerTurnOutcome>;
  onTurnStart?: (turn: StorytellerPlannedTurn, depth: number) => void;
  onTurnEnd?: (turn: StorytellerPlannedTurn, depth: number, outcome: StorytellerTurnOutcome) => void;
}): Promise<{ ended: 'ran' | 'stopped' | 'yielded'; lastOutcome: StorytellerTurnOutcome | null }> {
  const { chatId, round, turns, order } = params;
  const repos = getRepositories();
  const selection: StorytellerSelection = {
    participantIds: turns.map((t) => t.participantId),
    order,
    chosenAt: nowIso(),
    names: turns.map((t) => t.characterName),
  };
  await withRoundLock(round.id, () => repos.storytellerRounds.markRunning(round.id, selection));
  publishRealtime('storytellerRounds', chatId);
  logger.info('Storyteller round running', { context: CONTEXT, chatId, roundId: round.id, order, speakers: selection.names });

  const spoken: string[] = [];
  let lastOutcome: StorytellerTurnOutcome | null = null;
  let ended: 'ran' | 'stopped' | 'yielded' = 'ran';
  let depth = 0;

  const contextFor = (turn: StorytellerPlannedTurn, spokenSince: string[]): StorytellerTurnContext => ({
    concurrentFollower: turn.concurrent && turns.find((t) => t.concurrent) !== turn,
    bidRecord: {
      roundId: round.id,
      tier: turn.bid.tier!,
      plan: turn.bid.plan ?? '',
      toolsNamed: turn.bid.tools,
    },
    effectCeiling: TIER_EFFECT_CEILING[turn.bid.tier!],
    spokenSince,
  });

  const runOne = async (turn: StorytellerPlannedTurn, spokenSince: string[]): Promise<StorytellerTurnOutcome> => {
    const myDepth = ++depth;
    params.onTurnStart?.(turn, myDepth);
    const outcome = await runWithStorytellerRoundId(round.id, () => params.runTurn(turn, contextFor(turn, spokenSince)));
    params.onTurnEnd?.(turn, myDepth, outcome);
    if (outcome.spoke) spoken.push(turn.characterName);
    lastOutcome = outcome;
    return outcome;
  };

  // The concurrent group (all at once): everyone sees the transcript as it
  // stood at the operator's post; no one in the group answers another.
  const concurrent = turns.filter((t) => t.concurrent);
  if (concurrent.length > 0) {
    const byProfile = new Map<string, StorytellerPlannedTurn[]>();
    for (const turn of concurrent) byProfile.set(turn.profileKey, [...(byProfile.get(turn.profileKey) ?? []), turn]);
    await Promise.all(
      [...byProfile.values()].map((group) => runWithCap(group, STORYTELLER_CONCURRENCY_PER_PROFILE, (turn) => runOne(turn, [])))
    );
    if (isCurrentTurnStopped()) ended = 'stopped';
  }

  // The sequential part (in order, or the all-at-once Act / Destroy tail).
  if (ended === 'ran') {
    for (const turn of turns.filter((t) => !t.concurrent)) {
      if (isCurrentTurnStopped()) {
        ended = 'stopped';
        break;
      }
      const outcome = await runOne(turn, [...spoken]);
      if (outcome.yielded) {
        ended = 'yielded';
        break;
      }
    }
  }

  await withRoundLock(round.id, () => repos.storytellerRounds.markClosed(round.id, 'ran', selection));
  publishRealtime('storytellerRounds', chatId);
  logger.info('Storyteller round closed', { context: CONTEXT, chatId, roundId: round.id, ended, spoke: spoken });
  return { ended, lastOutcome };
}

/** Run `items` through `fn` with at most `cap` in flight at once. */
async function runWithCap<T>(items: T[], cap: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(cap, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
