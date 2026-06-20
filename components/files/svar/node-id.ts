/**
 * Node-id scheme + relative-path helpers (pure, no SVAR import).
 *
 * SVAR keys every tree node by a single `id` string and builds the tree from
 * the root down, deriving a node's display name + parent by splitting that id
 * on `/` (its getting-started ids look like `/Music/Info.txt`, with top-level
 * items as one-segment ids under the "My files" root). So the node id is simply
 * the mount-relative path as a SVAR absolute path: `/<relativePath>` (root is
 * `/`). The mount id is NOT encoded in the node id — prefixing it (`/<mountId>/…`)
 * made every item a child of a non-existent `<mountId>` folder and orphaned the
 * whole tree. The owning costume holds the mount id and threads it into the
 * adapter's resolver, so identity is still `(mountId, relativePath)` — the mount
 * id just rides in config, not in the string.
 *
 * `relativePath` always uses `/` separators and never has a leading slash.
 *
 * @module components/files/svar/node-id
 */

/** Build a SVAR node id (absolute path) from a mount-relative path. */
export function relPathToNodeId(relativePath: string): string {
  const rel = stripLeadingSlash(relativePath)
  return rel ? `/${rel}` : '/'
}

/** Recover the mount-relative path from a SVAR node id. */
export function nodeIdToRelPath(id: string): string {
  return stripLeadingSlash(id)
}

/** Parent directory of a mount-relative path; '' for a top-level entry. */
export function relDirname(relativePath: string): string {
  const p = stripTrailingSlash(stripLeadingSlash(relativePath))
  const slash = p.lastIndexOf('/')
  return slash === -1 ? '' : p.slice(0, slash)
}

/** Final segment of a mount-relative path. */
export function relBasename(relativePath: string): string {
  const p = stripTrailingSlash(stripLeadingSlash(relativePath))
  const slash = p.lastIndexOf('/')
  return slash === -1 ? p : p.slice(slash + 1)
}

/** Join a directory + a single segment into a mount-relative path. */
export function relJoin(dir: string, name: string): string {
  const d = stripTrailingSlash(stripLeadingSlash(dir))
  return d ? `${d}/${name}` : name
}

/** Lower-cased extension without the dot, or '' if none. */
export function extOf(pathOrName: string): string {
  const base = relBasename(pathOrName)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** Percent-encode each path segment for use in the `/files/[...path]` route. */
export function encodeRelPath(relativePath: string): string {
  return stripLeadingSlash(relativePath)
    .split('/')
    .map(encodeURIComponent)
    .join('/')
}

function stripLeadingSlash(s: string): string {
  return s.startsWith('/') ? s.slice(1) : s
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s
}
