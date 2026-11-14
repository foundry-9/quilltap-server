/**
 * @jest-environment node
 *
 * Two chokepoints, held by grep:
 *
 *  - Path containment. Every module below turns a caller- or manifest-supplied
 *    relative path into a filesystem path, and does it through
 *    `lib/paths/resolve-inside.ts`. None may hand-roll the check with a
 *    `startsWith` prefix test, a `relative(...).startsWith('..')` test, or an
 *    `.includes('..')` test on an already-joined path.
 *  - Stored bytes. Every route below serves bytes a user or model supplied,
 *    and builds its headers through `lib/api/serve-stored-bytes.ts` — never a
 *    hand-written `Content-Type` / `Content-Disposition` pair — and none sends
 *    `Access-Control-Allow-Origin`.
 */

import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../../..')

const CONTAINMENT_SITES = [
  'lib/mount-index/file-ops.ts',
  'lib/mount-index/sync/apply-disk.ts',
  'lib/mount-index/scanner.ts',
  'lib/file-storage/backends/local/index.ts',
  'lib/themes/bundle-loader.ts',
  'lib/themes/theme-registry.ts',
  'lib/doc-edit/path-resolver.ts',
  'app/api/themes/assets/[...path]/route.ts',
  'app/api/themes/fonts/[...path]/route.ts',
]

const STORED_BYTES_SITES = [
  'app/api/v1/files/[id]/actions/download.ts',
  'app/api/v1/files/proxy/[...key]/route.ts',
  'app/api/v1/mount-points/[id]/blobs/[...path]/route.ts',
  'app/api/v1/mount-points/[id]/files/[...path]/route.ts',
  'app/api/v1/chats/[id]/qtap-target/route.ts',
  'app/api/themes/assets/[...path]/route.ts',
  'app/api/themes/fonts/[...path]/route.ts',
]

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8')
}

/** Source with line and block comments removed, so prose cannot trip a check. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('path containment goes through resolveInside', () => {
  it.each(CONTAINMENT_SITES)('%s imports the helper', (rel) => {
    expect(read(rel)).toMatch(/from '(@\/lib|\.\.\/\.\.\/\.\.)\/paths\/resolve-inside'/)
  })

  it.each(CONTAINMENT_SITES)('%s has no hand-rolled prefix containment check', (rel) => {
    const src = code(rel)
    // `abs.startsWith(base + path.sep)`, `startsWith(baseWithSep)`, `startsWith(baseDir)`, …
    expect(src).not.toMatch(/\.startsWith\(\s*(base|root|dest|target)\w*\s*(\+\s*(path\.)?sep)?\s*\)/i)
    expect(src).not.toMatch(/\.startsWith\(\s*\w*(Dir|Base|Path)\s*(\+\s*(path\.)?sep)?\s*\)/)
    expect(src).not.toMatch(/relative\([^)]*\)\s*;?\s*\n?\s*if\s*\(\s*\w+\.startsWith\('\.\.'\)/)
    expect(src).not.toMatch(/normalize\([^)]*\)\.includes\('\.\.'\)/)
  })
})

describe('stored bytes are served through serveStoredBytes', () => {
  it.each(STORED_BYTES_SITES)('%s uses the helper', (rel) => {
    const src = code(rel)
    expect(src).toMatch(/from '@\/lib\/api\/serve-stored-bytes'/)
    expect(src).toMatch(/serveStoredBytes\(/)
  })

  it.each(STORED_BYTES_SITES)('%s writes no Content-Type, disposition or CORS header by hand', (rel) => {
    const src = code(rel)
    expect(src).not.toMatch(/'Content-Type':/)
    expect(src).not.toMatch(/'Content-Disposition':/)
    expect(src).not.toMatch(/Access-Control-Allow-Origin/)
  })
})
