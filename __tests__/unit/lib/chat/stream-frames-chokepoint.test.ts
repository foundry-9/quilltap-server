/**
 * @jest-environment node
 *
 * `encodeFrame` (`lib/chat/stream-frames.ts`) is the only producer of
 * `data: …` bytes on the Salon turn path (refactor 4.12, stream frames §5.2).
 * No file under the turn path spells an SSE frame by hand, and nothing
 * re-encodes bytes to tag a concurrent seat.
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SCAN_DIRS = ['lib/services/chat-message', 'lib/storyteller', 'lib/chat/turn-manager']
const EXTENSIONS = new Set(['.ts', '.tsx'])

const FORBIDDEN = [/data: \$\{/, /\btagSseChunk\b/, /\btaggingController\b/]

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full)
  }
}

describe('Salon stream-frame chokepoint', () => {
  it('no file on the turn path builds an SSE frame except stream-frames.ts', () => {
    const files: string[] = []
    for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files)
    expect(files.length).toBeGreaterThan(30)

    const offenders: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${path.relative(ROOT, file)}: ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('stream-frames.ts is the one place that does', () => {
    const text = fs.readFileSync(path.join(ROOT, 'lib/chat/stream-frames.ts'), 'utf8')
    expect(text.match(/data: \$\{/g)).toHaveLength(1)
  })
})
