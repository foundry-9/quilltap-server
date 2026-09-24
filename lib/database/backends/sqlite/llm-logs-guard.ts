/**
 * Shared guard for repositories backed by the LLM logs database.
 *
 * The LLM-logs twin of `./mount-index-guard`: refuses to hand out a
 * connection while the logs database is degraded, and refuses when it has
 * not been initialized at all. `LLMLogsRepository` acquires its connection
 * through exactly this check.
 *
 * @module lib/database/backends/sqlite/llm-logs-guard
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { getRawLLMLogsDatabase, isLLMLogsDegraded } from './llm-logs-client';

/**
 * Return the raw LLM logs database, or throw when it is degraded or not
 * initialized.
 */
export function requireLLMLogsDb(): DatabaseType {
  if (isLLMLogsDegraded()) {
    throw new Error('LLM logs database is in degraded mode');
  }

  const db = getRawLLMLogsDatabase();
  if (!db) {
    throw new Error('LLM logs database not initialized');
  }

  return db;
}
