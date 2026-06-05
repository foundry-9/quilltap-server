/**
 * Migration: Add autonomousRunId column to llm_logs
 *
 * Adds a nullable `autonomousRunId` column (plus a supporting index) to the
 * llm_logs table in the dedicated llm-logs database. Every LLM call made
 * inside an autonomous-room turn is stamped with the run's id (via the
 * autonomous-run AsyncLocalStorage), so per-run token spend can be summed by
 * run id instead of by a fragile timestamp window over the whole chat. The
 * old window-sum double-counted overlapping chat activity and was sensitive to
 * the forked-job child's buffered-write timing, which let a long-running chat
 * trip its room token budget after a single turn.
 *
 * Migration ID: add-llm-logs-autonomous-run-id-column-v1
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

export const addLLMLogsAutonomousRunIdColumnMigration: Migration = {
  id: 'add-llm-logs-autonomous-run-id-column-v1',
  description: 'Add autonomousRunId column + index to llm_logs in the dedicated logs DB',
  introducedInVersion: '4.6.1',
  dependsOn: ['add-llm-logs-raw-provider-usage-column-v1'],

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
      return !tableHasColumn(db, 'llm_logs', 'autonomousRunId')
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
          id: 'add-llm-logs-autonomous-run-id-column-v1',
          success: true,
          itemsAffected: 0,
          message: 'llm_logs table does not exist; nothing to do',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        }
      }

      if (!tableHasColumn(db, 'llm_logs', 'autonomousRunId')) {
        db.exec(`ALTER TABLE "llm_logs" ADD COLUMN "autonomousRunId" TEXT DEFAULT NULL`)
        logger.info('Added autonomousRunId column to llm_logs', {
          context: 'migration.add-llm-logs-autonomous-run-id-column',
        })
      }

      // Supporting index for the per-run budget sum (WHERE autonomousRunId = ?).
      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_llm_logs_autonomousRunId" ON "llm_logs" ("autonomousRunId")`
      )

      return {
        id: 'add-llm-logs-autonomous-run-id-column-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added autonomousRunId column + index to llm_logs',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to add autonomousRunId column to llm_logs', {
        context: 'migration.add-llm-logs-autonomous-run-id-column',
        error: errorMessage,
      })
      return {
        id: 'add-llm-logs-autonomous-run-id-column-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add autonomousRunId column',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }
    } finally {
      db?.close()
    }
  },
}
