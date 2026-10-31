/**
 * What a document-store browser offers on each row, decided once from the
 * store's capabilities and the row itself. A row renders the actions it is
 * handed and nothing else, so the gating lives here rather than in JSX.
 *
 * `BrowserAction` is the shared vocabulary; the Wardrobe and Inventory rows
 * keep their own richer menus (outfits, kits, equipping) and do not use it.
 *
 * Hard links follow `linkFile` (`lib/mount-index/file-ops.ts`): database ↔
 * database between any stores, filesystem ↔ filesystem only within one
 * store (a link across stores may cross devices, which fails), never across
 * storage kinds.
 *
 * Client-safe: pure.
 *
 * @module lib/folder-browser/document-actions
 */

import { previewKindOf } from './preview-kind'

export type BrowserAction =
  | 'open'
  | 'rename'
  | 'move'
  | 'copy'
  | 'link'
  | 'show-links'
  | 'unlink'
  | 'describe'
  | 'workbench'
  | 'download'
  | 'delete'

/** The capability flags a store's record carries (`deriveMountCapabilities`). */
export interface StoreCapabilities {
  canWrite: boolean
  canDelete: boolean
  canCreateFolder: boolean
  canMoveIn: boolean
  canMoveOut: boolean
}

/** What the gating needs to know about a store. */
export interface BrowserStore {
  id: string
  mountType: 'filesystem' | 'obsidian' | 'database'
  enabled?: boolean
  capabilities?: StoreCapabilities | null
}

/** What the gating needs to know about a file row. */
export interface BrowserFile {
  relativePath: string
  fileName: string
  fileType: string
  source?: 'filesystem' | 'database'
  linkGroupId?: string | null
  linkCount?: number
  originalMimeType?: string | null
}

const NO_CAPABILITIES: StoreCapabilities = {
  canWrite: false,
  canDelete: false,
  canCreateFolder: false,
  canMoveIn: false,
  canMoveOut: false,
}

/** A store's capabilities, or none when the record has not said. */
export function capabilitiesOf(store: BrowserStore | null | undefined): StoreCapabilities {
  return store?.capabilities ?? NO_CAPABILITIES
}

function isFilesystemStore(store: BrowserStore): boolean {
  return store.mountType === 'filesystem' || store.mountType === 'obsidian'
}

/** Whether a file in `source` can be hard-linked into `dest`. */
export function canLinkBetween(source: BrowserStore, dest: BrowserStore): boolean {
  if (!capabilitiesOf(source).canMoveOut || !capabilitiesOf(dest).canMoveIn) return false
  if (source.mountType === 'database' && dest.mountType === 'database') return true
  return isFilesystemStore(source) && isFilesystemStore(dest) && source.id === dest.id
}

/** Root-level custom-tool definitions open on Pascal's Workbench. */
export function isCustomToolDefinition(relativePath: string): boolean {
  return /^tools\/[^/]+\.tool\.json$/i.test(relativePath)
}

/** Stored as a blob, with an editable description (database stores only). */
export function hasDescription(file: BrowserFile): boolean {
  return file.source === 'database' && ['blob', 'pdf', 'docx'].includes(file.fileType)
}

/**
 * The actions a file row offers. `linkTargets` says whether any store
 * (this one included) can take a hard link of it.
 */
export function documentFileActions(
  store: BrowserStore,
  file: BrowserFile,
  opts: { linkTargets: boolean },
): BrowserAction[] {
  const caps = capabilitiesOf(store)
  const actions: BrowserAction[] = ['open']
  if (caps.canWrite && caps.canMoveOut) actions.push('rename', 'move')
  if (caps.canMoveOut) actions.push('copy')
  if (opts.linkTargets && caps.canMoveOut) actions.push('link')
  // Only a deliberate hard link is worth showing: files that merely share a
  // content row (identical bytes, empty files above all) are independent.
  if (file.linkGroupId) {
    actions.push('show-links')
    if (caps.canWrite) actions.push('unlink')
  }
  if (hasDescription(file) && caps.canWrite) actions.push('describe')
  if (isCustomToolDefinition(file.relativePath)) actions.push('workbench')
  actions.push('download')
  if (caps.canDelete) actions.push('delete')
  return actions
}

/** The actions a folder row offers (Open is the row itself). */
export function documentFolderActions(store: BrowserStore): BrowserAction[] {
  const caps = capabilitiesOf(store)
  const actions: BrowserAction[] = []
  if (caps.canWrite && caps.canMoveOut) actions.push('rename', 'move')
  if (caps.canMoveOut) actions.push('copy')
  if (caps.canDelete) actions.push('delete')
  return actions
}

/** The viewer a document-store row opens in. */
export function documentPreviewKind(file: BrowserFile) {
  return previewKindOf({ name: file.fileName, mimeType: file.originalMimeType, fileType: file.fileType })
}
