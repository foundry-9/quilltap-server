/**
 * The research kit's document tools (research kit §5.3–§5.4):
 *
 *  - `findDocuments` — files across the scope by what they say, what they are
 *    called, or both; one hit per distinct file, ranked, with the matching
 *    lines; a miss says what was searched and offers the nearest names.
 *  - `listDocuments` — the stores in scope, or what one store or folder holds,
 *    with big and binary folders collapsed to one line.
 *
 * Candidates come from one SQL scan (`DocMountFileLinksRepository.
 * scanForResearch`), filtered to the scope's mounts; matching and snippets run
 * here, on the candidates only. A filesystem-backed file's text is read
 * through the document core (`readDocument`, via `resolveDocEditPath`). Under
 * a `pool` scope the per-document policy `doc_grep` applies is applied
 * (`getCharacterBlockedReadPaths`); under `everything` the operator is
 * unrestricted.
 *
 * Results name stores and carry `qtap://` URIs from the URI producers, never
 * a bare mount id and never `self`.
 *
 * @module lib/research/documents
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getRepositories } from '@/lib/repositories/factory'
import type { AccessibleMountPoint } from '@/lib/doc-edit/path-resolver'
import { resolveDocEditPath, isTextFile } from '@/lib/doc-edit/path-resolver'
import { buildDocStoreUriResolver } from '@/lib/doc-edit/uri-producers'
import { readDocument } from '@/lib/documents/core'
import { getCharacterBlockedReadPaths } from '@/lib/tools/handlers/doc-edit/shared'
import type { DocMountResearchRow } from '@/lib/database/repositories/doc-mount-file-links.repository'
import {
  clipLine,
  containsAll,
  dateOf,
  foldName,
  foldedMatches,
  joinUnderCeiling,
  nameMatches,
  nearestByName,
  searchTerms,
} from './text'
import { resolveStoreArg, storesInScope, withOwners, type ResearchScope } from './scope'
import { inFolder, outlineRows, storeAddress } from './outline'

export { COLLAPSE_FOLDER_OVER, BINARY_FOLDERS, outlineRows, storeOutline } from './outline'

const logger = createServiceLogger('ResearchDocuments')

/** Most filesystem-backed files read from disk in one search. */
const MAX_DISK_READS = 400
/** Matching lines shown per hit. */
const SNIPPETS_PER_HIT = 3
export interface FindDocumentsQuery {
  text?: string
  name?: string
  store?: string
  folder?: string
  modified_since?: string
  limit?: number
}

export interface DocumentHit {
  storeName: string
  mountPointId: string
  path: string
  uri: string
  modifiedAt: string
  sizeBytes: number
  matchCount: number
  snippets: string[]
  alsoInStores: number
  fileId: string
}

export type ResearchOutcome<T> =
  | { ok: true; text: string; data: T }
  | { ok: false; error: string }

/** Normalize a folder argument: no leading or trailing slash. */
function normalizeFolder(folder: string | undefined): string {
  return (folder ?? '').replace(/^\/+|\/+$/g, '').trim()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The stores to search: one named store, or every store in scope. */
async function targetStores(
  scope: ResearchScope,
  storeRef: string | undefined,
  userId: string,
): Promise<{ ok: true; stores: AccessibleMountPoint[] } | { ok: false; error: string }> {
  if (storeRef && storeRef.trim()) {
    const resolved = await resolveStoreArg(scope, storeRef, userId)
    return resolved.ok ? { ok: true, stores: [resolved.store] } : resolved
  }
  return { ok: true, stores: await storesInScope(scope) }
}

/** Paths a pool scope may not read (character_read:false), per store. */
async function blockedPathsFor(
  scope: ResearchScope,
  stores: AccessibleMountPoint[],
  userId: string,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  if (scope.kind === 'everything') return out
  for (const store of stores) {
    const blocked = await getCharacterBlockedReadPaths(store.id, {
      chatId: '',
      userId,
      mountPool: scope.pool,
    })
    if (blocked.size > 0) out.set(store.id, blocked)
  }
  return out
}

/** A filesystem-backed file's text, through the path resolver and the document core. */
async function readFromDisk(scope: ResearchScope, store: AccessibleMountPoint, relativePath: string): Promise<string | null> {
  try {
    const resolved = await resolveDocEditPath('document_store', relativePath, {
      mountPoint: store.id,
      ...(scope.kind === 'everything' ? { operatorOverride: true } : { mountPool: scope.pool }),
    })
    const read = await readDocument(resolved)
    return read.content
  } catch (error) {
    logger.debug('find_documents: could not read a filesystem-backed file', {
      mountPointId: store.id,
      relativePath,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Up to `SNIPPETS_PER_HIT` matching lines, each with the next non-empty line as context. */
function snippetsFor(content: string, terms: readonly string[]): { count: number; snippets: string[] } {
  const lines = content.split('\n')
  const lineStarts: number[] = []
  let at = 0
  for (const line of lines) {
    lineStarts.push(at)
    at += line.length + 1
  }
  const lineOf = (index: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  let count = 0
  const hitLines = new Set<number>()
  for (const term of terms) {
    for (const match of foldedMatches(content, term)) {
      count++
      hitLines.add(lineOf(match.index))
    }
  }
  const snippets: string[] = []
  for (const lineIdx of [...hitLines].sort((a, b) => a - b)) {
    if (snippets.length >= SNIPPETS_PER_HIT) break
    let text = `L${lineIdx + 1}: ${clipLine(lines[lineIdx], 240)}`
    const next = lines.slice(lineIdx + 1).find((l) => l.trim().length > 0)
    if (next !== undefined && !hitLines.has(lines.indexOf(next, lineIdx + 1))) {
      text += `\n      ${clipLine(next, 160)}`
    }
    snippets.push(text)
  }
  return { count, snippets }
}

/**
 * `find_documents`: files across the scope by content, name or both.
 */
export async function findDocuments(
  scope: ResearchScope,
  query: FindDocumentsQuery,
  ctx: { userId: string },
): Promise<ResearchOutcome<{ hits: DocumentHit[]; total: number }>> {
  const text = query.text?.trim() ?? ''
  const name = query.name?.trim() ?? ''
  if (!text && !name) return { ok: false, error: 'find_documents needs `text`, `name`, or both.' }
  const limit = Math.min(Math.max(query.limit ?? 10, 1), 30)
  const folder = normalizeFolder(query.folder)

  const target = await targetStores(scope, query.store, ctx.userId)
  if (!target.ok) return target
  const stores = target.stores
  const storeById = new Map(stores.map((s) => [s.id, s]))

  const repos = getRepositories()
  const rows = await repos.docMountFileLinks.scanForResearch(
    stores.map((s) => s.id),
    { modifiedSince: query.modified_since, withText: !!text },
  )
  const blocked = await blockedPathsFor(scope, stores, ctx.userId)

  const terms = text ? searchTerms(text) : []
  const nameWords = name ? name.split(/\s+/).filter(Boolean) : []

  const visible = rows.filter((row) =>
    inFolder(row.relativePath, folder) && !blocked.get(row.mountPointId)?.has(row.relativePath.toLowerCase()),
  )

  // Name filter first (cheap), then content.
  const byName = nameWords.length > 0 ? visible.filter((row) => nameMatches(row.relativePath, nameWords)) : visible

  type Candidate = { row: DocMountResearchRow; count: number; snippets: string[] }
  const matched: Candidate[] = []
  let diskReads = 0
  for (const row of byName) {
    if (!text) {
      matched.push({ row, count: 1, snippets: [] })
      continue
    }
    let content = row.text
    if (content == null) {
      const store = storeById.get(row.mountPointId)
      if (!store || store.mountType === 'database' || !isTextFile(row.relativePath)) continue
      if (diskReads >= MAX_DISK_READS) continue
      diskReads++
      content = await readFromDisk(scope, store, row.relativePath)
      if (content == null) continue
    }
    if (!containsAll(content, terms)) continue
    const { count, snippets } = snippetsFor(content, terms)
    matched.push({ row, count, snippets })
  }

  // One hit per distinct file; the others count as "also in N other stores".
  const byFile = new Map<string, { best: Candidate; stores: Set<string> }>()
  for (const candidate of matched) {
    const entry = byFile.get(candidate.row.fileId)
    if (!entry) {
      byFile.set(candidate.row.fileId, { best: candidate, stores: new Set([candidate.row.mountPointId]) })
    } else {
      entry.stores.add(candidate.row.mountPointId)
    }
  }
  const ranked = [...byFile.values()].sort(
    (a, b) => b.best.count - a.best.count || (b.best.row.lastModified ?? '').localeCompare(a.best.row.lastModified ?? ''),
  )

  const uriResolver = await buildDocStoreUriResolver()
  const hits: DocumentHit[] = ranked.slice(0, limit).map(({ best, stores: inStores }) => {
    const store = storeById.get(best.row.mountPointId)
    const storeName = store?.name ?? 'Unknown store'
    return {
      storeName,
      mountPointId: best.row.mountPointId,
      path: best.row.relativePath,
      uri: uriResolver.uriForMount(storeName, best.row.mountPointId, best.row.relativePath),
      modifiedAt: best.row.lastModified,
      sizeBytes: best.row.fileSizeBytes,
      matchCount: best.count,
      snippets: best.snippets,
      alsoInStores: inStores.size - 1,
      fileId: best.row.fileId,
    }
  })

  logger.debug('find_documents completed', {
    scope: scope.kind,
    stores: stores.length,
    scanned: rows.length,
    matchedLinks: matched.length,
    distinctFiles: ranked.length,
    returned: hits.length,
    diskReads,
    hasText: !!text,
    hasName: !!name,
  })

  const searched = describeSearch({ text, name, folder, since: query.modified_since })
  const where = stores.length === 1 ? `"${stores[0].name}"` : `${stores.length} stores`

  if (hits.length === 0) {
    const nearestSource = name || text
    const nearest = nearestByName(
      nearestSource,
      visible.map((row) => row.relativePath),
      3,
    )
    const nearestLine = nearest.length > 0 ? ` Nearest by name: ${nearest.map((p) => `"${p}"`).join(', ')}.` : ''
    return {
      ok: true,
      text: `No file in ${where} ${searched}.${nearestLine} If it is not found, it is not in the stores; do not retry with small spelling changes.`,
      data: { hits: [], total: 0 },
    }
  }

  const head = `${hits.length} of ${ranked.length} file${ranked.length === 1 ? '' : 's'} in ${where} ${searched}${ranked.length > hits.length ? '; narrow with `store`, `folder` or more words' : ''}:`
  const records = hits.map((hit, i) => {
    const also = hit.alsoInStores > 0 ? ` — also in ${hit.alsoInStores} other store${hit.alsoInStores === 1 ? '' : 's'}` : ''
    const matchesLabel = text ? `${hit.matchCount} match${hit.matchCount === 1 ? '' : 'es'}, ` : ''
    const lines = [
      `${i + 1}. ${hit.storeName} › ${hit.path} (${matchesLabel}modified ${dateOf(hit.modifiedAt)}, ${formatSize(hit.sizeBytes)})${also}`,
      `   ${hit.uri}`,
      ...hit.snippets.map((s) => `   ${s}`),
    ]
    return lines.join('\n')
  })
  return {
    ok: true,
    text: joinUnderCeiling(head, records, {
      tail: 'Read a file in full with doc_read_file on its URI.',
      omittedHint: (n) => `[${n} more hit${n === 1 ? '' : 's'} left out for length; lower \`limit\` or narrow with \`store\` or \`folder\` to see them.]`,
    }),
    data: { hits, total: ranked.length },
  }
}

function describeSearch(q: { text: string; name: string; folder: string; since?: string }): string {
  const parts: string[] = []
  if (q.text) parts.push(`containing ${JSON.stringify(q.text)}`)
  if (q.name) parts.push(`named like ${JSON.stringify(q.name)}`)
  if (q.folder) parts.push(`under ${q.folder}/`)
  if (q.since) parts.push(`changed since ${q.since}`)
  return parts.join(', ')
}

// ============================================================================
// list_documents
// ============================================================================

export interface ListDocumentsQuery {
  store?: string
  folder?: string
  depth?: number
}

/**
 * `list_documents`: the stores in scope (no `store`), or a store's or
 * folder's outline.
 */
export async function listDocuments(
  scope: ResearchScope,
  query: ListDocumentsQuery,
  ctx: { userId: string },
): Promise<ResearchOutcome<{ storeCount?: number; fileCount?: number }>> {
  const repos = getRepositories()
  const depth = Math.min(Math.max(query.depth ?? 2, 1), 5)

  if (!query.store || !query.store.trim()) {
    const stores = await withOwners(await storesInScope(scope))
    const rows = await repos.docMountFileLinks.scanForResearch(stores.map((s) => s.id), { withText: false })
    const stats = new Map<string, { count: number; newest: string }>()
    for (const row of rows) {
      const stat = stats.get(row.mountPointId) ?? { count: 0, newest: '' }
      stat.count++
      if (row.lastModified > stat.newest) stat.newest = row.lastModified
      stats.set(row.mountPointId, stat)
    }
    const ordered = [...stores].sort((a, b) => a.name.localeCompare(b.name))
    const records = ordered.map((store) => {
      const stat = stats.get(store.id) ?? { count: 0, newest: '' }
      const owner = store.owner ? `${store.owner.scope}: ${store.owner.name}` : 'linked store'
      return `- ${store.name} (${owner}; ${stat.count} file${stat.count === 1 ? '' : 's'}${stat.newest ? `, last modified ${dateOf(stat.newest)}` : ''})`
    })
    logger.debug('list_documents: stores in scope', { scope: scope.kind, stores: stores.length, links: rows.length })
    return {
      ok: true,
      text: joinUnderCeiling(`${stores.length} store${stores.length === 1 ? '' : 's'} in reach:`, records, {
        ceiling: 9000,
        tail: 'List one with `store`; search them all with find_documents.',
        separator: '\n',
        omittedHint: (n) => `[${n} more stores left out for length; use find_documents, or name one with \`store\`.]`,
      }),
      data: { storeCount: stores.length },
    }
  }

  const resolved = await resolveStoreArg(scope, query.store, ctx.userId)
  if (!resolved.ok) return resolved
  const store = resolved.store
  const folder = normalizeFolder(query.folder)
  const blocked = await blockedPathsFor(scope, [store], ctx.userId)
  const rows = (await repos.docMountFileLinks.scanForResearch([store.id], { withText: false })).filter(
    (row) => !blocked.get(store.id)?.has(row.relativePath.toLowerCase()),
  )
  const inside = rows.filter((row) => inFolder(row.relativePath, folder))
  if (inside.length === 0) {
    const folders = [...new Set(rows.map((r) => r.relativePath.split('/').slice(0, -1).join('/')).filter(Boolean))]
    const nearest = folder ? nearestByName(folder, folders, 3) : []
    return {
      ok: true,
      text: folder
        ? `No files under ${folder}/ in "${store.name}".${nearest.length > 0 ? ` Nearest folders: ${nearest.map((f) => `"${f}"`).join(', ')}.` : ''}`
        : `"${store.name}" holds no files.`,
      data: { fileCount: 0 },
    }
  }
  const lines = outlineRows(rows, folder, depth)
  logger.debug('list_documents: outline', { mountPointId: store.id, folder, depth, files: inside.length, lines: lines.length })
  const head = `"${store.name}"${folder ? ` › ${folder}/` : ''} — ${inside.length} file${inside.length === 1 ? '' : 's'} (read one at ${storeAddress(store)}<path>):`
  const body = joinUnderCeiling(head, lines, {
    tail: 'Expand a collapsed folder with `folder`; read a file with doc_read_file.',
    separator: '\n',
    omittedHint: (n) => `[${n} more lines left out for length; list a folder with \`folder\` to see them.]`,
  })
  return { ok: true, text: body, data: { fileCount: inside.length } }
}
