/**
 * @jest-environment node
 *
 * A document in a store is read, written, renamed, deleted or created only
 * through the document core (`lib/documents/core/`, Refactor 4.12 spec 2).
 * Its callers — the `doc_*` tool handlers, the operator's Document Mode layer
 * and the two Document Mode routes — never reach past it to the primitives
 * beneath, which is how the two copies of every job drifted (#133, #134).
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()

/** The core's callers: every file under these is held to the fence. */
const CALLER_DIRS = [path.join('lib', 'tools', 'handlers', 'doc-edit')]
const CALLER_FILES = [
  path.join('lib', 'documents', 'operator-doc-actions.ts'),
  path.join('lib', 'documents', 'operator-doc-http.ts'),
]
/** `app/api/v1/**\/documents*` — the Document Mode routes. */
const ROUTE_ROOT = path.join('app', 'api', 'v1')

const PRIMITIVES = [
  'readFileWithMtime',
  'writeFileWithMtimeCheck',
  'readDatabaseBlobText',
  'readDatabaseBlobAsDocument',
  'readDatabaseBlobForDocument',
  'moveDatabaseDocument',
  'deleteDatabaseDocument',
  'reindexSingleFile',
]
const FORBIDDEN = [
  ...PRIMITIVES.map(name => new RegExp(`\\b${name}\\b`)),
  /\bfs\.writeFile\b/,
  /\bfs\.unlink\b/,
]

function walk(dir: string, out: string[], filter: (rel: string) => boolean = () => true): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out, filter)
    else if (/\.tsx?$/.test(entry.name) && filter(path.relative(ROOT, full))) out.push(full)
  }
}

/** Source with comments removed, so a docstring may name what it replaced. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function callerFiles(): string[] {
  const files: string[] = []
  for (const dir of CALLER_DIRS) walk(path.join(ROOT, dir), files)
  for (const file of CALLER_FILES) files.push(path.join(ROOT, file))
  walk(path.join(ROOT, ROUTE_ROOT), files, rel => /^documents/.test(path.basename(rel)) || rel.split(path.sep).includes('documents'))
  return files
}

describe('document core chokepoint', () => {
  it('finds the callers it fences', () => {
    const rels = callerFiles().map(f => path.relative(ROOT, f))
    expect(rels).toEqual(expect.arrayContaining([
      path.join('lib', 'tools', 'handlers', 'doc-edit', 'text-handlers.ts'),
      path.join('lib', 'tools', 'handlers', 'doc-edit', 'file-management-handlers.ts'),
      path.join('lib', 'tools', 'handlers', 'doc-edit', 'document-ui-handlers.ts'),
      path.join('lib', 'tools', 'handlers', 'doc-edit', 'markdown-handlers.ts'),
      path.join('lib', 'documents', 'operator-doc-actions.ts'),
      path.join('app', 'api', 'v1', 'documents', 'route.ts'),
      path.join('app', 'api', 'v1', 'chats', '[id]', 'actions', 'documents.ts'),
    ]))
  })

  it('no caller reads, writes, moves, deletes or re-indexes a document past the core', () => {
    const offenders: string[] = []
    for (const file of callerFiles()) {
      const text = code(fs.readFileSync(file, 'utf8'))
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${path.relative(ROOT, file)}: ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
