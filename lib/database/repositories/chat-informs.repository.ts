/**
 * Database Abstraction Layer - Chat Informs Repository
 *
 * Backend-agnostic repository for the Salon's **Inform** rows: an
 * out-of-character passage the operator hands to one or more LLM-controlled
 * seats, delivered verbatim as its own system block on each target's next
 * generation.
 *
 * One row per (batch × target). Because the body is duplicated per target,
 * consumption is a single-row write — there is no shared array for a buffered
 * job-child write to clobber when two seats consume in the same batch.
 *
 * Method names are chosen so the background-job child proxy classifies them
 * correctly without an override: reads start with `find`, writes with
 * `create` / `mark` / `delete`
 * (see `lib/background-jobs/child/child-repositories-proxy.ts`).
 */

import { randomUUID } from 'node:crypto';
import {
  ChatInform,
  ChatInformSchema,
  type PendingInformBatch,
} from '@/lib/schemas/chat-inform.types';
import { AbstractBaseRepository } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter } from '../interfaces';

export class ChatInformsRepository extends AbstractBaseRepository<ChatInform> {
  constructor() {
    super('chat_informs', ChatInformSchema);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<ChatInform, 'id' | 'createdAt' | 'updatedAt'>,
    options?: import('./base.repository').CreateOptions
  ): Promise<ChatInform> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<ChatInform>): Promise<ChatInform | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Reads
  // ============================================================================

  /**
   * Every pending row owed to one seat, oldest first. This is what the prompt
   * path delivers; `id` breaks a createdAt tie so stacking order is stable
   * across the two rows a single post can mint in the same millisecond.
   */
  async findPendingForParticipant(chatId: string, participantId: string): Promise<ChatInform[]> {
    return this.safeQuery(
      async () => {
        const rows = await this.findByFilter({
          chatId,
          participantId,
        } as TypedQueryFilter<ChatInform>);
        return rows
          .filter(r => !r.consumedAt)
          .sort((a, b) => {
            const delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            return delta !== 0 ? delta : a.id.localeCompare(b.id);
          });
      },
      'Error finding pending informs for participant',
      { chatId, participantId },
      []
    );
  }

  /**
   * Rows a seat already consumed on any of `messageIds` — the swipe re-apply
   * set. A swipe of a message re-rolls the line that message was, so it must
   * see exactly the informs that generation saw, and no others.
   */
  async findConsumedByMessages(
    chatId: string,
    participantId: string,
    messageIds: string[],
  ): Promise<ChatInform[]> {
    if (messageIds.length === 0) return [];
    return this.safeQuery(
      async () => {
        const wanted = new Set(messageIds);
        const rows = await this.findByFilter({
          chatId,
          participantId,
        } as TypedQueryFilter<ChatInform>);
        return rows
          .filter(r => r.consumedByMessageId && wanted.has(r.consumedByMessageId))
          .sort((a, b) => {
            const delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            return delta !== 0 ? delta : a.id.localeCompare(b.id);
          });
      },
      'Error finding informs consumed by messages',
      { chatId, participantId, messageCount: messageIds.length },
      []
    );
  }

  /**
   * Pending rows for a chat, folded back into the batches they were posted as
   * — one entry per post, carrying the seats still owed it. Drives the
   * composer's pending chip.
   */
  async findPendingBatches(chatId: string): Promise<PendingInformBatch[]> {
    return this.safeQuery(
      async () => {
        const rows = await this.findByFilter({ chatId } as TypedQueryFilter<ChatInform>);
        const pending = rows
          .filter(r => !r.consumedAt)
          .sort((a, b) => {
            const delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            return delta !== 0 ? delta : a.id.localeCompare(b.id);
          });

        const batches = new Map<string, PendingInformBatch>();
        for (const row of pending) {
          const existing = batches.get(row.batchId);
          if (existing) {
            existing.pendingParticipantIds.push(row.participantId);
            continue;
          }
          batches.set(row.batchId, {
            batchId: row.batchId,
            contentMarkdown: row.contentMarkdown,
            createdAt: row.createdAt,
            recordMessageId: row.recordMessageId ?? null,
            pendingParticipantIds: [row.participantId],
          });
        }
        return [...batches.values()];
      },
      'Error finding pending inform batches',
      { chatId },
      []
    );
  }

  /** Every row for a chat, consumed included — export and backup read this. */
  async findByChatId(chatId: string): Promise<ChatInform[]> {
    return this.safeQuery(
      async () => this.findByFilter({ chatId } as TypedQueryFilter<ChatInform>),
      'Error finding informs by chat ID',
      { chatId },
      []
    );
  }

  /** Every row of one batch, consumed included. */
  async findByBatchId(batchId: string): Promise<ChatInform[]> {
    return this.safeQuery(
      async () => this.findByFilter({ batchId } as TypedQueryFilter<ChatInform>),
      'Error finding informs by batch ID',
      { batchId },
      []
    );
  }

  // ============================================================================
  // Writes
  // ============================================================================

  /**
   * Mint one batch: a fresh `batchId` and one row per target, all carrying the
   * same body. Returns the created rows.
   */
  async createBatch(params: {
    chatId: string;
    contentMarkdown: string;
    participantIds: string[];
    recordMessageId?: string | null;
  }): Promise<ChatInform[]> {
    const batchId = randomUUID();
    const created: ChatInform[] = [];
    for (const participantId of params.participantIds) {
      const row = await this.create({
        chatId: params.chatId,
        batchId,
        participantId,
        contentMarkdown: params.contentMarkdown,
        recordMessageId: params.recordMessageId ?? null,
        consumedAt: null,
        consumedByMessageId: null,
      });
      created.push(row);
    }

    logger.debug('Inform batch created', {
      collection: 'chat_informs',
      chatId: params.chatId,
      batchId,
      targetCount: created.length,
      recordMessageId: params.recordMessageId ?? null,
    });

    return created;
  }

  /**
   * Mark exactly these rows consumed by `messageId`. Called once a generation
   * has produced a *persisted* assistant message — never from context building,
   * so a provider failure that saves nothing leaves the rows pending for the
   * seat's next attempt.
   */
  async markConsumed(ids: string[], messageId: string): Promise<number> {
    if (ids.length === 0) return 0;
    return this.safeQuery(
      async () => {
        const now = this.getCurrentTimestamp();
        let count = 0;
        for (const id of ids) {
          const updated = await this.update(id, {
            consumedAt: now,
            consumedByMessageId: messageId,
          });
          if (updated) count++;
        }
        logger.debug('Informs marked consumed', {
          collection: 'chat_informs',
          ids,
          messageId,
          count,
        });
        return count;
      },
      'Error marking informs consumed',
      { ids, messageId },
      0
    );
  }

  /**
   * Cancel: drop only the rows nobody has had yet. A seat that already read
   * the passage keeps its consumed row, so a later swipe of that turn still
   * re-applies it.
   */
  async deletePendingByBatch(batchId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const rows = await this.findByBatchId(batchId);
        let count = 0;
        for (const row of rows) {
          if (row.consumedAt) continue;
          if (await this.delete(row.id)) count++;
        }
        logger.debug('Pending informs deleted by batch', {
          collection: 'chat_informs',
          batchId,
          count,
        });
        return count;
      },
      'Error deleting pending informs by batch',
      { batchId },
      0
    );
  }

  /** A seat has left the chat: it can never collect what it was owed. */
  async deletePendingForParticipant(chatId: string, participantId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const pending = await this.findPendingForParticipant(chatId, participantId);
        let count = 0;
        for (const row of pending) {
          if (await this.delete(row.id)) count++;
        }
        logger.debug('Pending informs deleted for participant', {
          collection: 'chat_informs',
          chatId,
          participantId,
          count,
        });
        return count;
      },
      'Error deleting pending informs for participant',
      { chatId, participantId },
      0
    );
  }

  /** Cascade cleanup mirror (the FK already cascades; this is for callers that ask). */
  async deleteByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const rows = await this.findByChatId(chatId);
        let count = 0;
        for (const row of rows) {
          if (await this.delete(row.id)) count++;
        }
        return count;
      },
      'Error deleting informs by chat ID',
      { chatId },
      0
    );
  }
}
