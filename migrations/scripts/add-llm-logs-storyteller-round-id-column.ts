/**
 * Migration: Add storytellerRoundId column to llm_logs
 *
 * Adds a nullable `storytellerRoundId` column (plus an index) to llm_logs in
 * the dedicated llm-logs database. Every LLM call made for a storyteller round
 * — each bid, and each speaking turn the round runs — is stamped with the
 * round's id through an AsyncLocalStorage, so the inspector can show a round
 * as one group. Losing bids are recorded only here.
 *
 * Migration ID: add-llm-logs-storyteller-round-id-column-v1
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import type { Migration, MigrationResult } from '../types'
import { logger } from '../lib/logger'
import { isSQLiteBackend } from '../lib/database-utils'
import { getDataDir } from '../../lib/paths'

function getLLMLogsDbPath(): string {
  return process.env.SQLITE_LLM_LOGS_PATH || path.join(getDataDir(), 'quilltap-llm-logs.db')
}

function openLogsDb(logsDbPath: string): Database.Database {
  const db = new Database(logsDbPath)
  const sqlcipherKey = process.env.ENCRYPTION_MASTER_PEPPER
  if (sqlcipherKey) {
    const keyHex = Buffer.from(sqlcipherKey, 'base64').toString('hex')
    db.pragma(`key = "x'${keyHex}'"`)
  }
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  return db
}

function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>
  return rows.some(r => r.name === column)
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
  return !!row
}

export const addLLMLogsStorytellerRoundIdColumnMigration: Migration = {
  id: 'add-llm-logs-storyteller-round-id-column-v1',
  description: 'Add storytellerRoundId column + index to llm_logs in the dedicated logs DB',
  introducedInVersion: '4.11.0',
  dependsOn: ['add-llm-logs-autonomous-run-id-column-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false
    }
    const logsDbPath = getLLMLogsDbPath()
    if (!fs.existsSync(logsDbPath)) {
      // Fresh installs create the table from the Zod-derived DDL on first
      // access; the column will be there from the start.
      return false
    }
    let db: Database.Database | null = null
    try {
      db = openLogsDb(logsDbPath)
      if (!tableExists(db, 'llm_logs')) {
        return false
      }
      return !tableHasColumn(db, 'llm_logs', 'storytellerRoundId')
    } catch {
      return false
    } finally {
      db?.close()
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now()
    const logsDbPath = getLLMLogsDbPath()
    let db: Database.Database | null = null

    try {
      db = openLogsDb(logsDbPath)

      if (!tableExists(db, 'llm_logs')) {
        return {
          id: 'add-llm-logs-storyteller-round-id-column-v1',
          success: true,
          itemsAffected: 0,
          message: 'llm_logs table does not exist; nothing to do',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        }
      }

      if (!tableHasColumn(db, 'llm_logs', 'storytellerRoundId')) {
        db.exec(`ALTER TABLE "llm_logs" ADD COLUMN "storytellerRoundId" TEXT DEFAULT NULL`)
        logger.info('Added storytellerRoundId column to llm_logs', {
          context: 'migration.add-llm-logs-storyteller-round-id-column',
        })
      }

      // Supporting index for the per-run budget sum (WHERE storytellerRoundId = ?).
      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_llm_logs_storytellerRoundId" ON "llm_logs" ("storytellerRoundId")`
      )

      return {
        id: 'add-llm-logs-storyteller-round-id-column-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added storytellerRoundId column + index to llm_logs',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to add storytellerRoundId column to llm_logs', {
        context: 'migration.add-llm-logs-storyteller-round-id-column',
        error: errorMessage,
      })
      return {
        id: 'add-llm-logs-storyteller-round-id-column-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add storytellerRoundId column',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }
    } finally {
      db?.close()
    }
  },
}
