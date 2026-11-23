/**
 * Brahma Console attachments — the shared console rules
 * (`lib/console-engine/attachments.ts`) bound to Brahma's folder.
 *
 * Files and images attached to (or pasted into) a Console message are ordinary
 * documents in Quilltap General, kept flat under `Brahma/`. They leave with
 * their conversation while they still sit directly under `Brahma/`; a file the
 * operator moved elsewhere has been claimed and is kept. Nothing here is a
 * rule of its own: every function names the folder and delegates.
 *
 * Server only.
 *
 * @module lib/brahma-console/attachments
 */

import type { getRepositories } from '@/lib/repositories/factory'
import {
  CONSOLE_ATTACHMENT_FOLDERS,
  deleteConsoleAttachmentsForChat as deleteForChat,
  discardConsoleAttachment as discardInFolder,
  findConsoleAttachmentLink as findInFolder,
  isDirectlyUnderFolder,
  storeConsoleAttachment as storeInFolder,
  type ConsoleAttachment,
} from '@/lib/console-engine/attachments'

export {
  collectAttachmentIds,
  consoleAttachmentUri,
  describeConsoleAttachments,
  freeAttachmentName,
  pastedAttachmentName,
  sanitizeAttachmentName,
  type ConsoleAttachment,
  type ConsoleAttachmentView,
} from '@/lib/console-engine/attachments'

type Repos = ReturnType<typeof getRepositories>

/** The folder at the root of Quilltap General that holds Console attachments. */
export const BRAHMA_ATTACHMENT_FOLDER = CONSOLE_ATTACHMENT_FOLDERS.brahma

/** True when a General-relative path sits directly under `Brahma/`. */
export function isDirectlyUnderBrahma(relativePath: string): boolean {
  return isDirectlyUnderFolder(BRAHMA_ATTACHMENT_FOLDER, relativePath)
}

/** Store uploaded bytes at `Brahma/<free name>` in Quilltap General. */
export function storeConsoleAttachment(input: {
  bytes: Buffer
  filename: string | null | undefined
  mimeType: string
  userId: string
  repos?: Repos
}): Promise<ConsoleAttachment> {
  return storeInFolder({ ...input, folder: BRAHMA_ATTACHMENT_FOLDER })
}

/** The link for an attachment id while it still lives directly under `Brahma/`; null otherwise. */
export function findConsoleAttachmentLink(linkId: string, repos?: Repos) {
  return findInFolder(BRAHMA_ATTACHMENT_FOLDER, linkId, repos)
}

/** Delete one attachment if it still lives directly under `Brahma/`. */
export function discardConsoleAttachment(linkId: string, repos?: Repos): Promise<'deleted' | 'kept-moved' | 'missing'> {
  return discardInFolder(BRAHMA_ATTACHMENT_FOLDER, linkId, repos)
}

/** Delete every attachment of a Brahma chat that still lives directly under `Brahma/`. */
export function deleteConsoleAttachmentsForChat(repos: Repos, chatId: string): Promise<{ deleted: number; kept: number }> {
  return deleteForChat(BRAHMA_ATTACHMENT_FOLDER, repos, chatId)
}
