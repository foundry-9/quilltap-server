/**
 * MongoDB LLM Logs Repository
 *
 * Handles CRUD operations and advanced queries for LLMLog entities.
 * Each LLM log is stored as a document in the 'llm_logs' MongoDB collection.
 */

import { LLMLog, LLMLogSchema, LLMLogType } from '@/lib/schemas/types';
import { MongoBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';

export class LLMLogsRepository extends MongoBaseRepository<LLMLog> {
  constructor() {
    super('llm_logs', LLMLogSchema);
    logger.debug('LLMLogsRepository initialized');
  }

  /**
   * Find all logs (without pagination)
   * @returns Promise<LLMLog[]> Array of all logs
   */
  async findAll(): Promise<LLMLog[]> {
    logger.debug('Finding all LLM logs');
    try {
      const collection = await this.getCollection();
      const results = await collection.find({}).toArray();

      const logs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((log): log is LLMLog => log !== null);

      logger.debug('Retrieved all LLM logs', { count: logs.length });
      return logs;
    } catch (error) {
      logger.error('Error finding all LLM logs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find a log by ID
   * @param id The log ID
   * @returns Promise<LLMLog | null> The log if found, null otherwise
   */
  async findById(id: string): Promise<LLMLog | null> {
    logger.debug('Finding LLM log by ID', { logId: id });
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id });

      if (!result) {
        logger.debug('LLM log not found', { logId: id });
        return null;
      }

      const validated = this.validate(result);
      logger.debug('LLM log found and validated', { logId: id });
      return validated;
    } catch (error) {
      logger.error('Error finding LLM log by ID', {
        logId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find logs by user ID with pagination
   * @param userId The user ID
   * @param limit Maximum number of logs to return (default: 50)
   * @param offset Number of logs to skip (default: 0)
   * @returns Promise<LLMLog[]> Array of logs for the user
   */
  async findByUserId(userId: string, limit: number = 50, offset: number = 0): Promise<LLMLog[]> {
    logger.debug('Finding LLM logs by user ID', { userId, limit, offset });
    try {
      const collection = await this.getCollection();
      const results = await collection
        .find({ userId })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();

      const logs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((log): log is LLMLog => log !== null);

      logger.debug('Found LLM logs for user', { userId, count: logs.length });
      return logs;
    } catch (error) {
      logger.error('Error finding LLM logs by user ID', {
        userId,
        limit,
        offset,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find logs by message ID (for viewing logs per chat message)
   * @param messageId The message ID
   * @returns Promise<LLMLog[]> Array of logs associated with the message
   */
  async findByMessageId(messageId: string): Promise<LLMLog[]> {
    logger.debug('Finding LLM logs by message ID', { messageId });
    try {
      const collection = await this.getCollection();
      const results = await collection
        .find({ messageId })
        .sort({ createdAt: -1 })
        .toArray();

      const logs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((log): log is LLMLog => log !== null);

      logger.debug('Found LLM logs for message', { messageId, count: logs.length });
      return logs;
    } catch (error) {
      logger.error('Error finding LLM logs by message ID', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find logs by chat ID (for title generation, context compression)
   * @param chatId The chat ID
   * @returns Promise<LLMLog[]> Array of logs associated with the chat
   */
  async findByChatId(chatId: string): Promise<LLMLog[]> {
    logger.debug('Finding LLM logs by chat ID', { chatId });
    try {
      const collection = await this.getCollection();
      const results = await collection
        .find({ chatId })
        .sort({ createdAt: -1 })
        .toArray();

      const logs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((log): log is LLMLog => log !== null);

      logger.debug('Found LLM logs for chat', { chatId, count: logs.length });
      return logs;
    } catch (error) {
      logger.error('Error finding LLM logs by chat ID', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find logs by character ID (for character wizard operations)
   * @param characterId The character ID
   * @returns Promise<LLMLog[]> Array of logs associated with the character
   */
  async findByCharacterId(characterId: string): Promise<LLMLog[]> {
    logger.debug('Finding LLM logs by character ID', { characterId });
    try {
      const collection = await this.getCollection();
      const results = await collection
        .find({ characterId })
        .sort({ createdAt: -1 })
        .toArray();

      const logs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((log): log is LLMLog => log !== null);

      logger.debug('Found LLM logs for character', { characterId, count: logs.length });
      return logs;
    } catch (error) {
      logger.error('Error finding LLM logs by character ID', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find standalone logs (no messageId, chatId, or characterId - for standalone image gen)
   * @param userId The user ID
   * @param limit Maximum number of logs to return (default: 50)
   * @returns Promise<LLMLog[]> Array of standalone logs
   */
  async findStandalone(userId: string, limit: number = 50): Promise<LLMLog[]> {
    logger.debug('Finding standalone LLM logs', { userId, limit });
    try {
      const collection = await this.getCollection();
      const results = await collection
        .find({
          userId,
          messageId: { $eq: null },
          chatId: { $eq: null },
          characterId: { $eq: null },
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      const logs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((log): log is LLMLog => log !== null);

      logger.debug('Found standalone LLM logs', { userId, count: logs.length });
      return logs;
    } catch (error) {
      logger.error('Error finding standalone LLM logs', {
        userId,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find logs by type with user filter
   * @param userId The user ID
   * @param type The log type
   * @param limit Maximum number of logs to return (default: 50)
   * @returns Promise<LLMLog[]> Array of logs of the specified type
   */
  async findByType(userId: string, type: LLMLogType, limit: number = 50): Promise<LLMLog[]> {
    logger.debug('Finding LLM logs by type', { userId, type, limit });
    try {
      const collection = await this.getCollection();
      const results = await collection
        .find({ userId, type })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      const logs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((log): log is LLMLog => log !== null);

      logger.debug('Found LLM logs by type', { userId, type, count: logs.length });
      return logs;
    } catch (error) {
      logger.error('Error finding LLM logs by type', {
        userId,
        type,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find recent logs for a user
   * @param userId The user ID
   * @param limit Maximum number of logs to return (default: 20)
   * @returns Promise<LLMLog[]> Array of recent logs, sorted by creation date (newest first)
   */
  async findRecent(userId: string, limit: number = 20): Promise<LLMLog[]> {
    logger.debug('Finding recent LLM logs', { userId, limit });
    try {
      const collection = await this.getCollection();
      const results = await collection
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      const logs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((log): log is LLMLog => log !== null);

      logger.debug('Found recent LLM logs', { userId, count: logs.length, limit });
      return logs;
    } catch (error) {
      logger.error('Error finding recent LLM logs', {
        userId,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Create a new log
   * @param data The log data (without id, createdAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<LLMLog> The created log with generated id and timestamp
   */
  async create(
    data: Omit<LLMLog, 'id' | 'createdAt'>,
    options?: CreateOptions
  ): Promise<LLMLog> {
    logger.debug('Creating new LLM log', { userId: data.userId, type: data.type });
    try {
      const id = options?.id || this.generateId();
      const createdAt = options?.createdAt || this.getCurrentTimestamp();

      const log: LLMLog = {
        ...data,
        id,
        createdAt,
      };

      const validated = this.validate(log);
      const collection = await this.getCollection();
      await collection.insertOne(validated as any);

      logger.debug('LLM log created successfully', { logId: id, userId: data.userId, type: data.type });
      return validated;
    } catch (error) {
      logger.error('Error creating LLM log', {
        userId: data.userId,
        type: data.type,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a log
   * Note: LLM logs are typically immutable, but this method is provided for completeness
   * and to satisfy the abstract base class contract
   * @param id The log ID
   * @param data Partial log data to update
   * @returns Promise<LLMLog | null> The updated log if found, null otherwise
   */
  async update(id: string, data: Partial<LLMLog>): Promise<LLMLog | null> {
    logger.debug('Updating LLM log', { logId: id });
    try {
      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('LLM log not found for update', { logId: id });
        return null;
      }

      const updated: LLMLog = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
      };

      const validated = this.validate(updated);
      const collection = await this.getCollection();

      await collection.updateOne({ id }, { $set: validated as any });

      logger.debug('LLM log updated successfully', { logId: id });
      return validated;
    } catch (error) {
      logger.error('Error updating LLM log', {
        logId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a log
   * @param id The log ID
   * @returns Promise<boolean> True if log was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    logger.debug('Deleting LLM log', { logId: id });
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('LLM log not found for deletion', { logId: id });
        return false;
      }

      logger.debug('LLM log deleted successfully', { logId: id });
      return true;
    } catch (error) {
      logger.error('Error deleting LLM log', {
        logId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete logs by user ID (for account cleanup)
   * @param userId The user ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByUserId(userId: string): Promise<number> {
    logger.debug('Deleting LLM logs by user ID', { userId });
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({ userId });

      logger.debug('Deleted LLM logs for user', { userId, deletedCount: result.deletedCount });
      return result.deletedCount || 0;
    } catch (error) {
      logger.error('Error deleting LLM logs by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Cleanup old logs based on retention days
   * @param userId The user ID
   * @param retentionDays Number of days to retain logs (delete older than this)
   * @returns Promise<number> Number of logs deleted
   */
  async cleanupOldLogs(userId: string, retentionDays: number): Promise<number> {
    logger.debug('Cleaning up old LLM logs', { userId, retentionDays });
    try {
      if (retentionDays < 0) {
        logger.warn('Invalid retention days', { retentionDays });
        return 0;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const collection = await this.getCollection();
      const result = await collection.deleteMany({
        userId,
        createdAt: { $lt: cutoffDate.toISOString() },
      });

      logger.info('Cleaned up old LLM logs', {
        userId,
        retentionDays,
        deletedCount: result.deletedCount,
        cutoffDate: cutoffDate.toISOString(),
      });
      return result.deletedCount || 0;
    } catch (error) {
      logger.error('Error cleaning up old LLM logs', {
        userId,
        retentionDays,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Count logs for a user
   * @param userId The user ID
   * @returns Promise<number> Number of logs for the user
   */
  async countByUserId(userId: string): Promise<number> {
    logger.debug('Counting LLM logs for user', { userId });
    try {
      const collection = await this.getCollection();
      const count = await collection.countDocuments({ userId });

      logger.debug('LLM log count retrieved', { userId, count });
      return count;
    } catch (error) {
      logger.error('Error counting LLM logs for user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Count logs by type for a user
   * @param userId The user ID
   * @param type The log type
   * @returns Promise<number> Number of logs of the specified type
   */
  async countByType(userId: string, type: LLMLogType): Promise<number> {
    logger.debug('Counting LLM logs by type', { userId, type });
    try {
      const collection = await this.getCollection();
      const count = await collection.countDocuments({ userId, type });

      logger.debug('LLM log count by type retrieved', { userId, type, count });
      return count;
    } catch (error) {
      logger.error('Error counting LLM logs by type', {
        userId,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Get total token usage for a user
   * @param userId The user ID
   * @returns Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> Total token usage
   */
  async getTotalTokenUsage(
    userId: string
  ): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
    logger.debug('Getting total token usage for user', { userId });
    try {
      const collection = await this.getCollection();
      const results = await collection
        .find({ userId, usage: { $exists: true, $ne: null } })
        .toArray();

      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let totalTokens = 0;

      for (const result of results) {
        const validation = this.validateSafe(result);
        if (validation.success && validation.data?.usage) {
          totalPromptTokens += validation.data.usage.promptTokens || 0;
          totalCompletionTokens += validation.data.usage.completionTokens || 0;
          totalTokens += validation.data.usage.totalTokens || 0;
        }
      }

      logger.debug('Retrieved total token usage', { userId, totalPromptTokens, totalCompletionTokens, totalTokens });
      return { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens };
    } catch (error) {
      logger.error('Error getting total token usage', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
  }

  /**
   * Count logs associated with a message ID
   * @param messageId The message ID
   * @returns Promise<number> Number of logs for the message
   */
  async countByMessageId(messageId: string): Promise<number> {
    logger.debug('Counting LLM logs for message', { messageId });
    try {
      const collection = await this.getCollection();
      const count = await collection.countDocuments({ messageId });

      logger.debug('LLM log count for message', { messageId, count });
      return count;
    } catch (error) {
      logger.error('Error counting LLM logs for message', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Delete logs by message ID
   * @param messageId The message ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByMessageId(messageId: string): Promise<number> {
    logger.debug('Deleting LLM logs by message ID', { messageId });
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({ messageId });

      logger.debug('Deleted LLM logs for message', { messageId, deletedCount: result.deletedCount });
      return result.deletedCount || 0;
    } catch (error) {
      logger.error('Error deleting LLM logs by message ID', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete logs by chat ID
   * @param chatId The chat ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByChatId(chatId: string): Promise<number> {
    logger.debug('Deleting LLM logs by chat ID', { chatId });
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({ chatId });

      logger.debug('Deleted LLM logs for chat', { chatId, deletedCount: result.deletedCount });
      return result.deletedCount || 0;
    } catch (error) {
      logger.error('Error deleting LLM logs by chat ID', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete logs by character ID
   * @param characterId The character ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByCharacterId(characterId: string): Promise<number> {
    logger.debug('Deleting LLM logs by character ID', { characterId });
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({ characterId });

      logger.debug('Deleted LLM logs for character', { characterId, deletedCount: result.deletedCount });
      return result.deletedCount || 0;
    } catch (error) {
      logger.error('Error deleting LLM logs by character ID', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
