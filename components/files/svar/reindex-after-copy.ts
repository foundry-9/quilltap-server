/**
 * Decide whether to auto-reindex after a cross-mount copy/move (pure).
 *
 * Cross-mount copy/move is byte-preserving: `writeDestBytes` (the `byte-copy`
 * strategy) does NOT re-run PDF/DOCX text-extraction + embedding on a database
 * destination. So a `.pdf`/`.docx` copied fs→db lands verbatim, unlike a fresh
 * upload through `storeMountFile`. This decides when the adapter should fire the
 * scoped `?action=reindex` + `?action=embed` (dest path only) to close that gap.
 *
 * Only `byte-copy` of an extractable type qualifies — `db-link`/`fs-link`/
 * `rename` share a content row or inode (nothing to re-extract), and fs→fs /
 * db→fs byte-copies already re-index on the destination via `processMountFile`.
 * The trigger is intentionally narrow: effectively fs→db of `.pdf`/`.docx`.
 *
 * @module components/files/svar/reindex-after-copy
 */

import { extOf } from './node-id'

/** Dest extensions that `storeMountFile` would text-extract + embed. */
const EXTRACTABLE = new Set(['pdf', 'docx'])

export interface FileOpResultLike {
  strategy: string
  destMountPointId: string
  destPath: string
}

export interface ReindexTarget {
  mountId: string
  path: string
}

/**
 * Returns the scoped reindex target when the copy/move left an extractable file
 * un-indexed, else null. The caller fires it fire-and-forget (a reindex failure
 * must never roll back the copy — the bytes are safely placed).
 */
export function reindexAfterCopy(result: FileOpResultLike): ReindexTarget | null {
  if (result.strategy !== 'byte-copy') return null
  if (!EXTRACTABLE.has(extOf(result.destPath))) return null
  return { mountId: result.destMountPointId, path: result.destPath }
}
