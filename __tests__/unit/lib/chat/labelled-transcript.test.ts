/**
 * One renderer for a transcript bound for a cheap LLM (refactor 4.13, phase 3).
 *
 * CLAUDE.md: "a transcript sent to a cheap LLM is labelled by speaker, never by
 * role." `renderLabelledTranscript` is the formatter every cheap-LLM pass over
 * conversation turns uses; the grep-test below keeps the hand formatters it
 * replaced (`USER:` / `ASSISTANT:` via `role.toUpperCase()`, and the
 * `'User' : 'Character'` ternaries) from growing back under `lib/memory/` and
 * `lib/image-gen/`.
 */

import fs from 'fs'
import path from 'path'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

import {
  ESTABLISHED_FACT_SPEAKER_LABEL,
  renderLabelledTranscript,
  transcriptLineLabel,
  type SpeakerNames,
} from '@/lib/chat/speaker-names'
import { memoryDateStamp } from '@/lib/memory/time'
import { toVisibleConversationMessage } from '@/lib/memory/cheap-llm-tasks/chat-tasks'

const NAMES: SpeakerNames = new Map([
  ['p-friday', 'Friday'],
  ['p-charlie', 'Charlie'],
])

describe('transcriptLineLabel', () => {
  it('names a resolved seat, whichever case the role is in', () => {
    expect(transcriptLineLabel({ role: 'assistant', content: 'x', participantId: 'p-friday' }, NAMES)).toBe('Friday')
    expect(transcriptLineLabel({ role: 'USER', content: 'x', participantId: 'p-charlie' }, NAMES)).toBe('Charlie')
  })

  it('falls back to User / Character, never a bare role', () => {
    expect(transcriptLineLabel({ role: 'user', content: 'x' }, NAMES)).toBe('User')
    expect(transcriptLineLabel({ role: 'assistant', content: 'x', participantId: 'p-nobody' }, NAMES)).toBe('Character')
    expect(transcriptLineLabel({ role: 'ASSISTANT', content: 'x', participantId: null }, new Map())).toBe('Character')
  })

  it('labels an unseated system line System, and a seated one by name', () => {
    expect(transcriptLineLabel({ role: 'system', content: 'x' }, NAMES)).toBe('System')
    expect(transcriptLineLabel({ role: 'system', content: 'x', participantId: 'p-friday' }, NAMES)).toBe('Friday')
  })

  it('lets a caller-resolved speaker win', () => {
    expect(transcriptLineLabel({ role: 'user', content: 'x', participantId: 'p-friday', speaker: 'Ambrose' }, NAMES))
      .toBe('Ambrose')
  })

  it('labels a machine-delivered established fact as such', () => {
    expect(transcriptLineLabel(
      { role: 'assistant', content: 'x', systemSender: 'host', systemKind: 'established-fact' },
      NAMES,
    )).toBe(ESTABLISHED_FACT_SPEAKER_LABEL)
  })
})

describe('renderLabelledTranscript', () => {
  it('renders Name: content lines joined by a blank line', () => {
    const text = renderLabelledTranscript(
      [
        { role: 'user', content: 'Good morning.', participantId: 'p-charlie' },
        { role: 'assistant', content: 'Is it?', participantId: 'p-friday' },
        { role: 'user', content: 'Who knows.' },
      ],
      NAMES,
    )
    expect(text).toBe('Charlie: Good morning.\n\nFriday: Is it?\n\nUser: Who knows.')
    expect(text).not.toMatch(/USER:|ASSISTANT:/)
  })

  it('defaults to role fallbacks with no names, and honours a separator', () => {
    expect(renderLabelledTranscript(
      [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
      undefined,
      { separator: '\n' },
    )).toBe('User: a\nCharacter: b')
  })

  it('truncates at a fixed cap with ...', () => {
    expect(renderLabelledTranscript([{ role: 'user', content: 'abcdefgh' }], NAMES, { maxChars: 3 }))
      .toBe('User: abc...')
    expect(renderLabelledTranscript([{ role: 'user', content: 'abc' }], NAMES, { maxChars: 3 }))
      .toBe('User: abc')
  })

  it('truncates by position when the cap is a function (the title rule)', () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `${i}`.padEnd(200, 'x') }))
    const text = renderLabelledTranscript(lines, NAMES, {
      maxChars: (i, total) => (i >= Math.max(0, total - 10) ? 500 : 150),
    })
    const rendered = text.split('\n\n')
    expect(rendered[0]).toBe(`User: ${lines[0].content.substring(0, 150)}...`)
    expect(rendered[1]).toBe(`User: ${lines[1].content.substring(0, 150)}...`)
    expect(rendered[2]).toBe(`User: ${lines[2].content}`)
    expect(rendered[11]).toBe(`User: ${lines[11].content}`)
  })

  it('prefixes a date stamp on the instance calendar when asked', () => {
    // 03:44Z on 11 November is still 10 November in Chicago (#187).
    const text = renderLabelledTranscript(
      [
        { role: 'user', content: 'late', participantId: 'p-charlie', createdAt: '2026-11-11T03:44:00.000Z' },
        { role: 'assistant', content: 'undated', participantId: 'p-friday' },
      ],
      NAMES,
      { dateStamp: (iso) => memoryDateStamp(iso, { timeZone: 'America/Chicago' }) },
    )
    expect(text).toBe('[2026-11-10] Charlie: late\n\nFriday: undated')
  })

  it('omits the stamp when the stamper returns null', () => {
    expect(renderLabelledTranscript(
      [{ role: 'user', content: 'a', createdAt: 'not a date' }],
      NAMES,
      { dateStamp: () => null },
    )).toBe('User: a')
  })
})

describe('the visible conversation keeps its seats', () => {
  it('carries participantId onto a user or assistant line', () => {
    expect(toVisibleConversationMessage({ type: 'message', role: 'USER', content: 'hi', participantId: 'p-charlie' }))
      .toEqual({ role: 'user', content: 'hi', participantId: 'p-charlie' })
    expect(toVisibleConversationMessage({ type: 'message', role: 'ASSISTANT', content: 'hello there, friend', participantId: 'p-friday' }))
      .toEqual({ role: 'assistant', content: 'hello there, friend', participantId: 'p-friday' })
  })

  it('adds nothing when the row has no seat', () => {
    expect(toVisibleConversationMessage({ type: 'message', role: 'USER', content: 'hi' }))
      .toStrictEqual({ role: 'user', content: 'hi' })
  })
})

// ---------------------------------------------------------------------------
// Grep-test: no role-labelled transcript under lib/memory/ or lib/image-gen/
// ---------------------------------------------------------------------------

const ROOT = process.cwd()
const SCANNED_DIRS = ['lib/memory', 'lib/image-gen']

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full)
    }
  }
  for (const dir of SCANNED_DIRS) walk(path.join(ROOT, dir))
  return out
}

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles()
    .filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .sort()
}

describe('labelled-transcript grep-test', () => {
  it('scans something', () => {
    expect(sourceFiles().length).toBeGreaterThan(10)
  })

  it('no transcript is labelled by upper-cased role', () => {
    expect(filesMatching(/role\.toUpperCase\(\)/)).toEqual([])
  })

  it("no transcript is labelled by a 'User' : 'Character' role ternary", () => {
    expect(filesMatching(/\?\s*'User'\s*:/)).toEqual([])
  })
})
