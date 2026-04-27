/**
 * URL helpers for Scriptorium mount-point blobs.
 *
 * Files in a database-backed document store are addressed by
 * (mountPointId, relativePath). The blob endpoint uses a catch-all
 * segment and decodes each segment once, so we encode each segment
 * exactly once on the way out.
 */

export function encodeMountBlobPath(relativePath: string): string {
  return relativePath.split('/').map(encodeURIComponent).join('/')
}

export function buildMountBlobUrl(mountPointId: string, relativePath: string): string {
  return `/api/v1/mount-points/${encodeURIComponent(mountPointId)}/blobs/${encodeMountBlobPath(relativePath)}`
}
