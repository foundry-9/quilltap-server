/**
 * One `Content-Disposition` builder (#165).
 *
 * A hand-built `filename="${name}"` breaks on a `"` in the name and throws on
 * any character above U+00FF (a header value must be a ByteString), which the
 * surrounding catch turns into a 500. `buildContentDisposition`
 * (`lib/api/content-disposition.ts`) quotes, escapes and adds the RFC 5987
 * `filename*` form; every route that names a download calls it.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const SCAN_DIRS = ['app', 'lib']
const BUILDER = path.join('lib', 'api', 'content-disposition.ts')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('Content-Disposition chokepoint', () => {
  it('no server file spells a filename= header by hand', () => {
    const offenders: string[] = []
    for (const dir of SCAN_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file)
        if (rel === BUILDER) continue
        const lines = fs.readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, i) => {
          if (/(attachment|inline);\s*filename=/.test(line)) offenders.push(`${rel}:${i + 1}`)
        })
      }
    }
    expect(offenders).toEqual([])
  })
})
