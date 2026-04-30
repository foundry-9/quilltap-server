/**
 * Migration: Add summarization-gate tracking fields to chats
 *
 * Adds four columns to the `chats` table to support the triple-gate
 * summarization trigger introduced in Phase 2 of the LLM cost-reduction plan:
 *
 *   - compactionGeneration  INTEGER DEFAULT 0  — bumped on every fire
 *   - lastSummaryTurn       INTEGER DEFAULT 0  — drives T_soft (8-turn window)
 *   - lastSummaryTokens     INTEGER DEFAULT 0  — drives T_soft (8K-token window)
 *   - lastFullRebuildTurn   INTEGER DEFAULT 0  — drives T_hard (50-turn ceiling)
 *
 * Migration ID: add-summarization-gate-fields-v1
 */

import type { Migration, MigrationResult } from '../types'
import { logger } from '../lib/logger'
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils'

const COLUMNS_TO_ADD: Array<{ name: string; ddl: string }> = [
  { name: 'compactionGeneration', ddl: `ALTER TABLE "chats" ADD COLUMN "compactionGeneration" INTEGER DEFAULT 0` },
  { name: 'lastSummaryTurn', ddl: `ALTER TABLE "chats" ADD COLUMN "lastSummaryTurn" INTEGER DEFAULT 0` },
  { name: 'lastSummaryTokens', ddl: `ALTER TABLE "chats" ADD COLUMN "lastSummaryTokens" INTEGER DEFAULT 0` },
  { name: 'lastFullRebuildTurn', ddl: `ALTER TABLE "chats" ADD COLUMN "lastFullRebuildTurn" INTEGER DEFAULT 0` },
]

export const addSummarizationGateFieldsMigration: Migration = {
  id: 'add-summarization-gate-fields-v1',
  description: 'Add compactionGeneration / lastSummaryTurn / lastSummaryTokens / lastFullRebuildTurn columns to chats',
  introducedInVersion: '4.4.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false
    if (!sqliteTableExists('chats')) return false
    const existing = new Set(getSQLiteTableColumns('chats').map(c => c.name))
    return COLUMNS_TO_ADD.some(c => !existing.has(c.name))
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now()
    let itemsAffected = 0

    try {
      const db = getSQLiteDatabase()
      const existing = new Set(getSQLiteTableColumns('chats').map(c => c.name))

      for (const col of COLUMNS_TO_ADD) {
        if (existing.has(col.name)) continue
        db.exec(col.ddl)
        itemsAffected++
        logger.info(`Added ${col.name} column to chats`, {
          context: 'migration.add-summarization-gate-fields',
        })
      }

      return {
        id: 'add-summarization-gate-fields-v1',
        success: true,
        itemsAffected,
        message: `Added ${itemsAffected} summarization-gate column(s) to chats`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to add summarization-gate columns', {
        context: 'migration.add-summarization-gate-fields',
        error: errorMessage,
      })
      return {
        id: 'add-summarization-gate-fields-v1',
        success: false,
        itemsAffected,
        message: 'Failed to add summarization-gate columns',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }
    }
  },
}
