/**
 * LLM Logging Service
 *
 * Central service for logging LLM API calls to the database.
 * Handles request/response summarization and respects user settings.
 *
 * @module services/llm-logging
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  LLMLog,
  LLMLogType,
  LLMLogRequestSummary,
  LLMLogResponseSummary,
  LLMLogTokenUsage,
  LLMLogCacheUsage,
} from '@/lib/schemas/types';
import type { LLMLoggingSettings } from '@/lib/schemas/settings.types';

const logger = createServiceLogger('llm-logging');

/** Preview length for content (first N chars) - used for quick display */
const PREVIEW_LENGTH = 500;

/**
 * Parameters for logging an LLM call
 */
export interface LogLLMCallParams {
  userId: string;
  type: LLMLogType;
  messageId?: string;
  chatId?: string;
  characterId?: string;
  provider: string;
  modelName: string;
  request: {
    messages: Array<{
      role: string;
      content: string;
      attachments?: unknown[];
    }>;
    temperature?: number;
    maxTokens?: number;
    tools?: unknown[];
  };
  response: {
    content: string;
    error?: string;
  };
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  cacheUsage?: {
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  durationMs?: number;
}

/**
 * Check if LLM logging is enabled for a user
 */
export async function isLoggingEnabled(userId: string): Promise<LLMLoggingSettings | null> {
  try {
    logger.debug('Checking LLM logging settings', { userId });

    const repos = getRepositories();
    const settings = await repos.chatSettings.findByUserId(userId);

    // Return the settings if logging is enabled, null otherwise
    if (settings?.llmLoggingSettings?.enabled) {
      logger.debug('LLM logging enabled for user', {
        userId,
        verboseMode: settings.llmLoggingSettings.verboseMode,
        retentionDays: settings.llmLoggingSettings.retentionDays,
      });
      return settings.llmLoggingSettings;
    }

    // Default to enabled if settings don't exist yet
    if (!settings || !settings.llmLoggingSettings) {
      logger.debug('No settings found for user, using defaults', { userId });
      return {
        enabled: true,
        verboseMode: false,
        retentionDays: 30,
      };
    }

    logger.debug('LLM logging disabled for user', { userId });
    return null;
  } catch (error) {
    logger.warn('Failed to check LLM logging settings', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Default to enabled on error
    return {
      enabled: true,
      verboseMode: false,
      retentionDays: 30,
    };
  }
}

/**
 * Summarize request messages for storage
 * Always stores full message content for debugging purposes
 */
function summarizeRequest(
  request: LogLLMCallParams['request'],
  _verboseMode: boolean
): LLMLogRequestSummary {
  const messages = request.messages.map((msg) => ({
    role: msg.role,
    contentPreview: msg.content?.slice(0, PREVIEW_LENGTH) || '',
    contentLength: msg.content?.length || 0,
    hasAttachments: !!(msg.attachments && msg.attachments.length > 0),
  }));

  return {
    messageCount: request.messages.length,
    messages,
    temperature: request.temperature ?? null,
    maxTokens: request.maxTokens ?? null,
    toolCount: request.tools?.length || 0,
    // Always store full messages for complete debugging
    fullMessages: request.messages,
  };
}

/**
 * Summarize response for storage
 * Always stores full response content for debugging purposes
 */
function summarizeResponse(
  response: LogLLMCallParams['response'],
  _verboseMode: boolean
): LLMLogResponseSummary {
  return {
    contentPreview: response.content?.slice(0, PREVIEW_LENGTH) || '',
    contentLength: response.content?.length || 0,
    // Always store full content for complete debugging
    fullContent: response.content || null,
    error: response.error ?? null,
  };
}

/**
 * Log an LLM API call to the database
 *
 * @param params - The parameters for the log entry
 * @returns The created log entry, or null if logging is disabled or failed
 */
export async function logLLMCall(params: LogLLMCallParams): Promise<LLMLog | null> {
  try {
    // Check if logging is enabled for this user
    const loggingSettings = await isLoggingEnabled(params.userId);
    if (!loggingSettings) {
      logger.debug('LLM logging disabled for user', { userId: params.userId });
      return null;
    }

    logger.debug('Logging LLM call', {
      userId: params.userId,
      type: params.type,
      provider: params.provider,
      model: params.modelName,
    });

    const verboseMode = loggingSettings.verboseMode;

    // Summarize request and response
    const requestSummary = summarizeRequest(params.request, verboseMode);
    const responseSummary = summarizeResponse(params.response, verboseMode);

    // Build usage objects if provided
    let usage: LLMLogTokenUsage | null = null;
    if (
      params.usage?.promptTokens !== undefined ||
      params.usage?.completionTokens !== undefined ||
      params.usage?.totalTokens !== undefined
    ) {
      usage = {
        promptTokens: params.usage.promptTokens ?? 0,
        completionTokens: params.usage.completionTokens ?? 0,
        totalTokens: params.usage.totalTokens ?? 0,
      };
      logger.debug('Token usage captured', { userId: params.userId, usage });
    }

    let cacheUsage: LLMLogCacheUsage | null = null;
    if (
      params.cacheUsage?.cacheCreationInputTokens !== undefined ||
      params.cacheUsage?.cacheReadInputTokens !== undefined
    ) {
      cacheUsage = {
        cacheCreationInputTokens: params.cacheUsage.cacheCreationInputTokens,
        cacheReadInputTokens: params.cacheUsage.cacheReadInputTokens,
      };
      logger.debug('Cache usage captured', { userId: params.userId, cacheUsage });
    }

    // Create the log entry
    const repos = getRepositories();
    const logEntry = await repos.llmLogs.create({
      userId: params.userId,
      type: params.type,
      messageId: params.messageId ?? null,
      chatId: params.chatId ?? null,
      characterId: params.characterId ?? null,
      provider: params.provider,
      modelName: params.modelName,
      request: requestSummary,
      response: responseSummary,
      usage,
      cacheUsage,
      durationMs: params.durationMs ?? null,
    });

    logger.debug('LLM call logged successfully', {
      logId: logEntry.id,
      userId: params.userId,
      type: params.type,
      provider: params.provider,
      model: params.modelName,
      durationMs: params.durationMs,
    });

    return logEntry;
  } catch (error) {
    logger.error('Failed to log LLM call', {
      userId: params.userId,
      type: params.type,
      provider: params.provider,
      model: params.modelName,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - logging failures shouldn't break the main flow
    return null;
  }
}

/**
 * Get logs for a specific message
 */
export async function getLogsForMessage(messageId: string): Promise<LLMLog[]> {
  try {
    logger.debug('Retrieving logs for message', { messageId });

    const repos = getRepositories();
    const logs = await repos.llmLogs.findByMessageId(messageId);

    logger.debug('Retrieved logs for message', { messageId, count: logs.length });
    return logs;
  } catch (error) {
    logger.error('Failed to get logs for message', {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get logs for a specific chat
 */
export async function getLogsForChat(chatId: string): Promise<LLMLog[]> {
  try {
    logger.debug('Retrieving logs for chat', { chatId });

    const repos = getRepositories();
    const logs = await repos.llmLogs.findByChatId(chatId);

    logger.debug('Retrieved logs for chat', { chatId, count: logs.length });
    return logs;
  } catch (error) {
    logger.error('Failed to get logs for chat', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get logs for a specific character
 */
export async function getLogsForCharacter(characterId: string): Promise<LLMLog[]> {
  try {
    logger.debug('Retrieving logs for character', { characterId });

    const repos = getRepositories();
    const logs = await repos.llmLogs.findByCharacterId(characterId);

    logger.debug('Retrieved logs for character', { characterId, count: logs.length });
    return logs;
  } catch (error) {
    logger.error('Failed to get logs for character', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Check if a message has any associated LLM logs
 */
export async function messageHasLogs(messageId: string): Promise<boolean> {
  try {
    logger.debug('Checking if message has logs', { messageId });

    const repos = getRepositories();
    const count = await repos.llmLogs.countByMessageId(messageId);

    const hasLogs = count > 0;
    logger.debug('Message log check complete', { messageId, hasLogs, count });
    return hasLogs;
  } catch (error) {
    logger.error('Failed to check if message has logs', {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Get logs for a specific user with pagination
 */
export async function getLogsForUser(
  userId: string,
  limit: number = 50,
  offset: number = 0
): Promise<LLMLog[]> {
  try {
    logger.debug('Retrieving logs for user', { userId, limit, offset });

    const repos = getRepositories();
    const logs = await repos.llmLogs.findByUserId(userId, limit, offset);

    logger.debug('Retrieved logs for user', { userId, count: logs.length, limit, offset });
    return logs;
  } catch (error) {
    logger.error('Failed to get logs for user', {
      userId,
      limit,
      offset,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get recent logs for a user
 */
export async function getRecentLogs(userId: string, limit: number = 20): Promise<LLMLog[]> {
  try {
    logger.debug('Retrieving recent logs for user', { userId, limit });

    const repos = getRepositories();
    const logs = await repos.llmLogs.findRecent(userId, limit);

    logger.debug('Retrieved recent logs for user', { userId, count: logs.length, limit });
    return logs;
  } catch (error) {
    logger.error('Failed to get recent logs for user', {
      userId,
      limit,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Count logs for a user
 */
export async function countLogsForUser(userId: string): Promise<number> {
  try {
    logger.debug('Counting logs for user', { userId });

    const repos = getRepositories();
    const count = await repos.llmLogs.countByUserId(userId);

    logger.debug('Retrieved log count for user', { userId, count });
    return count;
  } catch (error) {
    logger.error('Failed to count logs for user', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Get total token usage for a user
 */
export async function getTotalTokenUsage(
  userId: string
): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
  try {
    logger.debug('Retrieving total token usage for user', { userId });

    const repos = getRepositories();
    const usage = await repos.llmLogs.getTotalTokenUsage(userId);

    logger.debug('Retrieved total token usage for user', {
      userId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });
    return usage;
  } catch (error) {
    logger.error('Failed to get total token usage for user', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
}

/**
 * Get logs by type for a user
 */
export async function getLogsByType(
  userId: string,
  type: LLMLogType,
  limit: number = 50
): Promise<LLMLog[]> {
  try {
    logger.debug('Retrieving logs by type for user', { userId, type, limit });

    const repos = getRepositories();
    const logs = await repos.llmLogs.findByType(userId, type, limit);

    logger.debug('Retrieved logs by type for user', { userId, type, count: logs.length, limit });
    return logs;
  } catch (error) {
    logger.error('Failed to get logs by type for user', {
      userId,
      type,
      limit,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Cleanup old logs for a user based on retention settings
 */
export async function cleanupOldLogs(userId: string, retentionDays: number): Promise<number> {
  try {
    logger.debug('Cleaning up old logs for user', { userId, retentionDays });

    const repos = getRepositories();
    const deletedCount = await repos.llmLogs.cleanupOldLogs(userId, retentionDays);

    logger.info('Cleaned up old logs for user', { userId, retentionDays, deletedCount });
    return deletedCount;
  } catch (error) {
    logger.error('Failed to cleanup old logs for user', {
      userId,
      retentionDays,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Delete all logs for a user (for account cleanup)
 */
export async function deleteAllLogsForUser(userId: string): Promise<number> {
  try {
    logger.debug('Deleting all logs for user', { userId });

    const repos = getRepositories();
    const deletedCount = await repos.llmLogs.deleteByUserId(userId);

    logger.info('Deleted all logs for user', { userId, deletedCount });
    return deletedCount;
  } catch (error) {
    logger.error('Failed to delete all logs for user', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Get standalone logs (not associated with a message, chat, or character)
 */
export async function getStandaloneLogs(userId: string, limit: number = 50): Promise<LLMLog[]> {
  try {
    logger.debug('Retrieving standalone logs for user', { userId, limit });

    const repos = getRepositories();
    const logs = await repos.llmLogs.findStandalone(userId, limit);

    logger.debug('Retrieved standalone logs for user', { userId, count: logs.length, limit });
    return logs;
  } catch (error) {
    logger.error('Failed to get standalone logs for user', {
      userId,
      limit,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
