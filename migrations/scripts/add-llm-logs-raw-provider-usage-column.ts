/**
 * Migration: Add rawProviderUsage column to llm_logs
 *
 * Adds a JSON-encoded `rawProviderUsage` column to the llm_logs table in the
 * dedicated llm-logs database. Stores the provider-shape `usage` sub-object
 * captured pre-normalization so a SQL query can compare provider-reported
 * cache hits against the normalized `cacheUsage` and catch plugin
 * field-mapping regressions (the 2026-04 Z.AI pathology: provider reported
 * cache hits but plugin never read `prompt_tokens_details.cached_tokens`).
 *
 * Migration ID: add-llm-logs-raw-provider-usage-column-v1
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

export const addLLMLogsRawProviderUsageColumnMigration: Migration = {
  id: 'add-llm-logs-raw-provider-usage-column-v1',
  description: 'Add rawProviderUsage JSON column to llm_logs in the dedicated logs DB',
  introducedInVersion: '4.6.0',
  dependsOn: ['add-llm-logs-request-hashes-column-v1'],

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
      return !tableHasColumn(db, 'llm_logs', 'rawProviderUsage')
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
          id: 'add-llm-logs-raw-provider-usage-column-v1',
          success: true,
          itemsAffected: 0,
          message: 'llm_logs table does not exist; nothing to do',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        }
      }

      if (!tableHasColumn(db, 'llm_logs', 'rawProviderUsage')) {
        db.exec(`ALTER TABLE "llm_logs" ADD COLUMN "rawProviderUsage" TEXT DEFAULT NULL`)
        logger.info('Added rawProviderUsage column to llm_logs', {
          context: 'migration.add-llm-logs-raw-provider-usage-column',
        })
      }

      return {
        id: 'add-llm-logs-raw-provider-usage-column-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added rawProviderUsage column to llm_logs',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to add rawProviderUsage column to llm_logs', {
        context: 'migration.add-llm-logs-raw-provider-usage-column',
        error: errorMessage,
      })
      return {
        id: 'add-llm-logs-raw-provider-usage-column-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add rawProviderUsage column',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }
    } finally {
      db?.close()
    }
  },
}
