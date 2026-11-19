/**
 * Brahma never invents (docs/developer/features/roleplay-character-latitude.md §5.9).
 *
 * A story character may fill in the world; the Brahma Console reads the
 * operator's real data and may not. Two guards:
 *  - the brief says so, in both modes;
 *  - no console code imports the story-character section or the Carina
 *    reference-query block, so the latitude can never leak into a console.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

import {
  BRAHMA_ACCURACY_RULE,
  BRAHMA_WRITING_ACCURACY_RULE,
  buildBrahmaSystemPrompt,
} from '@/lib/brahma-console/system-prompt-builder'
import { STORY_CHARACTER_SECTION } from '@/lib/chat/context/story-character-section'
import { ROLEPLAY_REFERENCE_QUERY_CLOSE } from '@/lib/services/carina/reference-query'

type Options = Parameters<typeof buildBrahmaSystemPrompt>[0]
const options = (extra: Partial<Options> = {}) => ({ profile: {}, ...extra }) as unknown as Options

describe('the Brahma brief', () => {
  it('carries the accuracy rule in the ordinary console', () => {
    const prompt = buildBrahmaSystemPrompt(options())

    expect(prompt).toContain(BRAHMA_ACCURACY_RULE)
    expect(prompt).not.toContain(BRAHMA_WRITING_ACCURACY_RULE)
  })

  it('carries the writing form of the rule in Writing Assistant mode', () => {
    const prompt = buildBrahmaSystemPrompt(options({ writingAssistant: true }))

    expect(prompt).toContain(BRAHMA_WRITING_ACCURACY_RULE)
    expect(prompt).not.toContain(BRAHMA_ACCURACY_RULE)
  })

  it.each([false, true])('never carries the story latitude (writingAssistant: %s)', (writingAssistant) => {
    const prompt = buildBrahmaSystemPrompt(options({ writingAssistant, includeSqlAccess: true, toolInstructions: 'Call tools.' }))

    expect(prompt).not.toContain('## Playing your part')
    expect(prompt).not.toContain(STORY_CHARACTER_SECTION)
    expect(prompt).not.toContain(ROLEPLAY_REFERENCE_QUERY_CLOSE)
  })

  it('says never, says to report where it looked, and allows invention only on request', () => {
    expect(BRAHMA_ACCURACY_RULE).toContain('Never make up a fact.')
    expect(BRAHMA_ACCURACY_RULE).toContain('say so plainly and say where you looked')
    expect(BRAHMA_ACCURACY_RULE).toContain('Invent outright only when the operator asks you to')
    // Reasoning from the record is not invention (research kit §7.2).
    expect(BRAHMA_ACCURACY_RULE).toContain('an inference is not an invention')
    expect(BRAHMA_WRITING_ACCURACY_RULE).toContain('never from invention')
  })
})

describe('console code stays off the story latitude', () => {
  const ROOT = process.cwd()
  const CONSOLE_DIRS = [
    'lib/brahma-console',
    'lib/services/brahma-console',
    'lib/services/console-engine',
    'lib/console-engine',
    'lib/services/calliope',
    'lib/calliope',
    'lib/services/help-chat',
    'lib/help-chat',
    'lib/services/agent-loop',
    'lib/research',
  ]
  const FORBIDDEN = /story-character-section|carina\/reference-query|['"]\.\/reference-query['"]/

  function walk(dir: string, out: string[]): void {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
    }
  }

  it('imports neither the section nor the Carina reference-query block', () => {
    const files: string[] = []
    for (const dir of CONSOLE_DIRS) walk(path.join(ROOT, dir), files)
    expect(files.length).toBeGreaterThan(0)

    const offenders = files
      .filter((file) =>
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .some((line) => /\b(import|require)\b/.test(line) && FORBIDDEN.test(line)),
      )
      .map((file) => path.relative(ROOT, file))

    expect(offenders).toEqual([])
  })
})
