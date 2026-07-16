/**
 * Help Documentation Sync Service
 *
 * Reads help Markdown files from disk and upserts them into the database.
 * This replaces the build-time help bundle approach, allowing help docs
 * to be embedded at runtime using the user's chosen embedding profile.
 *
 * @module lib/help/help-doc-sync
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

const HELP_DIR = join(process.cwd(), 'help')

/**
 * Result of a help doc sync operation
 */
export interface HelpDocSyncResult {
  /** Total docs found on disk */
  totalOnDisk: number
  /** Docs created (new) */
  created: number
  /** Docs updated (content changed) */
  updated: number
  /** Docs unchanged (hash match) */
  unchanged: number
  /** Docs that failed to sync */
  failed: number
  /** IDs of docs that were created or updated (need embedding) */
  changedIds: string[]
}

/**
 * Find all Markdown files in a directory recursively
 */
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = []

  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        files.push(...findMarkdownFiles(fullPath))
      } else if (entry.endsWith('.md')) {
        files.push(fullPath)
      }
    }
  } catch (err) {
    logger.error('[HelpDocSync] Error reading directory', {
      context: 'findMarkdownFiles',
      dir,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return files
}

/**
 * List the help documents present on disk, as repository-relative paths
 * (the form stored in `help_docs.path`).
 */
function listHelpDocPathsOnDisk(): string[] {
  if (!existsSync(HELP_DIR)) {
    return []
  }

  return findMarkdownFiles(HELP_DIR).map(filePath => relative(process.cwd(), filePath))
}

/**
 * Parse YAML frontmatter from Markdown content
 */
function parseFrontmatter(content: string): { url: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) {
    return { url: '', body: content }
  }

  const frontmatter = match[1]
  const urlMatch = frontmatter.match(/^url:\s*(.+)$/m)
  const url = urlMatch ? urlMatch[1].trim() : ''
  const body = content.slice(match[0].length)
  return { url, body }
}

/**
 * Extract title from Markdown content (first H1) or fallback to filename
 */
function extractTitle(content: string, filePath: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m)
  if (h1Match) {
    return h1Match[1].trim()
  }

  const filename = filePath.split('/').pop()?.replace('.md', '') || 'Unknown'
  return filename
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Generate SHA-256 hash of content
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Sync help documentation from disk to database.
 *
 * Reads all .md files from the help/ directory, parses frontmatter,
 * and upserts into the help_docs collection. Returns info about
 * which docs changed (need re-embedding).
 *
 * @returns Sync result with counts and changed doc IDs
 */
export async function syncHelpDocs(): Promise<HelpDocSyncResult> {
  const result: HelpDocSyncResult = {
    totalOnDisk: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    changedIds: [],
  }

  if (!existsSync(HELP_DIR)) {
    logger.warn('[HelpDocSync] Help directory not found', {
      context: 'syncHelpDocs',
      helpDir: HELP_DIR,
    })
    return result
  }

  const files = findMarkdownFiles(HELP_DIR)
  result.totalOnDisk = files.length

  if (files.length === 0) {
    logger.info('[HelpDocSync] No Markdown files found in help directory', {
      context: 'syncHelpDocs',
    })
    return result
  }

  const repos = getRepositories()

  for (const filePath of files) {
    try {
      const relPath = relative(process.cwd(), filePath)
      const rawContent = readFileSync(filePath, 'utf-8').trim()

      if (!rawContent) {
        continue
      }

      const contentHash = hashContent(rawContent)
      const { url, body } = parseFrontmatter(rawContent)
      const title = extractTitle(body, relPath)

      // Check if doc already exists with same content hash
      const existing = await repos.helpDocs.findByPath(relPath)

      if (existing && existing.contentHash === contentHash) {
        result.unchanged++
        continue
      }

      // Upsert the doc (preserves embedding field — we clear it separately below)
      const doc = await repos.helpDocs.upsertByPath(relPath, {
        title,
        path: relPath,
        url,
        content: body,
        contentHash,
      })

      // Content changed — clear the old embedding so it gets re-generated
      if (existing) {
        await repos.helpDocs.clearAllEmbeddingsForDoc(doc.id)
        result.updated++
      } else {
        result.created++
      }

      result.changedIds.push(doc.id)
    } catch (error) {
      result.failed++
      logger.error('[HelpDocSync] Failed to sync file', {
        context: 'syncHelpDocs',
        filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.info('[HelpDocSync] Sync completed', {
    context: 'syncHelpDocs',
    ...result,
    changedIds: result.changedIds.length,
  })

  return result
}

/**
 * Ensure help docs are synced (lazy initialization).
 *
 * Syncs when the help_docs collection is empty, and when a Markdown file on
 * disk has no row yet — otherwise a doc added after the first sync would never
 * reach the database, since this is the only sync trigger outside a full
 * embedding reindex. Detecting a new doc costs a directory scan, not a read of
 * every file; syncHelpDocs() itself skips unchanged docs by content hash.
 *
 * Edits to an already-synced doc are still picked up only by the next
 * syncHelpDocs() call. For a full re-sync, call it directly.
 */
let syncPromise: Promise<HelpDocSyncResult> | null = null

export async function ensureHelpDocsSynced(): Promise<void> {
  const repos = getRepositories()
  const existing = await repos.helpDocs.findAll()

  if (existing.length > 0 && !hasUnsyncedHelpDocs(existing)) {
    return
  }

  // Prevent concurrent syncs
  if (!syncPromise) {
    syncPromise = syncHelpDocs().finally(() => {
      syncPromise = null
    })
  }

  await syncPromise
}

/**
 * Whether any help document on disk is missing from the database.
 *
 * A doc that has been deleted from disk but still has a row is not sync-worthy
 * on its own — nothing here prunes rows.
 */
function hasUnsyncedHelpDocs(existing: { path: string }[]): boolean {
  const syncedPaths = new Set(existing.map(doc => doc.path))
  const unsynced = listHelpDocPathsOnDisk().filter(path => !syncedPaths.has(path))

  if (unsynced.length > 0) {
    logger.info('[HelpDocSync] Found help docs on disk with no database row', {
      context: 'ensureHelpDocsSynced',
      unsyncedCount: unsynced.length,
      unsynced,
    })
  }

  return unsynced.length > 0
}
