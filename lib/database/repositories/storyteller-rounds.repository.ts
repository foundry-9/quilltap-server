/**
 * Database Abstraction Layer - Storyteller Rounds Repository
 *
 * One row per storyteller round: the operator post that opened it, the bids
 * gathered while it is `open`, and the selection once the operator chooses.
 * When a round closes its `bids` are cleared — the full bids stay in the LLM
 * log — and only ids, timings and the selection are kept. Not exported or
 * backed up: bids are not part of the record.
 *
 * A bid lands with `recordBid`, which re-reads the row and replaces that one
 * seat's card, so concurrent bids for one round cannot overwrite each other
 * (the round service serialises them per round).
 *
 * Method names follow the read/write prefix rules
 * (`lib/repositories/method-classification.ts`).
 */

import {
  StorytellerRoundSchema,
  type StorytellerBid,
  type StorytellerRound,
  type StorytellerSelection,
} from '@/lib/schemas/storyteller.types';
import { AbstractBaseRepository, type CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter } from '../interfaces';

export class StorytellerRoundsRepository extends AbstractBaseRepository<StorytellerRound> {
  constructor() {
    super('storyteller_rounds', StorytellerRoundSchema);
  }

  async create(
    data: Omit<StorytellerRound, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<StorytellerRound> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<StorytellerRound>): Promise<StorytellerRound | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  /** The chat's latest round that is not closed (open or running), if any. */
  async findActiveForChat(chatId: string): Promise<StorytellerRound | null> {
    return this.safeQuery(
      async () => {
        const rows = await this.findByFilter({ chatId } as TypedQueryFilter<StorytellerRound>);
        const active = rows
          .filter((row) => row.status !== 'closed')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return active[0] ?? null;
      },
      'Error finding active storyteller round',
      { chatId },
      null
    );
  }

  /** The chat's most recent round, closed or not — the board's summary line reads it. */
  async findLatestForChat(chatId: string): Promise<StorytellerRound | null> {
    return this.safeQuery(
      async () => {
        const rows = await this.findByFilter({ chatId } as TypedQueryFilter<StorytellerRound>);
        rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return rows[0] ?? null;
      },
      'Error finding latest storyteller round',
      { chatId },
      null
    );
  }

  /**
   * Replace one seat's card on an open round. Returns the updated round, or
   * null when the round is gone or no longer open (a late bid for a closed
   * round is dropped).
   */
  async recordBid(roundId: string, bid: StorytellerBid): Promise<StorytellerRound | null> {
    const round = await this.findById(roundId);
    if (!round || round.status !== 'open') {
      logger.debug('Storyteller bid dropped — round not open', {
        context: 'storyteller-rounds.repository',
        roundId,
        participantId: bid.participantId,
        status: round?.status ?? 'missing',
      });
      return null;
    }
    const bids = round.bids.some((existing) => existing.participantId === bid.participantId)
      ? round.bids.map((existing) => (existing.participantId === bid.participantId ? bid : existing))
      : [...round.bids, bid];
    return this._update(roundId, { bids });
  }

  /** Mark a round running with the operator's selection. */
  async markRunning(roundId: string, selection: StorytellerSelection): Promise<StorytellerRound | null> {
    return this._update(roundId, { status: 'running', selection });
  }

  /** Close a round and clear its bids (they stay in the LLM log). */
  async markClosed(
    roundId: string,
    reason: NonNullable<StorytellerRound['closedReason']>,
    selection?: StorytellerSelection | null
  ): Promise<StorytellerRound | null> {
    const now = new Date().toISOString();
    return this._update(roundId, {
      status: 'closed',
      closedReason: reason,
      closedAt: now,
      bids: [],
      ...(selection !== undefined ? { selection } : {}),
    });
  }
}
