/**
 * Map a Quilltap mount listing → SVAR tree nodes (pure).
 *
 * `GET /api/v1/mount-points/[id]/files` returns
 * `{ files: DocMountFileLinkWithContent[], folders: string[] }`. SVAR wants a
 * flat `IEntity[]` keyed by node id, from which it builds the tree. We:
 *  - key every node `/<mountId>/<relativePath>` (see node-id.ts),
 *  - synthesize any missing ancestor folders so a nested file is never orphaned
 *    even if the listing didn't enumerate every intermediate directory,
 *  - carry size + mtime so SVAR's columns/preview have something to show.
 *
 * @module components/files/svar/listing-to-tree
 */

import type { DocMountFileLinkWithContent } from '@/lib/schemas/mount-index.types'
import type { IEntity } from './svar-types'
import { relPathToNodeId, relDirname } from './node-id'

export interface MountListing {
  files: DocMountFileLinkWithContent[]
  folders: string[]
}

export function listingToTree(listing: MountListing): IEntity[] {
  const folderPaths = new Set<string>()
  const addWithAncestors = (rel: string) => {
    for (const p of withAncestors(rel)) folderPaths.add(p)
  }

  for (const folder of listing.folders) {
    if (folder) addWithAncestors(folder)
  }
  for (const f of listing.files) {
    const dir = relDirname(f.relativePath)
    if (dir) addWithAncestors(dir)
  }

  const nodes: IEntity[] = []
  // Shallower folders first so SVAR sees parents before children.
  for (const folder of [...folderPaths].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))) {
    nodes.push({ id: relPathToNodeId(folder), type: 'folder' })
  }
  for (const f of listing.files) {
    nodes.push({
      id: relPathToNodeId(f.relativePath),
      type: 'file',
      size: f.fileSizeBytes,
      date: toDate(f.lastModified),
    })
  }
  return nodes
}

/** A path plus every ancestor directory: 'a/b/c' → ['a', 'a/b', 'a/b/c']. */
function withAncestors(rel: string): string[] {
  const parts = rel.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

function depth(rel: string): number {
  return rel.split('/').filter(Boolean).length
}

function toDate(ts: string | number | null | undefined): Date | undefined {
  if (ts == null) return undefined
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? undefined : d
}
