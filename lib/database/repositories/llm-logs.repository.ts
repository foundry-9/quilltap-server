/**
 * LLM Logs Repository
 *
 * Backend-agnostic repository for LLMLog entities.
 * Works with SQLite through the database abstraction layer.
 * Handles CRUD operations and advanced queries for LLM request/response logging.
 */

import { logger } from '@/lib/logger';
import { LLMLog, LLMLogSchema, LLMLogType } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter, QueryOptions } from '../interfaces';

/**
 * LLM Logs Repository
 * Implements CRUD operations and advanced queries for LLM logs.
 * Uses AbstractBaseRepository since LLMLog schema uses Date type for timestamps.
 */
export class LLMLogsRepository extends AbstractBaseRepository<LLMLog> {
  constructor() {
    super('llm_logs', LLMLogSchema);
  }

  /**
   * Find a log by ID
   */
  async findById(id: string): Promise<LLMLog | null> {
    return this._findById(id);
  }

  /**
   * Find all logs (without pagination)
   */
  async findAll(): Promise<LLMLog[]> {
    return this._findAll();
  }

  /**
   * Find logs by user ID with pagination
   * @param userId The user ID
   * @param limit Maximum number of logs to return (default: 50)
   * @param offset Number of logs to skip (default: 0)
   * @returns Promise<LLMLog[]> Array of logs for the user
   */
  async findByUserId(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const options: QueryOptions = {
          sort: { createdAt: -1 },
          skip: offset,
          limit,
        };

        const logs = await this.findByFilter({ userId } as QueryFilter, options);
        return logs;
      },
      'Error finding LLM logs by user ID',
      { userId, limit, offset },
      []
    );
  }

  /**
   * Find logs by message ID (for viewing logs per chat message)
   * @param messageId The message ID
   * @returns Promise<LLMLog[]> Array of logs associated with the message
   */
  async findByMessageId(messageId: string): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const options: QueryOptions = {
          sort: { createdAt: -1 },
        };

        const logs = await this.findByFilter({ messageId } as QueryFilter, options);
        return logs;
      },
      'Error finding LLM logs by message ID',
      { messageId },
      []
    );
  }

  /**
   * Find logs by chat ID (for title generation, context compression)
   * @param chatId The chat ID
   * @returns Promise<LLMLog[]> Array of logs associated with the chat
   */
  async findByChatId(chatId: string): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const options: QueryOptions = {
          sort: { createdAt: -1 },
        };

        const logs = await this.findByFilter({ chatId } as QueryFilter, options);
        return logs;
      },
      'Error finding LLM logs by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Find logs by character ID (for character wizard operations)
   * @param characterId The character ID
   * @returns Promise<LLMLog[]> Array of logs associated with the character
   */
  async findByCharacterId(characterId: string): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const options: QueryOptions = {
          sort: { createdAt: -1 },
        };

        const logs = await this.findByFilter({ characterId } as QueryFilter, options);
        return logs;
      },
      'Error finding LLM logs by character ID',
      { characterId },
      []
    );
  }

  /**
   * Find standalone logs (no messageId, chatId, or characterId - for standalone image gen)
   * @param userId The user ID
   * @param limit Maximum number of logs to return (default: 50)
   * @returns Promise<LLMLog[]> Array of standalone logs
   */
  async findStandalone(userId: string, limit: number = 50): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const filter: QueryFilter = {
          userId,
          messageId: { $eq: null },
          chatId: { $eq: null },
          characterId: { $eq: null },
        };

        const options: QueryOptions = {
          sort: { createdAt: -1 },
          limit,
        };

        const logs = await this.findByFilter(filter, options);
        return logs;
      },
      'Error finding standalone LLM logs',
      { userId, limit },
      []
    );
  }

  /**
   * Find logs by type with user filter
   * @param userId The user ID
   * @param type The log type
   * @param limit Maximum number of logs to return (default: 50)
   * @returns Promise<LLMLog[]> Array of logs of the specified type
   */
  async findByType(userId: string, type: LLMLogType, limit: number = 50): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const filter: QueryFilter = { userId, type };
        const options: QueryOptions = {
          sort: { createdAt: -1 },
          limit,
        };

        const logs = await this.findByFilter(filter, options);
        return logs;
      },
      'Error finding LLM logs by type',
      { userId, type, limit },
      []
    );
  }

  /**
   * Find recent logs for a user
   * @param userId The user ID
   * @param limit Maximum number of logs to return (default: 20)
   * @returns Promise<LLMLog[]> Array of recent logs, sorted by creation date (newest first)
   */
  async findRecent(userId: string, limit: number = 20): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const options: QueryOptions = {
          sort: { createdAt: -1 },
          limit,
        };

        const logs = await this.findByFilter({ userId } as QueryFilter, options);
        return logs;
      },
      'Error finding recent LLM logs',
      { userId, limit },
      []
    );
  }

  /**
   * Create a new log
   * @param data The log data (without id, createdAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<LLMLog> The created log with generated id and timestamp
   */
  async create(
    data: Omit<LLMLog, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<LLMLog> {
    return this.safeQuery(
      async () => {
        const log = await this._create(data, options);
        return log;
      },
      'Error creating LLM log',
      { userId: data.userId, type: data.type }
    );
  }

  /**
   * Update a log
   * Note: LLM logs are typically immutable, but this method is provided for completeness
   * @param id The log ID
   * @param data Partial log data to update
   * @returns Promise<LLMLog | null> The updated log if found, null otherwise
   */
  async update(id: string, data: Partial<LLMLog>): Promise<LLMLog | null> {
    return this.safeQuery(
      async () => {
        const log = await this._update(id, data);

        if (!log) {
          logger.warn('LLM log not found for update', { logId: id });
        }

        return log;
      },
      'Error updating LLM log',
      { logId: id }
    );
  }

  /**
   * Delete a log
   * @param id The log ID
   * @returns Promise<boolean> True if log was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (!result) {
          logger.warn('LLM log not found for deletion', { logId: id });
        }

        return result;
      },
      'Error deleting LLM log',
      { logId: id }
    );
  }

  /**
   * Delete logs by user ID (for account cleanup)
   * @param userId The user ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByUserId(userId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.deleteMany({ userId } as QueryFilter);
        return count;
      },
      'Error deleting LLM logs by user ID',
      { userId }
    );
  }

  /**
   * Cleanup old logs based on retention days
   * @param userId The user ID
   * @param retentionDays Number of days to retain logs (delete older than this)
   * @returns Promise<number> Number of logs deleted
   */
  async cleanupOldLogs(userId: string, retentionDays: number): Promise<number> {
    return this.safeQuery(
      async () => {
        if (retentionDays < 0) {
          logger.warn('Invalid retention days', { retentionDays });
          return 0;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        const filter: QueryFilter = {
          userId,
          createdAt: { $lt: cutoffDate.toISOString() },
        };

        const count = await this.deleteMany(filter);

        logger.info('Cleaned up old LLM logs', {
          userId,
          retentionDays,
          deletedCount: count,
          cutoffDate: cutoffDate.toISOString(),
        });
        return count;
      },
      'Error cleaning up old LLM logs',
      { userId, retentionDays }
    );
  }

  /**
   * Count logs for a user
   * @param userId The user ID
   * @returns Promise<number> Number of logs for the user
   */
  async countByUserId(userId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ userId } as QueryFilter);
        return count;
      },
      'Error counting LLM logs for user',
      { userId },
      0
    );
  }

  /**
   * Count logs by type for a user
   * @param userId The user ID
   * @param type The log type
   * @returns Promise<number> Number of logs of the specified type
   */
  async countByType(userId: string, type: LLMLogType): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ userId, type } as QueryFilter);
        return count;
      },
      'Error counting LLM logs by type',
      { userId, type },
      0
    );
  }

  /**
   * Get total token usage for a user
   * Aggregates usage data across all logs for a user.
   * @param userId The user ID
   * @returns Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> Total token usage
   */
  async getTotalTokenUsage(
    userId: string
  ): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
    return this.safeQuery(
      async () => {
        const filter: QueryFilter = {
          userId,
          usage: { $exists: true, $ne: null },
        };

        const logs = await this.findByFilter(filter);

        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokens = 0;

        for (const log of logs) {
          if (log.usage) {
            totalPromptTokens += log.usage.promptTokens || 0;
            totalCompletionTokens += log.usage.completionTokens || 0;
            totalTokens += log.usage.totalTokens || 0;
          }
        }
        return { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens };
      },
      'Error getting total token usage',
      { userId },
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    );
  }

  /**
   * Count logs associated with a message ID
   * @param messageId The message ID
   * @returns Promise<number> Number of logs for the message
   */
  async countByMessageId(messageId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ messageId } as QueryFilter);
        return count;
      },
      'Error counting LLM logs for message',
      { messageId },
      0
    );
  }

  /**
   * Delete logs by message ID
   * @param messageId The message ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByMessageId(messageId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.deleteMany({ messageId } as QueryFilter);
        return count;
      },
      'Error deleting LLM logs by message ID',
      { messageId }
    );
  }

  /**
   * Delete logs by chat ID
   * @param chatId The chat ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.deleteMany({ chatId } as QueryFilter);
        return count;
      },
      'Error deleting LLM logs by chat ID',
      { chatId }
    );
  }

  /**
   * Delete logs by character ID
   * @param characterId The character ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByCharacterId(characterId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.deleteMany({ characterId } as QueryFilter);
        return count;
      },
      'Error deleting LLM logs by character ID',
      { characterId }
    );
  }
}
