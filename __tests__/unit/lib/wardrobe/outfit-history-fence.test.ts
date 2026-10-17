/**
 * The outfit history's fences.
 *
 * - `chat_wardrobe_history` DDL is spelled only by its DDL module.
 * - The only runtime writer is `wardrobeHistory.settle`; `upsertRows` is for
 *   restore and import only.
 * - `settle` is a buffered write in the job child.
 * - The per-turn wardrobe containers are made only by
 *   `newWardrobeTurnContainers`, so no orchestrator forgets the history map.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SCAN_DIRS = ['lib', 'app', 'migrations', 'components']

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
}

function sourceFiles(): Array<{ rel: string; text: string }> {
  const files: string[] = []
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files)
  return files.map((file) => ({
    rel: path.relative(ROOT, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8'),
  }))
}

describe('outfit history fences', () => {
  const files = sourceFiles()

  it('no code outside the DDL module creates chat_wardrobe_history', () => {
    const offenders = files
      .filter(({ rel }) => rel !== 'lib/database/backends/sqlite/chat-wardrobe-history-ddl.ts')
      .filter(({ text }) => /CREATE (TABLE|UNIQUE INDEX|INDEX)[^`]*chat_wardrobe_history/.test(text))
      .map(({ rel }) => rel)
    expect(offenders).toEqual([])
  })

  it('no code outside the repository, the seed migration and the DDL module inserts history rows by hand', () => {
    const sanctioned = new Set([
      'lib/database/backends/sqlite/chat-wardrobe-history-ddl.ts',
      'lib/database/repositories/chat-wardrobe-history.repository.ts',
    ])
    const offenders = files
      .filter(({ rel }) => !sanctioned.has(rel))
      .filter(({ text }) => /(INSERT INTO|UPDATE|DELETE FROM)\s+"?chat_wardrobe_history/.test(text))
      .map(({ rel }) => rel)
    expect(offenders).toEqual([])
  })

  it('wardrobeHistory.upsertRows is called only from restore and import', () => {
    const offenders = files
      .filter(({ text }) => /wardrobeHistory\.upsertRows\(/.test(text))
      .map(({ rel }) => rel)
      .filter((rel) => !rel.startsWith('lib/backup/restore/') && !rel.startsWith('lib/import/'))
    expect(offenders).toEqual([])
  })

  it('no turn creates the announcement set by hand (newWardrobeTurnContainers makes both)', () => {
    const offenders = files
      .filter(({ rel }) => rel !== 'lib/wardrobe/turn-containers.ts')
      .filter(({ text }) => /pendingWardrobeAnnouncements:\s*new Set/.test(text))
      .map(({ rel }) => rel)
    expect(offenders).toEqual([])
  })

  it('settle is a buffered write in the job child', () => {
    const proxy = fs.readFileSync(path.join(ROOT, 'lib/background-jobs/child/child-repositories-proxy.ts'), 'utf8')
    expect(proxy).toMatch(/'wardrobeHistory\.settle':\s*'write'/)
  })
})
