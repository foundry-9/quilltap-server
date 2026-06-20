/**
 * SVAR event → Quilltap REST call translation (pure, unit-testable).
 *
 * This is the heart of the adapter and the swap-out insurance: it turns each
 * SVAR semantic event into the `{ method, url, body }` of the v1 mount-point
 * routes, with NO SVAR runtime and NO network. SVAR node ids are opaque here —
 * a caller-supplied `resolve(id)` maps an id to `{ mountId, relativePath, type
 * }`, so this module never assumes the id encoding (that lives in node-id.ts).
 *
 * Backend reality this encodes (verified against the v1 routes):
 *  - rename            → PATCH  …/files/<path> { rename }
 *  - create folder     → POST   …/folders { path }
 *  - upload file       → POST   …?action=write-file (multipart)
 *  - delete file       → DELETE …/files/<path>
 *  - delete folder     → POST   …?action=delete-folder { path }
 *  - move file         → POST   …?action=move-file { sourcePath, destMountPointId, destPath }
 *  - move folder       → POST   …?action=move-folder { fromPath, toPath }   (same-mount only)
 *  - copy file         → POST   …?action=copy-file { sourcePath, destMountPointId, destPath }
 *  - open / download   → GET    …/files/<path>[?raw=1]
 *
 * Backend gaps surfaced as `unsupported`: there is no copy-folder route, and
 * move-folder cannot cross mounts (it takes fromPath/toPath, no dest mount).
 * The factory turns an `unsupported` call into the steampunk "copy the files
 * across instead" prompt rather than firing a doomed request.
 *
 * @module components/files/svar/event-route-map
 */

import { encodeRelPath, relBasename, relDirname, relJoin } from './node-id'
import type {
  SvarRenamePayload,
  SvarCreatePayload,
  SvarDeletePayload,
  SvarMovePayload,
  SvarCopyPayload,
  SvarOpenPayload,
  SvarDownloadPayload,
} from './svar-types'

export type SvarOp =
  | 'rename'
  | 'create-folder'
  | 'upload'
  | 'delete-file'
  | 'delete-folder'
  | 'move-file'
  | 'move-folder'
  | 'copy-file'
  | 'open'
  | 'download'

export interface ResolvedNode {
  mountId: string
  relativePath: string
  type: 'file' | 'folder'
}

/** Maps a SVAR node id to its mount + path + kind (or undefined if unknown). */
export type NodeResolver = (id: string) => ResolvedNode | undefined

export interface RouteCall {
  op: SvarOp
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  body?: unknown
  /** Upload: the factory attaches the originating File to a multipart form. */
  multipart?: boolean
  /** Set when the backend can't express the gesture; carries a user-facing reason. */
  unsupported?: string
}

/** Context for events that may act at a mount root (no resolvable parent node). */
export interface MapContext {
  resolve: NodeResolver
  /** The active pane's mount id — fallback when a node can't be resolved (root ops). */
  mountId: string
}

// ── URL builders ────────────────────────────────────────────────────────────
const mountBase = (mountId: string) => `/api/v1/mount-points/${mountId}`
const itemUrl = (mountId: string, rel: string) =>
  `${mountBase(mountId)}/files/${encodeRelPath(rel)}`
const actionUrl = (mountId: string, action: string) =>
  `${mountBase(mountId)}?action=${action}`
const foldersUrl = (mountId: string) => `${mountBase(mountId)}/folders`

// ── Per-event mappers ───────────────────────────────────────────────────────

export function mapRename(p: SvarRenamePayload, ctx: MapContext): RouteCall[] {
  const node = ctx.resolve(p.id)
  if (!node) return []
  // SVAR gives the new basename; the route wants the new mount-relative path.
  const rename = relJoin(relDirname(node.relativePath), p.name)
  return [{ op: 'rename', method: 'PATCH', url: itemUrl(node.mountId, node.relativePath), body: { rename } }]
}

export function mapCreate(p: SvarCreatePayload, ctx: MapContext): RouteCall[] {
  const parent = ctx.resolve(p.parent)
  const mountId = parent?.mountId ?? ctx.mountId
  const parentPath = parent?.relativePath ?? ''
  const path = relJoin(parentPath, p.file.name)
  if (p.file.type === 'folder') {
    return [{ op: 'create-folder', method: 'POST', url: foldersUrl(mountId), body: { path } }]
  }
  return [{ op: 'upload', method: 'POST', url: actionUrl(mountId, 'write-file'), multipart: true, body: { path } }]
}

export function mapDelete(p: SvarDeletePayload, ctx: MapContext): RouteCall[] {
  return p.ids
    .map((id): RouteCall | null => {
      const node = ctx.resolve(id)
      if (!node) return null
      if (node.type === 'folder') {
        return { op: 'delete-folder', method: 'POST', url: actionUrl(node.mountId, 'delete-folder'), body: { path: node.relativePath } }
      }
      return { op: 'delete-file', method: 'DELETE', url: itemUrl(node.mountId, node.relativePath) }
    })
    .filter((c): c is RouteCall => c !== null)
}

export function mapMove(p: SvarMovePayload, ctx: MapContext): RouteCall[] {
  const dest = ctx.resolve(p.target)
  if (!dest) return []
  return p.ids
    .map((id): RouteCall | null => {
      const src = ctx.resolve(id)
      if (!src) return null
      const destPath = relJoin(dest.relativePath, relBasename(src.relativePath))
      if (src.type === 'folder') {
        if (src.mountId !== dest.mountId) {
          return { op: 'move-folder', method: 'POST', url: actionUrl(src.mountId, 'move-folder'), unsupported: 'Whole folders can’t be ferried between repositories — copy the files across instead.', body: { fromPath: src.relativePath, toPath: destPath } }
        }
        return { op: 'move-folder', method: 'POST', url: actionUrl(src.mountId, 'move-folder'), body: { fromPath: src.relativePath, toPath: destPath } }
      }
      return { op: 'move-file', method: 'POST', url: actionUrl(src.mountId, 'move-file'), body: { sourcePath: src.relativePath, destMountPointId: dest.mountId, destPath } }
    })
    .filter((c): c is RouteCall => c !== null)
}

export function mapCopy(p: SvarCopyPayload, ctx: MapContext): RouteCall[] {
  const dest = ctx.resolve(p.target)
  if (!dest) return []
  return p.ids
    .map((id): RouteCall | null => {
      const src = ctx.resolve(id)
      if (!src) return null
      const destPath = relJoin(dest.relativePath, relBasename(src.relativePath))
      if (src.type === 'folder') {
        // No copy-folder route exists; surface it rather than fire a 404.
        return { op: 'copy-file', method: 'POST', url: actionUrl(src.mountId, 'copy-file'), unsupported: 'Folders can’t be copied wholesale just yet — select the files within instead.', body: { sourcePath: src.relativePath, destMountPointId: dest.mountId, destPath } }
      }
      return { op: 'copy-file', method: 'POST', url: actionUrl(src.mountId, 'copy-file'), body: { sourcePath: src.relativePath, destMountPointId: dest.mountId, destPath } }
    })
    .filter((c): c is RouteCall => c !== null)
}

export function mapOpen(p: SvarOpenPayload, ctx: MapContext): RouteCall[] {
  const node = ctx.resolve(p.id)
  if (!node || node.type === 'folder') return []
  return [{ op: 'open', method: 'GET', url: itemUrl(node.mountId, node.relativePath) }]
}

export function mapDownload(p: SvarDownloadPayload, ctx: MapContext): RouteCall[] {
  const node = ctx.resolve(p.id)
  if (!node || node.type === 'folder') return []
  return [{ op: 'download', method: 'GET', url: `${itemUrl(node.mountId, node.relativePath)}?raw=1` }]
}

/**
 * Dispatch a SVAR action + payload to its REST call(s). Returns [] for
 * UI-only / navigation events (select, set-path, sort, etc.) the adapter
 * doesn't translate. Unknown payloads return [] rather than throwing.
 */
export function mapSvarEvent(action: string, payload: unknown, ctx: MapContext): RouteCall[] {
  switch (action) {
    case 'rename-file':
      return mapRename(payload as SvarRenamePayload, ctx)
    case 'create-file':
      return mapCreate(payload as SvarCreatePayload, ctx)
    case 'delete-files':
      return mapDelete(payload as SvarDeletePayload, ctx)
    case 'move-files':
      return mapMove(payload as SvarMovePayload, ctx)
    case 'copy-files':
      return mapCopy(payload as SvarCopyPayload, ctx)
    case 'open-file':
      return mapOpen(payload as SvarOpenPayload, ctx)
    case 'download-file':
      return mapDownload(payload as SvarDownloadPayload, ctx)
    default:
      return []
  }
}
