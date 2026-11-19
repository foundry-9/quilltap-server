/**
 * Store outlines for the research kit: a store's (or folder's) files as an
 * indented tree, with folders of more than 25 files and picture folders
 * collapsed to one line (count and newest file). Shared by `list_documents`
 * and the record lookups (`lookup_character`, `lookup_group`,
 * `lookup_project`).
 *
 * @module lib/research/outline
 */

import { getRepositories } from '@/lib/repositories/factory'
import { formatDocStoreUri } from '@/lib/doc-edit/qtap-uri'
import { foldName } from './text'

/**
 * A store's `qtap://` address, to which a file's path is appended to read it
 * (`qtap://Amy%20Character%20Vault/` + `identity.md`). The authority is the
 * store's name (store names are one namespace) or its id where the name is
 * reserved — never an owner shorthand such as `character:Amy`, which is a
 * `store` argument, not an address.
 */
export function storeAddress(store: { id: string; name: string }): string {
  const uri = formatDocStoreUri({ mountPointName: store.name, mountPointId: store.id, path: 'x' })
  return uri.endsWith('/x') ? uri.slice(0, -1) : uri
}

/** A folder with more files than this is collapsed in a listing. */
export const COLLAPSE_FOLDER_OVER = 25
/** Folders always collapsed in a listing: they hold pictures, not text. */
export const BINARY_FOLDERS: ReadonlySet<string> = new Set(['images', 'photos', 'character-avatars', 'story-backgrounds'])

function dateOf(iso: string): string {
  return (iso ?? '').slice(0, 10)
}

/** Whether a store-relative path sits in `folder` (folded; '' is the root). */
export function inFolder(relativePath: string, folder: string): boolean {
  if (!folder) return true
  const path = foldName(relativePath)
  const want = foldName(folder)
  return path === want || path.startsWith(`${want}/`)
}

interface FolderNode {
  name: string
  files: Array<{ name: string; modified: string; size: number }>
  folders: Map<string, FolderNode>
}

function newNode(name: string): FolderNode {
  return { name, files: [], folders: new Map() }
}

function totalFiles(node: FolderNode): number {
  let n = node.files.length
  for (const child of node.folders.values()) n += totalFiles(child)
  return n
}

function newestFile(node: FolderNode): { name: string; modified: string } | null {
  let best: { name: string; modified: string } | null = null
  for (const f of node.files) if (!best || f.modified > best.modified) best = f
  for (const child of node.folders.values()) {
    const c = newestFile(child)
    if (c && (!best || c.modified > best.modified)) best = c
  }
  return best
}

function collapsedLine(indent: string, node: FolderNode): string {
  const count = totalFiles(node)
  const newest = newestFile(node)
  const newestLabel = newest ? `, newest ${dateOf(newest.modified)}: ${JSON.stringify(newest.name)}` : ''
  return `${indent}${node.name}/ (${count} file${count === 1 ? '' : 's'}${newestLabel})`
}

function renderNode(node: FolderNode, level: number, depth: number, out: string[]): void {
  const indent = '  '.repeat(level)
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))
  for (const child of folders) {
    const collapse =
      level + 1 >= depth || totalFiles(child) > COLLAPSE_FOLDER_OVER || BINARY_FOLDERS.has(child.name.toLowerCase())
    if (collapse) {
      out.push(collapsedLine(indent, child))
    } else {
      out.push(`${indent}${child.name}/`)
      renderNode(child, level + 1, depth, out)
    }
  }
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name))
  if (files.length > COLLAPSE_FOLDER_OVER && level > 0) {
    out.push(`${indent}(${files.length} files)`)
    return
  }
  for (const f of files) out.push(`${indent}${f.name} (${dateOf(f.modified)})`)
}

/** A store's (or folder's) outline as lines, for `list_documents` and the record lookups. */
export function outlineRows(
  rows: ReadonlyArray<{ relativePath: string; lastModified: string; fileSizeBytes: number }>,
  folder: string,
  depth: number,
): string[] {
  const root = newNode(folder || '')
  for (const row of rows) {
    if (!inFolder(row.relativePath, folder)) continue
    const rel = folder ? row.relativePath.slice(folder.length).replace(/^\/+/, '') : row.relativePath
    const segments = rel.split('/').filter(Boolean)
    if (segments.length === 0) continue
    let node = root
    for (const segment of segments.slice(0, -1)) {
      let next = node.folders.get(segment)
      if (!next) {
        next = newNode(segment)
        node.folders.set(segment, next)
      }
      node = next
    }
    node.files.push({ name: segments[segments.length - 1], modified: row.lastModified, size: row.fileSizeBytes })
  }
  const out: string[] = []
  renderNode(root, 0, Math.max(1, depth), out)
  return out
}

/** A store's outline, read in one scan (for the record lookups). */
export async function storeOutline(mountPointId: string, depth = 2): Promise<{ fileCount: number; lines: string[] }> {
  const rows = await getRepositories().docMountFileLinks.scanForResearch([mountPointId], { withText: false })
  return { fileCount: rows.length, lines: outlineRows(rows, '', depth) }
}

