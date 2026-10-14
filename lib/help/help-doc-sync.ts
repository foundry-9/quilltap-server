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
import { createHash, randomUUID } from 'node:crypto'
import { getRepositories } from '@/lib/repositories/factory'
import { buildHelpDocChunks } from '@/lib/help/help-doc-chunking'
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
  /** Docs deleted (row in the database, file gone from disk) */
  deleted: number
  /** Docs that failed to sync */
  failed: number
  /** Section chunk rows written across every created/updated doc */
  chunksWritten: number
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
 * Parse YAML frontmatter from Markdown content
 */
export function parseFrontmatter(content: string): { url: string; body: string } {
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
export function extractTitle(content: string, filePath: string): string {
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
 * and upserts into the help_docs collection. Rows whose file has been
 * deleted from disk are pruned. Returns info about which docs changed
 * (need re-embedding).
 *
 * Enqueues nothing — embedding is the caller's business, because the two
 * callers want different things: EMBEDDING_REINDEX_ALL re-embeds every doc
 * regardless of what changed, while {@link reconcileHelpDocs} queues only
 * the docs left incomplete.
 *
 * @returns Sync result with counts and changed doc IDs
 */
export async function syncHelpDocs(): Promise<HelpDocSyncResult> {
  const result: HelpDocSyncResult = {
    totalOnDisk: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    failed: 0,
    chunksWritten: 0,
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

  // One read of the table, indexed by path. The prune below needs every row
  // anyway, and it doubles as the per-file lookup — the alternative is a
  // findByPath per file, which is ~115 queries on every sync.
  const existingDocs = await repos.helpDocs.findAll()
  const existingByPath = new Map(existingDocs.map(doc => [doc.path, doc]))
  const pathsOnDisk = new Set<string>()

  for (const filePath of files) {
    try {
      const relPath = relative(process.cwd(), filePath)
      const rawContent = readFileSync(filePath, 'utf-8').trim()

      if (!rawContent) {
        continue
      }

      pathsOnDisk.add(relPath)

      const contentHash = hashContent(rawContent)
      const { url, body } = parseFrontmatter(rawContent)
      const title = extractTitle(body, relPath)

      const existing = existingByPath.get(relPath)

      if (existing && existing.contentHash === contentHash) {
        result.unchanged++
        continue
      }

      // The chunk rows below are keyed to this id, so it must be the id the
      // row really has — never one handed back by a write. Inside the job
      // child (EMBEDDING_REINDEX_ALL) writes are buffered and return a
      // synthetic result: `upsertByPath` came back with a random UUID, the
      // parent's replay updated the real row, and every chunk insert failed
      // its foreign key, rolling back the whole reindex batch (bug 167). An
      // existing row's id is already in hand; a new row's id is minted here and
      // passed to `create`, which both the child proxy and the repository honour.
      const fields = { title, path: relPath, url, content: body, contentHash }
      let docId: string
      if (existing) {
        // Preserves the embedding field — we clear it separately below
        await repos.helpDocs.update(existing.id, fields)
        docId = existing.id
      } else {
        docId = randomUUID()
        await repos.helpDocs.create(fields, { id: docId })
      }

      // Re-slice the doc into section chunks. Boundaries move whenever the
      // prose above them changes, so the old rows are discarded wholesale
      // rather than diffed; their embeddings are filled by the HELP_DOC
      // embedding job that the caller enqueues for this doc.
      const chunks = buildHelpDocChunks(body)
      await repos.helpDocChunks.replaceForDoc(docId, chunks)
      result.chunksWritten += chunks.length

      // Content changed — clear the old embedding so it gets re-generated
      if (existing) {
        await repos.helpDocs.clearAllEmbeddingsForDoc(docId)
        // A FAILED status belongs to the old text. Left in place it would keep
        // the new text out of a partial reindex, which skips failed entities —
        // a page that once overflowed the provider stayed unembedded after it
        // was fixed (bug 168).
        await repos.embeddingStatus.deleteByEntity('HELP_DOC', docId)
        result.updated++
      } else {
        result.created++
      }

      logger.debug('[HelpDocSync] Synced help doc', {
        context: 'syncHelpDocs',
        path: relPath,
        docId,
        action: existing ? 'updated' : 'created',
        chunks: chunks.length,
      })

      result.changedIds.push(docId)
    } catch (error) {
      result.failed++
      logger.error('[HelpDocSync] Failed to sync file', {
        context: 'syncHelpDocs',
        filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Refuse the destructive prune when NOTHING on disk parsed to usable content
  // yet the table is populated. `pathsOnDisk` holds exactly the docs that
  // survived the `if (!rawContent) continue` guard above — i.e. every file with
  // usable (non-whitespace) content. The `files.length === 0` early return only
  // covers a literally empty directory; a directory whose only `.md` is
  // whitespace-only slips past it (`totalOnDisk 1`) but produces no usable
  // content, and the prune below would then delete every row (measured:
  // `deleted 3, rows left 0`). An all-empty help set on disk against a
  // populated table is suspicious — an interrupted checkout, a half-written
  // file — not an instruction to wipe the Guide. Skip the prune and leave the
  // rows in place; the next healthy sync reconciles them.
  if (pathsOnDisk.size === 0 && existingDocs.length > 0) {
    logger.warn(
      '[HelpDocSync] No help docs on disk have usable content but the table is populated — skipping the destructive prune',
      {
        context: 'syncHelpDocs',
        totalOnDisk: result.totalOnDisk,
        existingRows: existingDocs.length,
      },
    )
  } else {
    // Prune rows whose file is gone from disk. Only reached once we know the
    // help directory exists and produced at least one file with usable content,
    // so a missing/unreadable/blank help/ can never empty the table.
    for (const doc of existingDocs) {
      if (pathsOnDisk.has(doc.path)) {
        continue
      }

      try {
        await repos.helpDocChunks.deleteByDocId(doc.id)
        await repos.helpDocs.delete(doc.id)
        await repos.embeddingStatus.deleteByEntity('HELP_DOC', doc.id)
        result.deleted++
      } catch (error) {
        result.failed++
        logger.error('[HelpDocSync] Failed to prune deleted help doc', {
          context: 'syncHelpDocs',
          docId: doc.id,
          path: doc.path,
          error: error instanceof Error ? error.message : String(error),
        })
      }
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
 * Result of a help doc reconcile: the sync's tallies plus what it found
 * incomplete and queued for embedding.
 */
export interface HelpDocReconcileResult {
  sync: HelpDocSyncResult
  /** Docs with no section rows, sliced by this pass */
  sectionsBackfilled: number
  /** Docs missing their own vector or any section vector */
  incomplete: number
}

/**
 * Bring the help index in line with the help files on disk, and queue the
 * embedding work that leaves it complete.
 *
 * Runs at every startup (instrumentation Phase 3.66) and is the only help
 * reconcile: {@link ensureHelpDocsSynced} shares the same once-per-process
 * run. The steps are cheap when nothing changed — every file is read and
 * hashed, and the index is checked with one row read of `help_docs` and one
 * GROUP BY over `help_doc_chunks` — so a full content comparison is affordable
 * on every boot. Before this, only a change in the *set* of file names
 * triggered a sync, and an edited page stayed stale until a full reindex.
 *
 * 1. {@link syncHelpDocs}: new files are created, edited files are rewritten
 *    and re-sliced with their vectors and failure status cleared, and rows
 *    whose file is gone are pruned.
 * 2. Any doc with no section rows is sliced now. (An instance whose reindex
 *    was rolled back by bug 167 has an empty section table.)
 * 3. A HELP_DOC embedding job is queued for every doc that lacks its own
 *    vector or has any section without one. The job reuses section vectors
 *    that already exist, so only what is missing costs a provider call.
 *
 * Must run in the parent process — its writes are immediate, and the ids it
 * hands to section rows are ones it has read or minted itself.
 */
export async function reconcileHelpDocs(): Promise<HelpDocReconcileResult> {
  const sync = await syncHelpDocs()
  const repos = getRepositories()

  const docs = await repos.helpDocs.findAll()
  const sectionCounts = await repos.helpDocChunks.countByDoc()

  let sectionsBackfilled = 0
  const incompleteIds: string[] = []

  for (const doc of docs) {
    let counts = sectionCounts.get(doc.id)

    if (!counts) {
      const chunks = buildHelpDocChunks(doc.content)
      if (chunks.length > 0) {
        await repos.helpDocChunks.replaceForDoc(doc.id, chunks)
        sectionsBackfilled++
        counts = { total: chunks.length, embedded: 0 }
      }
    }

    const docVectorMissing = doc.embedding == null || doc.embedding.length === 0
    const sectionVectorMissing = counts !== undefined && counts.embedded < counts.total
    if (docVectorMissing || sectionVectorMissing) {
      incompleteIds.push(doc.id)
    }
  }

  logger.info('[HelpDocSync] Help docs reconciled', {
    context: 'reconcileHelpDocs',
    created: sync.created,
    updated: sync.updated,
    deleted: sync.deleted,
    unchanged: sync.unchanged,
    sectionsBackfilled,
    incomplete: incompleteIds.length,
  })

  await enqueueHelpDocEmbeddings(incompleteIds)

  return { sync, sectionsBackfilled, incomplete: incompleteIds.length }
}

let reconcilePromise: Promise<HelpDocReconcileResult> | null = null

/**
 * Wait for this process's help reconcile, starting it if nothing has.
 *
 * Startup kicks the reconcile off; a help search that arrives first (or in a
 * process where startup did not run it) starts it here instead. Either way it
 * runs once per process. A failed run is forgotten so the next caller retries,
 * and never throws to the caller — help still loads from whatever the table
 * holds.
 */
export async function ensureHelpDocsSynced(): Promise<void> {
  if (!reconcilePromise) {
    reconcilePromise = reconcileHelpDocs().catch(error => {
      reconcilePromise = null
      throw error
    })
  }

  try {
    await reconcilePromise
  } catch (error) {
    logger.warn('[HelpDocSync] Help doc reconcile failed; serving help from the existing index', {
      context: 'ensureHelpDocsSynced',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Enqueue a HELP_DOC embedding job for each of `docIds`, resolving the default
 * embedding profile and the single user. Silent when either is unavailable —
 * an instance with no embedding profile configured simply has no semantic help
 * search yet, which is not an error worth shouting about on every boot.
 */
async function enqueueHelpDocEmbeddings(docIds: string[]): Promise<void> {
  try {
    const repos = getRepositories()

    if (docIds.length === 0) {
      return
    }

    const profiles = await repos.embeddingProfiles.findAll()
    const defaultProfile = profiles.find(p => p.isDefault) || profiles[0]
    if (!defaultProfile) {
      logger.debug('[HelpDocSync] Help docs need embedding but no embedding profile is configured', {
        context: 'enqueueHelpDocEmbeddings',
        needEmbedding: docIds.length,
      })
      return
    }

    const users = await repos.users.findAll()
    const userId = users[0]?.id
    if (!userId) {
      return
    }

    const { enqueueEmbeddingGenerate } = await import('@/lib/background-jobs/queue-service')

    let enqueued = 0
    for (const docId of docIds) {
      const { isNew } = await enqueueEmbeddingGenerate(userId, {
        entityType: 'HELP_DOC',
        entityId: docId,
        profileId: defaultProfile.id,
      })
      if (isNew) enqueued++
    }

    logger.info('[HelpDocSync] Enqueued help doc embeddings', {
      context: 'enqueueHelpDocEmbeddings',
      enqueued,
      needEmbedding: docIds.length,
    })
  } catch (error) {
    // Embedding top-up is best-effort: the docs are already in the database
    // and listable in the Guide, which is the caller's actual dependency.
    logger.error('[HelpDocSync] Failed to enqueue help doc embeddings', {
      context: 'enqueueHelpDocEmbeddings',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
