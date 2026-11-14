/**
 * Brahma Console attachments.
 *
 * Files and images attached to (or pasted into) a Console message are ordinary
 * documents in Quilltap General, kept flat under `Brahma/`. The mount-file
 * **link id** is the attachment's id everywhere — the message's
 * `attachments[]`, the composer's chips, the API — and `loadChatFilesForLLM`
 * already falls through from the legacy `files` table to `doc_mount_files` by
 * that id, so no `files` row is ever made.
 *
 * Attachments leave with their conversation (`deleteConsoleAttachmentsForChat`),
 * but only while they still sit directly under `Brahma/` in General: a file the
 * operator moved elsewhere has been claimed and is kept.
 *
 * Server only; every writer here runs in the parent process (the Console's
 * routes), like every caller of `storeMountFile`.
 *
 * @module lib/brahma-console/attachments
 */

import path from 'path'
import { createServiceLogger } from '@/lib/logging/create-logger'
import { getRepositories } from '@/lib/repositories/factory'
import { resolveOwnerStore } from '@/lib/mount-index/reach'
import { storeMountFile } from '@/lib/mount-index/store-file'
import { resolveInsideSync } from '@/lib/paths/resolve-inside'
import { sanitizeLeafName } from '@/lib/file-storage/bridge-path-helpers'
import { getGeneralMountPointId } from '@/lib/instance-settings'
import { deleteDocument } from '@/lib/documents/core'
import { resolveOperatorDocPath, STANDALONE_ACCESS_CONTEXT } from '@/lib/documents/operator-doc-actions'
import { docStoreUriFor } from '@/lib/doc-edit/uri-producers'
import { getMemoryTimeZone } from '@/lib/memory/time/calendar'
import { getErrorMessage } from '@/lib/error-utils'
import type { getRepositories as GetRepositories } from '@/lib/repositories/factory'

const logger = createServiceLogger('BrahmaConsoleAttachments')

/** The folder at the root of Quilltap General that holds Console attachments. */
export const BRAHMA_ATTACHMENT_FOLDER = 'Brahma'

type Repos = ReturnType<typeof GetRepositories>

/** An attachment as the Console's routes and composer see it. */
export interface ConsoleAttachment {
  /** The mount-file link id. */
  id: string
  filename: string
  mimeType: string
  size: number
  /** Path inside Quilltap General, e.g. `Brahma/photo.webp`. */
  path: string
  isImage: boolean
}

/** One message attachment resolved for rendering. */
export interface ConsoleAttachmentView {
  id: string
  filename: string
  mimeType: string
  isImage: boolean
  /** Path inside its store (null when missing). */
  path: string | null
  /** The store the link now lives in (null when missing). */
  mountPointId: string | null
  /** True when the link no longer exists. */
  missing: boolean
}

// ============================================================================
// Pure naming helpers (exported for tests)
// ============================================================================

/** True when a mime type is an image the store will transcode to WebP. */
function willTranscodeToWebp(mimeType: string): boolean {
  const m = mimeType.toLowerCase()
  return m.startsWith('image/') && m !== 'image/svg+xml' && m !== 'image/gif' && m !== 'image/webp'
}

/**
 * A filename reduced to one safe path segment: no separators, no leading
 * dots, no control or reserved characters.
 */
export function sanitizeAttachmentName(filename: string): string {
  return sanitizeLeafName(filename)
}

/**
 * The name a pasted image with no name of its own is given:
 * `pasted-YYYYMMDD-HHMMSS.<ext>` on the instance calendar.
 */
export function pastedAttachmentName(nowMs: number, timeZone: string, ext: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(nowMs))
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00'
  // Some engines render midnight as "24" under hour12: false.
  const hour = get('hour') === '24' ? '00' : get('hour')
  const cleanExt = ext.replace(/^\.+/, '') || 'png'
  return `pasted-${get('year')}${get('month')}${get('day')}-${hour}${get('minute')}${get('second')}.${cleanExt}`
}

/** Split `name.ext` into `{ stem, ext }` (ext includes the dot, or ''). */
function splitName(name: string): { stem: string; ext: string } {
  const ext = path.extname(name)
  return ext && ext !== name ? { stem: name.slice(0, -ext.length), ext } : { stem: name, ext: '' }
}

/**
 * The first free name in a flat folder: `name`, then `<stem>-2<ext>`,
 * `<stem>-3<ext>`, … compared case-insensitively against `taken`. When
 * `alsoExt` is given (the extension a transcode will give the stored file),
 * a candidate is taken if either spelling is.
 */
export function freeAttachmentName(name: string, taken: ReadonlySet<string>, alsoExt?: string): string {
  const lowered = new Set([...taken].map(t => t.toLowerCase()))
  const { stem, ext } = splitName(name)
  const isTaken = (candidateStem: string) =>
    lowered.has(`${candidateStem}${ext}`.toLowerCase()) ||
    (alsoExt !== undefined && lowered.has(`${candidateStem}${alsoExt}`.toLowerCase()))
  if (!isTaken(stem)) return `${stem}${ext}`
  for (let n = 2; n < 10_000; n++) {
    if (!isTaken(`${stem}-${n}`)) return `${stem}-${n}${ext}`
  }
  return `${stem}-${Date.now()}${ext}`
}

/** True when a General-relative path sits directly under `Brahma/`. */
export function isDirectlyUnderBrahma(relativePath: string): boolean {
  const normalised = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const prefix = `${BRAHMA_ATTACHMENT_FOLDER}/`
  if (!normalised.toLowerCase().startsWith(prefix.toLowerCase())) return false
  const rest = normalised.slice(prefix.length)
  return rest.length > 0 && !rest.includes('/')
}

// ============================================================================
// Store
// ============================================================================

/**
 * Store uploaded bytes at `Brahma/<free name>` in Quilltap General and return
 * the attachment (its id is the mount-file link id). Images are normalised by
 * the store-file chokepoint; the stored name follows the stored bytes (a
 * transcode may change the extension) and the link keeps `originalFileName`.
 */
export async function storeConsoleAttachment(input: {
  bytes: Buffer
  filename: string | null | undefined
  mimeType: string
  userId: string
  repos?: Repos
}): Promise<ConsoleAttachment> {
  const repos = input.repos ?? getRepositories()
  const general = await resolveOwnerStore('general', null, repos, input.userId, {
    ensure: { folder: BRAHMA_ATTACHMENT_FOLDER, onFolderFailure: 'swallow' },
    archived: 'allow',
    context: 'brahma-attachments',
  })
  if (!general) {
    throw new Error('Quilltap General is not available to hold the attachment')
  }

  const mimeType = input.mimeType || 'application/octet-stream'
  const rawName = input.filename?.trim()
  let baseName: string
  if (!rawName || rawName === 'image.png' || rawName === 'blob') {
    // A clipboard paste arrives nameless (or with the browser's stock name).
    const ext = mimeType.startsWith('image/') ? mimeType.slice('image/'.length).replace('jpeg', 'jpg').replace(/\+.*$/, '') : 'bin'
    baseName = pastedAttachmentName(Date.now(), getMemoryTimeZone(), ext)
  } else {
    baseName = sanitizeAttachmentName(rawName)
  }

  const taken = await listBrahmaNames(general.mountPointId)
  const transcodeExt = willTranscodeToWebp(mimeType) ? '.webp' : undefined
  const name = freeAttachmentName(baseName, taken, transcodeExt)

  // One segment, resolved inside the folder — never a string check.
  const relativePath = path.posix.join(
    BRAHMA_ATTACHMENT_FOLDER,
    path.basename(resolveInsideSync(`/${BRAHMA_ATTACHMENT_FOLDER}`, name, { allowBase: false })),
  )

  logger.debug('Storing Console attachment', {
    mountPointId: general.mountPointId,
    relativePath,
    mimeType,
    bytes: input.bytes.length,
  })

  const result = await storeMountFile({
    mountPointId: general.mountPointId,
    relativePath,
    data: input.bytes,
    originalMimeType: mimeType,
    originalFileName: rawName || name,
    // A concurrent upload aiming at the same free name gets a bumped one.
    collisionStrategy: 'unique-suffix',
    treatNativeTextAsDocument: false,
    extractText: true,
    enqueueEmbedding: true,
    assetStorage: 'database',
  })

  if (!result.linkId) {
    throw new Error('The attachment was stored without a link')
  }

  const attachment: ConsoleAttachment = {
    id: result.linkId,
    filename: path.posix.basename(result.relativePath),
    mimeType: result.storedMimeType,
    size: result.sizeBytes,
    path: result.relativePath,
    isImage: result.storedMimeType.startsWith('image/'),
  }
  logger.info('Console attachment stored', { linkId: attachment.id, path: attachment.path })
  return attachment
}

/** Names already in `Brahma/` (flat), for de-duplication. */
async function listBrahmaNames(mountPointId: string): Promise<Set<string>> {
  const repos = getRepositories()
  const names = new Set<string>()
  try {
    const entries = await repos.docMountFileLinks.listForBrowser(mountPointId)
    for (const entry of entries) {
      if (isDirectlyUnderBrahma(entry.relativePath)) {
        names.add(path.posix.basename(entry.relativePath))
      }
    }
  } catch (error) {
    logger.warn('Could not list Brahma/ for de-duplication; relying on the store', {
      mountPointId,
      error: getErrorMessage(error),
    })
  }
  return names
}

// ============================================================================
// Lookup
// ============================================================================

/**
 * The link for an attachment id, when it still lives directly under
 * `Brahma/` in Quilltap General; null otherwise.
 */
export async function findConsoleAttachmentLink(linkId: string, repos: Repos = getRepositories()) {
  const generalId = await getGeneralMountPointId()
  if (!generalId) return null
  const link = await repos.docMountFileLinks.findByIdWithContent(linkId)
  if (!link) return null
  if (link.mountPointId !== generalId || !isDirectlyUnderBrahma(link.relativePath)) return null
  return link
}

/** The `qtap://` address of an attachment, naming the store (never `self`). */
export async function consoleAttachmentUri(link: { mountPointId: string; relativePath: string }): Promise<string> {
  const repos = getRepositories()
  const mp = await repos.docMountPoints.findById(link.mountPointId)
  return docStoreUriFor({
    mountPointId: link.mountPointId,
    mountPointName: mp?.name ?? '',
    relativePath: link.relativePath,
  })
}

/** Resolve message attachment ids for rendering (missing ones flagged). */
export async function describeConsoleAttachments(
  ids: readonly string[],
  repos: Repos = getRepositories(),
): Promise<Map<string, ConsoleAttachmentView>> {
  const out = new Map<string, ConsoleAttachmentView>()
  if (ids.length === 0) return out
  const unique = [...new Set(ids)]
  const links = await repos.docMountFileLinks.findByIdsWithContent(unique)
  const byId = new Map(links.map(l => [l.id, l]))
  for (const id of unique) {
    const link = byId.get(id)
    if (!link) {
      out.set(id, { id, filename: 'Missing file', mimeType: 'application/octet-stream', isImage: false, path: null, mountPointId: null, missing: true })
      continue
    }
    const mimeType = link.originalMimeType && !link.fileName.toLowerCase().endsWith('.webp')
      ? link.originalMimeType
      : mimeFromName(link.fileName, link.originalMimeType)
    out.set(id, {
      id,
      filename: link.fileName,
      mimeType,
      isImage: mimeType.startsWith('image/'),
      path: link.relativePath,
      mountPointId: link.mountPointId,
      missing: false,
    })
  }
  return out
}

function mimeFromName(name: string, fallback: string | null | undefined): string {
  const ext = path.extname(name).toLowerCase()
  const table: Record<string, string> = {
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  }
  return table[ext] ?? fallback ?? 'application/octet-stream'
}

// ============================================================================
// Delete
// ============================================================================

/**
 * Delete one attachment if its link still lives directly under `Brahma/` in
 * Quilltap General. A file the operator moved is theirs and is kept.
 */
export async function discardConsoleAttachment(
  linkId: string,
  repos: Repos = getRepositories(),
): Promise<'deleted' | 'kept-moved' | 'missing'> {
  const link = await repos.docMountFileLinks.findByIdWithContent(linkId)
  if (!link) {
    logger.debug('discardConsoleAttachment: link already gone', { linkId })
    return 'missing'
  }
  const generalId = await getGeneralMountPointId()
  if (!generalId || link.mountPointId !== generalId || !isDirectlyUnderBrahma(link.relativePath)) {
    logger.debug('discardConsoleAttachment: kept (moved out of Brahma/)', {
      linkId,
      mountPointId: link.mountPointId,
      relativePath: link.relativePath,
    })
    return 'kept-moved'
  }
  // Resolve by the store's name: the doc resolver's `general` scope is the
  // legacy on-disk `_general` folder, not the Quilltap General store.
  const store = await repos.docMountPoints.findById(link.mountPointId)
  if (!store) {
    logger.warn('discardConsoleAttachment: Quilltap General store row missing', { linkId, mountPointId: link.mountPointId })
    return 'missing'
  }
  const resolved = await resolveOperatorDocPath(STANDALONE_ACCESS_CONTEXT, {
    scope: 'document_store',
    mountPoint: store.name,
    filePath: link.relativePath,
  })
  const outcome = await deleteDocument(resolved)
  logger.debug('discardConsoleAttachment: delete attempted', { linkId, relativePath: link.relativePath, outcome })
  if (outcome !== 'deleted') {
    logger.warn('discardConsoleAttachment: nothing deleted at the attachment path', { linkId, relativePath: link.relativePath, outcome })
  }
  return outcome === 'deleted' ? 'deleted' : 'missing'
}

/** Every attachment id named by a chat's messages, in order, de-duplicated. */
export function collectAttachmentIds(
  messages: ReadonlyArray<{ type?: string; attachments?: string[] | null }>,
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const m of messages) {
    if (m.type !== undefined && m.type !== 'message') continue
    for (const id of m.attachments ?? []) {
      if (typeof id === 'string' && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
  }
  return ids
}

/**
 * Delete every attachment of a chat's messages that still lives directly
 * under `Brahma/` in Quilltap General. Failures are logged and counted as
 * kept; they never block the chat's own deletion.
 */
export async function deleteConsoleAttachmentsForChat(
  repos: Repos,
  chatId: string,
): Promise<{ deleted: number; kept: number }> {
  let deleted = 0
  let kept = 0
  let ids: string[] = []
  try {
    ids = collectAttachmentIds(await repos.chats.getMessages(chatId))
  } catch (error) {
    logger.warn('deleteConsoleAttachmentsForChat: could not read the transcript', {
      chatId,
      error: getErrorMessage(error),
    })
    return { deleted, kept }
  }
  for (const id of ids) {
    try {
      const outcome = await discardConsoleAttachment(id, repos)
      if (outcome === 'deleted') deleted++
      else if (outcome === 'kept-moved') kept++
    } catch (error) {
      kept++
      logger.warn('deleteConsoleAttachmentsForChat: could not delete an attachment', {
        chatId,
        linkId: id,
        error: getErrorMessage(error),
      })
    }
  }
  logger.debug('deleteConsoleAttachmentsForChat: done', { chatId, attachments: ids.length, deleted, kept })
  return { deleted, kept }
}
