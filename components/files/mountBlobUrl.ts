/**
 * URL helpers for Scriptorium mount-point files.
 *
 * Files in a database-backed document store are addressed by
 * (mountPointId, relativePath). Both the canonical `/files/[...path]` item
 * route and the legacy `/blobs/[...path]` byte route use a catch-all segment
 * and decode each segment once, so we encode each segment exactly once.
 *
 * - `buildMountFileItemUrl` → the canonical CRUD route (`/files/...`). Use it
 *   for write/delete/rename/metadata operations.
 * - `buildMountBlobUrl` → the byte-serving route (`/blobs/...`). This is the
 *   STABLE, persisted URL embedded as an `<img src>`/download source in saved
 *   Markdown; keep using it for previews, thumbnails, and downloads so those
 *   references never break.
 */

export function encodeMountBlobPath(relativePath: string): string {
  return relativePath.split('/').map(encodeURIComponent).join('/')
}

export function buildMountFileItemUrl(mountPointId: string, relativePath: string): string {
  return `/api/v1/mount-points/${encodeURIComponent(mountPointId)}/files/${encodeMountBlobPath(relativePath)}`
}

export function buildMountBlobUrl(mountPointId: string, relativePath: string): string {
  return `/api/v1/mount-points/${encodeURIComponent(mountPointId)}/blobs/${encodeMountBlobPath(relativePath)}`
}
