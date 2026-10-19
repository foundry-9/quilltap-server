/**
 * Log Tool Handlers
 *
 * Executes `log_create_entry`, `log_grep` and `log_read` against the
 * instance's log (`log_entries`, in the LLM logs database). A new entry is
 * stamped with the call's chat and character; the two readers see every
 * entry in the instance and answer JSON, newest first, with each author's
 * name beside their id.
 *
 * In an autonomous room the call runs in the job child, where a new entry is
 * buffered until the job commits — a read in the same turn does not see it.
 */

import { validateLogCreateEntryInput, type LogCreateEntryToolOutput } from '../log-create-entry-tool';
import { DEFAULT_LOG_RESULT_LIMIT, validateLogGrepInput } from '../log-grep-tool';
import { validateLogReadInput } from '../log-read-tool';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getErrorMessage } from '@/lib/error-utils';
import { writeLogEntry } from '@/lib/log-entries/write';
import { compileSqlRegexp } from '@/lib/database/backends/sqlite/regexp-function';
import { resolveCharacterByNameOrId } from '@/lib/services/character-resolver';
import type { LogEntry } from '@/lib/schemas/log-entry.types';

const logger = createServiceLogger('LogToolHandler');

/** Context every log tool receives from the executor. */
export interface LogToolContext {
  userId: string;
  chatId: string;
  /** The calling character; absent when the operator runs the tool with no character seat. */
  characterId?: string;
}

/** One entry as the model sees it. */
export interface LogEntryView {
  id: string;
  message: string;
  conversationId: string;
  characterId: string | null;
  characterName: string | null;
  createdAt: string;
}

/** What `log_grep` and `log_read` answer. */
export interface LogQueryToolOutput {
  success: boolean;
  entries?: LogEntryView[];
  /** Entries returned. Equal to the limit means there may be more. */
  count?: number;
  limit?: number;
  error?: string;
}

/** Label entries with their authors' names — one batched lookup per call. */
async function toViews(entries: LogEntry[]): Promise<LogEntryView[]> {
  const ids = entries.map((entry) => entry.characterId).filter((id): id is string => !!id);
  const names = await getRepositories().characters.findNamesByIds(ids);
  return entries.map((entry) => ({
    id: entry.id,
    message: entry.message,
    conversationId: entry.chatId,
    characterId: entry.characterId,
    characterName: entry.characterId ? (names.get(entry.characterId) ?? null) : null,
    createdAt: entry.createdAt,
  }));
}

/**
 * Execute `log_create_entry`.
 */
export async function executeLogCreateEntryTool(
  input: unknown,
  context: LogToolContext
): Promise<LogCreateEntryToolOutput> {
  const parsed = validateLogCreateEntryInput(input);
  if (!parsed) {
    logger.debug('log_create_entry validation failed', { chatId: context.chatId, input });
    return { success: false, error: 'Invalid input: message must be a non-empty string.' };
  }

  try {
    const entry = await writeLogEntry({
      message: parsed.message,
      chatId: context.chatId,
      characterId: context.characterId ?? null,
    });
    return {
      success: true,
      entry: { id: entry.id, message: entry.message, conversationId: entry.chatId, createdAt: entry.createdAt },
    };
  } catch (error) {
    logger.warn('log_create_entry failed', { chatId: context.chatId, error: getErrorMessage(error) });
    return { success: false, error: `The log entry could not be written: ${getErrorMessage(error)}` };
  }
}

/**
 * Execute `log_grep`.
 */
export async function executeLogGrepTool(input: unknown, context: LogToolContext): Promise<LogQueryToolOutput> {
  const parsed = validateLogGrepInput(input);
  if (!parsed) {
    logger.debug('log_grep validation failed', { chatId: context.chatId, input });
    return { success: false, error: 'Invalid input: pattern must be a non-empty string; limit, if given, 1–200.' };
  }

  const flags = parsed.ignore_case ? 'i' : '';
  const compiled = compileSqlRegexp(parsed.pattern, flags);
  if (!compiled.ok) {
    return { success: false, error: `Invalid regular expression: ${compiled.reason}` };
  }

  const limit = parsed.limit ?? DEFAULT_LOG_RESULT_LIMIT;
  try {
    const entries = await getRepositories().logEntries.searchMessages(parsed.pattern, flags, limit);
    logger.debug('log_grep answered', { chatId: context.chatId, returned: entries.length, limit });
    return { success: true, entries: await toViews(entries), count: entries.length, limit };
  } catch (error) {
    logger.warn('log_grep failed', { chatId: context.chatId, error: getErrorMessage(error) });
    return { success: false, error: `The log could not be searched: ${getErrorMessage(error)}` };
  }
}

/**
 * Execute `log_read`.
 */
export async function executeLogReadTool(input: unknown, context: LogToolContext): Promise<LogQueryToolOutput> {
  const parsed = validateLogReadInput(input);
  if (!parsed) {
    logger.debug('log_read validation failed', { chatId: context.chatId, input });
    return {
      success: false,
      error: 'Invalid input: from and to must be ISO-8601 dates or date-times with from not after to; limit, if given, 1–200.',
    };
  }

  let characterId: string | undefined;
  if (parsed.character) {
    const character = await resolveCharacterByNameOrId(context.userId, parsed.character);
    if (!character) {
      return { success: false, error: `No character named "${parsed.character}" was found.` };
    }
    characterId = character.id;
  }

  const chatId = parsed.conversationId === 'current' ? context.chatId : parsed.conversationId;
  const limit = parsed.limit ?? DEFAULT_LOG_RESULT_LIMIT;
  try {
    // Normalised to the stored form so the bounds compare as the column does.
    const entries = await getRepositories().logEntries.findEntries({
      ...(chatId ? { chatId } : {}),
      ...(characterId ? { characterId } : {}),
      ...(parsed.from ? { from: new Date(parsed.from).toISOString() } : {}),
      ...(parsed.to ? { to: new Date(parsed.to).toISOString() } : {}),
      limit,
    });
    logger.debug('log_read answered', { chatId: context.chatId, returned: entries.length, limit });
    return { success: true, entries: await toViews(entries), count: entries.length, limit };
  } catch (error) {
    logger.warn('log_read failed', { chatId: context.chatId, error: getErrorMessage(error) });
    return { success: false, error: `The log could not be read: ${getErrorMessage(error)}` };
  }
}
