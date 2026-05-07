/**
 * Terminal Sessions Repository
 *
 * Backend-agnostic repository for TerminalSession entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Manages in-chat terminal session metadata, including shell type,
 * working directory, timestamps, and transcript paths.
 */

import { TerminalSession, TerminalSessionSchema } from '@/lib/schemas/terminal.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter } from '../interfaces';

/**
 * Terminal Sessions Repository
 * Implements CRUD operations for terminal sessions with chat-level queries.
 */
export class TerminalSessionsRepository extends AbstractBaseRepository<TerminalSession> {
  constructor() {
    super('terminal_sessions', TerminalSessionSchema);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async findById(id: string): Promise<TerminalSession | null> {
    return this._findById(id);
  }

  async findAll(): Promise<TerminalSession[]> {
    return this._findAll();
  }

  async create(
    data: Omit<TerminalSession, 'id'>,
    options?: CreateOptions
  ): Promise<TerminalSession> {
    return this.safeQuery(
      async () => {
        const session = await this._create(data, options);

        return session;
      },
      'Error creating terminal session',
      { chatId: data.chatId, shell: data.shell }
    );
  }

  async update(
    id: string,
    data: Partial<TerminalSession>
  ): Promise<TerminalSession | null> {
    return this.safeQuery(
      async () => {
        // Remove id to prevent accidental overwrites
        const updateData = { ...data };
        delete updateData.id;

        const session = await this._update(id, updateData);

        if (session) {
        }

        return session;
      },
      'Error updating terminal session',
      { sessionId: id }
    );
  }

  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const deleted = await this._delete(id);

        if (deleted) {
        }

        return deleted;
      },
      'Error deleting terminal session',
      { sessionId: id },
      false
    );
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find all sessions for a chat, ordered by startedAt descending
   */
  async findByChatId(chatId: string): Promise<TerminalSession[]> {
    return this.safeQuery(
      async () => {
        const sessions = await this.findByFilter({
          chatId,
        } as TypedQueryFilter<TerminalSession>);

        // Sort by startedAt descending
        return sessions.sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        );
      },
      'Error finding sessions by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Find all active (non-exited) sessions for a chat
   */
  async findActiveByChatId(chatId: string): Promise<TerminalSession[]> {
    return this.safeQuery(
      async () => {
        const sessions = await this.findByChatId(chatId);
        return sessions.filter((session) => session.exitedAt == null);
      },
      'Error finding active sessions by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Delete all sessions for a chat (cascade cleanup)
   */
  async deleteByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const sessions = await this.findByChatId(chatId);
        let count = 0;

        for (const session of sessions) {
          const deleted = await this.delete(session.id);
          if (deleted) count++;
        }

        if (count > 0) {
        }

        return count;
      },
      'Error deleting sessions by chat ID',
      { chatId },
      0
    );
  }
}
