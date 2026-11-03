/**
 * The reach chokepoint fence (Refactor 4.12, tier walk).
 *
 * What a character or a cast can reach is `lib/mount-index/reach.ts` (and the
 * forward walk beside it, `tiered-mount-pool.ts`). A tier is never walked by
 * hand: a hand-rolled group loop — a membership read followed by the group's
 * `officialMountPointId` or its `groupDocMountLinks` — is how the group tier
 * came to have three different orders and two dedupe rules; a hand-rolled
 * project-link read is how the project tier came to mean "official only" in
 * some places and "every link" in others.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SCAN_DIRS = ['lib', 'app']
const REACH_DIR = 'lib/mount-index/'

/** How far after a membership read a store lookup still counts as the same loop. */
const GROUP_LOOP_WINDOW = 30

/**
 * Sites that read a project's links for something other than a reach walk:
 * a yes/no capability probe, a display listing, or the link management API.
 */
const PROJECT_LINK_SANCTIONED = new Set([
  // "Does this project have any stores?" — capability probes for the doc tools.
  'lib/services/chat-message/turn-tools.service.ts',
  'lib/services/carina/carina.service.ts',
  'app/api/v1/tools/route.ts',
  // Display listings of a project's stores.
  'lib/services/prospero-notifications/writer.ts',
  'lib/tools/handlers/project-info-handler.ts',
  'lib/pascal/workbench.ts',
  // The default save target for a project's pictures.
  'app/api/v1/chats/[id]/actions/photo-albums.ts',
  // The project-files bridge and the link management route.
  'lib/file-storage/project-store-bridge.ts',
  'app/api/v1/projects/[id]/mount-points/route.ts',
])

function walk(dir: string, out: string[]): void {
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
  return files
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .filter((rel) => !rel.startsWith(REACH_DIR))
    .map((rel) => ({ rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }))
}

describe('reach chokepoint fence', () => {
  const files = sourceFiles()

  it('no hand-rolled group-tier loop outside lib/mount-index/', () => {
    const offenders: string[] = []
    for (const { rel, text } of files) {
      const lines = text.split('\n')
      lines.forEach((line, i) => {
        if (!line.includes('groupCharacterMembers.findByCharacterId')) return
        const window = lines.slice(i + 1, i + 1 + GROUP_LOOP_WINDOW).join('\n')
        if (/officialMountPointId|groupDocMountLinks/.test(window)) offenders.push(`${rel}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('no project-link read outside lib/mount-index/ but the sanctioned display sites', () => {
    const offenders = files
      .filter(({ text }) => text.includes('projectDocMountLinks.findByProjectId'))
      .map(({ rel }) => rel)
      .filter((rel) => !PROJECT_LINK_SANCTIONED.has(rel))
    expect(offenders).toEqual([])
  })

  it('every sanctioned project-link site still exists and still reads the links', () => {
    for (const rel of PROJECT_LINK_SANCTIONED) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      expect({ rel, reads: text.includes('projectDocMountLinks.findByProjectId') }).toEqual({ rel, reads: true })
    }
  })
})
