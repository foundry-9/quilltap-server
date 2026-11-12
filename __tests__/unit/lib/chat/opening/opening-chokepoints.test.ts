/**
 * The opening's fences (docs/developer/features/complete/refactor-green-room-and-opening.md §7).
 *
 * (a) A seat arrives through `seatArrival` (`lib/chat/opening/arrival.ts`), the
 *     only caller of the outfit and inventory appliers — three hand-kept
 *     arrival sequences is how a join came to dress in silence (§1.7.1).
 * (b) `openingState` is written only from `lib/chat/opening/`.
 * (c) The greeting is a turn: its private prompt builder, ladder and recall
 *     copy are gone and stay gone.
 * (d) A `greenRoom` frame is built only by the narrator (`narrator-frames.ts`).
 * (e) The New Chat dialog reads through TanStack Query, never a raw fetch.
 * (f) A test of the chats collection route mocks at most five modules; the
 *     cases it used to drive through `handleCreate` live with their modules.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()

function walk(dir: string, out: string[], includeTests = false): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    if (!includeTests && entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out, includeTests)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
}

function sources(dirs: string[]): Array<{ rel: string; text: string }> {
  const files: string[] = []
  for (const dir of dirs) walk(path.join(ROOT, dir), files)
  return files
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .filter((rel) => !/\.test\.tsx?$/.test(rel))
    .map((rel) => ({ rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }))
}

const CODE = sources(['lib', 'app', 'components', 'hooks'])

/** Files that call `name(` outside comments' prose (a crude but sufficient read). */
function callers(name: string): string[] {
  const call = new RegExp(`(?<![\\w.])${name}\\(`)
  return CODE.filter(({ text }) => text.split('\n').some((line) => {
    const t = line.trim()
    return !t.startsWith('*') && !t.startsWith('//') && call.test(line)
  })).map(({ rel }) => rel)
}

describe('the opening\'s chokepoints', () => {
  it('(a) only seatArrival applies outfits and arrival inventory', () => {
    expect(callers('applyOutfitSelections').filter((rel) => rel !== 'lib/wardrobe/apply-outfit-selections.ts'))
      .toEqual(['lib/chat/opening/arrival.ts'])
    expect(callers('applyInventoryDefaults').filter((rel) => rel !== 'lib/inventory/apply-defaults.ts'))
      .toEqual(['lib/chat/opening/arrival.ts'])
  })

  it('(b) only lib/chat/opening/ writes the opening state', () => {
    const writers = callers('setOpeningState').filter((rel) => rel !== 'lib/database/repositories/chats.repository.ts')
    expect(writers.filter((rel) => !rel.startsWith('lib/chat/opening/'))).toEqual([])
  })

  it('(c) nothing composes an opener by hand', () => {
    const banned = /\b(generateGreetingMessage|buildChatContext|buildFirstMessageContext|autoGenerateFirstMessage)\b/
    expect(CODE.filter(({ text }) => banned.test(text)).map(({ rel }) => rel)).toEqual([])
  })

  it('(d) a greenRoom frame is built only by the narrator', () => {
    const hand = /kind:\s*'greenRoom'/
    const sanctioned = new Set(['lib/chat/stream-frames.ts', 'lib/chat/opening/narrator-frames.ts'])
    expect(CODE.filter(({ rel, text }) => !sanctioned.has(rel) && hand.test(text)).map(({ rel }) => rel)).toEqual([])
  })

  it('(e) the New Chat dialog never fetches the API by hand', () => {
    const raw = /\bfetch\(\s*[`'"]\/api\/v1\//
    expect(sources(['components/new-chat']).filter(({ text }) => raw.test(text)).map(({ rel }) => rel)).toEqual([])
  })

  it('(f) every chats collection route test mocks at most five modules', () => {
    const dir = path.join(ROOT, '__tests__/unit/app/api/v1/chats')
    const heavy = fs.readdirSync(dir)
      .filter((name) => /^route\..*\.test\.ts$/.test(name))
      .map((name) => ({ name, mocks: (fs.readFileSync(path.join(dir, name), 'utf8').match(/^jest\.mock\(/gm) ?? []).length }))
      .filter(({ mocks }) => mocks > 5)
    expect(heavy).toEqual([])
  })
})
