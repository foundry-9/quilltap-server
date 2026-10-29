/**
 * Writing a log entry — the one door both writers come through: the
 * `log_create_entry` tool and a custom tool's `log` effect.
 *
 * Stamps the chat and the character the caller hands over (never anything the
 * model said), trims, and clips an over-long line at
 * {@link MAX_LOG_ENTRY_MESSAGE_LENGTH} rather than refusing it. In the job
 * child the write is buffered like any other and lands when the job commits,
 * so a read in the same autonomous turn does not see it yet.
 *
 * @module lib/log-entries/write
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { MAX_LOG_ENTRY_MESSAGE_LENGTH, type LogEntry } from '@/lib/schemas/log-entry.types';

export interface WriteLogEntryParams {
  message: string;
  chatId: string;
  /** The writing character; null when the operator acts with no character seat. */
  characterId: string | null;
}

/** Write one entry. Throws when the line is empty after trimming or the logs database is unavailable. */
export async function writeLogEntry(params: WriteLogEntryParams): Promise<LogEntry> {
  const trimmed = params.message.trim();
  if (trimmed.length === 0) throw new Error('A log entry needs a message');

  const clipped = trimmed.length > MAX_LOG_ENTRY_MESSAGE_LENGTH;
  const message = clipped ? trimmed.slice(0, MAX_LOG_ENTRY_MESSAGE_LENGTH) : trimmed;
  if (clipped) {
    logger.debug('Log entry clipped to the maximum length', {
      chatId: params.chatId,
      length: trimmed.length,
      max: MAX_LOG_ENTRY_MESSAGE_LENGTH,
    });
  }

  const entry = await getRepositories().logEntries.create({
    message,
    chatId: params.chatId,
    characterId: params.characterId,
  });
  logger.debug('Log entry written', { id: entry.id, chatId: params.chatId, characterId: params.characterId });
  return entry;
}
