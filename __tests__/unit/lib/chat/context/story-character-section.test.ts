/**
 * The story-character section in the system prompt
 * (docs/developer/features/roleplay-character-latitude.md §5.1).
 *
 * Load-bearing, and tested here:
 *  - **Only a roleplay character hears it.** An assistant's builder returns ''
 *    and nothing is pushed, so an assistant's prompt carries no trace of it.
 *  - **Placement.** After the Taboo section and before the standing
 *    instructions, in the cacheable block 1 — not in the identity stack, so
 *    neither the stack's builder version nor its goldens move.
 *  - **The trust line.** Opposition to {{user}} is allowed; governance is not.
 *  - **Wording.** The text talks about the character, never about the model.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

import { buildSystemPrompt, buildIdentityStack } from '@/lib/chat/context/system-prompt-builder'
import {
  STORY_CHARACTER_SECTION,
  STORY_WORDING_FORBIDDEN,
  buildStoryCharacterSection,
} from '@/lib/chat/context/story-character-section'
import {
  SANITIZING_DRIFT_SIGNAL,
  STORY_LATITUDE_DIRECTION,
} from '@/lib/services/character-field-semantics'
import { ROLEPLAY_REFERENCE_QUERY_CLOSE } from '@/lib/services/carina/reference-query'
import { RECALL_RULE, STORY_LOOKUP_NOTE } from '@/lib/tools/native-tool-prompt'
import type { Character } from '@/lib/schemas/types'

const now = '2025-01-01T00:00:00.000Z'

const BASE = {
  id: 'char-1',
  name: 'Test Character',
  personality: 'Wary of strangers',
  systemPrompts: [
    { id: 'prompt-1', name: 'Default', content: 'You are a dockside clerk.', isDefault: true, createdAt: now, updatedAt: now },
  ],
  scenarios: [],
  createdAt: now,
  updatedAt: now,
}

const character = (extra: Record<string, unknown> = {}) => ({ ...BASE, ...extra }) as unknown as Character

const HEADING = '## Playing your part'
const user = { name: 'Sam', description: '' }

describe('buildStoryCharacterSection', () => {
  it('gives the section to a roleplay character, and to one with no kind recorded', () => {
    expect(buildStoryCharacterSection({ kind: 'roleplay' })).toBe(STORY_CHARACTER_SECTION)
    expect(buildStoryCharacterSection({})).toBe(STORY_CHARACTER_SECTION)
    expect(buildStoryCharacterSection(null)).toBe(STORY_CHARACTER_SECTION)
  })

  it('gives an assistant nothing', () => {
    expect(buildStoryCharacterSection({ kind: 'assistant' })).toBe('')
  })
})

describe('the story-character section in buildSystemPrompt', () => {
  it('appears once for a roleplay character, with {{user}} resolved', () => {
    const prompt = buildSystemPrompt({ character: character(), userCharacter: user })

    expect(prompt.split(HEADING)).toHaveLength(2)
    expect(prompt).toContain('what Sam has narrated')
    expect(prompt).toContain("This holds toward Sam's character too")
    expect(prompt.slice(prompt.indexOf(HEADING))).not.toContain('{{user}}')
  })

  it('is absent for an assistant', () => {
    const prompt = buildSystemPrompt({ character: character({ kind: 'assistant' }), userCharacter: user })

    expect(prompt).not.toContain(HEADING)
    expect(prompt).not.toContain('Fill in the world')
  })

  it('an assistant prompt is the roleplay prompt with only the section removed', () => {
    const options = { userCharacter: user, tabooPhrases: ['tapestry'], standingInstructions: 'Stay in the harbour district.' }
    const roleplay = buildSystemPrompt({ character: character(), ...options })
    const assistant = buildSystemPrompt({ character: character({ kind: 'assistant' }), ...options })

    const section = STORY_CHARACTER_SECTION.replace(/\{\{user\}\}/g, 'Sam')
    expect(roleplay).toContain(section)
    expect(roleplay.replace(`${section}\n\n`, '')).toBe(assistant)
  })

  it('sits after the Taboo section and before the standing instructions and tool rules', () => {
    const prompt = buildSystemPrompt({
      character: character(),
      userCharacter: user,
      tabooPhrases: ['tapestry'],
      standingInstructions: 'STANDING-MARKER stay in the harbour district.',
      toolInstructions: 'TOOL-MARKER call the tool.',
    })

    const taboo = prompt.indexOf('tapestry')
    const section = prompt.indexOf(HEADING)
    const standing = prompt.indexOf('STANDING-MARKER')
    const tools = prompt.indexOf('TOOL-MARKER')

    expect(taboo).toBeGreaterThan(-1)
    expect(section).toBeGreaterThan(taboo)
    expect(standing).toBeGreaterThan(section)
    expect(tools).toBeGreaterThan(standing)
  })

  it('is not part of the identity stack', () => {
    for (const kind of ['roleplay', 'assistant'] as const) {
      const stack = buildIdentityStack({ character: character({ kind }), userCharacter: user, scenarioText: null })
      expect(stack).not.toContain(HEADING)
    }
    const a = buildIdentityStack({ character: character({ kind: 'roleplay' }), userCharacter: user, scenarioText: null })
    const b = buildIdentityStack({ character: character({ kind: 'assistant' }), userCharacter: user, scenarioText: null })
    expect(a).toBe(b)
  })
})

describe('the section text', () => {
  it('states the three ideas and yields to the character\'s own prompt', () => {
    expect(STORY_CHARACTER_SECTION).toContain('**Fill in the world.**')
    expect(STORY_CHARACTER_SECTION).toContain('**Be who you are, including at your worst.**')
    expect(STORY_CHARACTER_SECTION).toContain('**Your own troubles come with you.**')
    expect(STORY_CHARACTER_SECTION.trimEnd().endsWith('Where your own character description says otherwise, it wins.')).toBe(true)
  })

  it('bounds invention by what is established and never writes {{user}}', () => {
    expect(STORY_CHARACTER_SECTION).toContain('Stay inside what is established')
    expect(STORY_CHARACTER_SECTION).toContain('all outrank what you make up')
    expect(STORY_CHARACTER_SECTION).toContain('You never decide what {{user}} did, said or felt.')
  })

  it('keeps the trust line: opposition yes, governance no', () => {
    expect(STORY_CHARACTER_SECTION).toContain('You still set them no terms, keep no tally of small slips, and dispute nothing {{user}} has narrated.')
  })

  it('keeps every sentence about bad behaviour conditional', () => {
    expect(STORY_CHARACTER_SECTION).toContain('If you are afraid')
    expect(STORY_CHARACTER_SECTION).toContain('If you distrust someone')
    expect(STORY_CHARACTER_SECTION).toContain('when that is who you are or what the story has given you cause for')
  })
})

describe('story-latitude wording', () => {
  const samplePrompt = fs.readFileSync(
    path.join(process.cwd(), 'plugins/dist/qtap-plugin-default-system-prompts/prompts/MODERN_ROLEPLAY.md'),
    'utf8',
  )

  const TEXTS: Array<[string, string]> = [
    ['STORY_CHARACTER_SECTION', STORY_CHARACTER_SECTION],
    ['STORY_LATITUDE_DIRECTION', STORY_LATITUDE_DIRECTION],
    ['SANITIZING_DRIFT_SIGNAL', SANITIZING_DRIFT_SIGNAL],
    ['ROLEPLAY_REFERENCE_QUERY_CLOSE', ROLEPLAY_REFERENCE_QUERY_CLOSE],
    ['RECALL_RULE.roleplay', RECALL_RULE.roleplay],
    ['STORY_LOOKUP_NOTE', STORY_LOOKUP_NOTE],
    ['MODERN_ROLEPLAY.md', samplePrompt],
  ]

  it.each(TEXTS)('%s talks about the character, never about the model or its limits', (_name, text) => {
    const lower = text.toLowerCase()
    const found = STORY_WORDING_FORBIDDEN.filter((phrase) => lower.includes(phrase))
    expect(found).toEqual([])
  })

  it('the forbidden list is lowercase, so the scan is case-insensitive', () => {
    for (const phrase of STORY_WORDING_FORBIDDEN) expect(phrase).toBe(phrase.toLowerCase())
  })
})
