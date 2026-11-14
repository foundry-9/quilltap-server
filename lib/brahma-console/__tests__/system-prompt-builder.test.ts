/**
 * Unit tests for the Brahma Console system-prompt builder — specifically the
 * `includeSqlAccess` toggle that appends the read-only SQL-access section.
 *
 * Pure construction-level checks; no LLM or repo mocking.
 */

import { buildBrahmaSystemPrompt, BRAHMA_WRITING_ASSISTANT_BRIEF } from '../system-prompt-builder'
import { BRAHMA_SQL_PROMPT } from '../brahma-sql-prompt'
import type { ConnectionProfile } from '@/lib/schemas/types'

const PROFILE = { id: 'c1', provider: 'openai', modelName: 'gpt-4o' } as unknown as ConnectionProfile

describe('buildBrahmaSystemPrompt — includeSqlAccess', () => {
  it('appends the SQL-access section when includeSqlAccess is true', () => {
    const prompt = buildBrahmaSystemPrompt({ profile: PROFILE, includeSqlAccess: true })
    expect(prompt).toContain(BRAHMA_SQL_PROMPT)
    expect(prompt).toContain('run_sql')
  })

  it('omits the SQL-access section by default', () => {
    const prompt = buildBrahmaSystemPrompt({ profile: PROFILE })
    expect(prompt).not.toContain(BRAHMA_SQL_PROMPT)
    expect(prompt).not.toContain('run_sql')
  })

  it('keeps the base "no persistent memory" guarantee alongside the SQL section', () => {
    const prompt = buildBrahmaSystemPrompt({ profile: PROFILE, includeSqlAccess: true })
    expect(prompt).toMatch(/no persistent memory/i)
    // The SQL section resolves the apparent tension explicitly.
    expect(prompt).toMatch(/inspection, not recall/i)
  })

  it('orders the SQL section before the tool instructions', () => {
    const prompt = buildBrahmaSystemPrompt({
      profile: PROFILE,
      includeSqlAccess: true,
      toolInstructions: 'TOOL_INSTRUCTIONS_MARKER',
    })
    expect(prompt.indexOf(BRAHMA_SQL_PROMPT)).toBeLessThan(prompt.indexOf('TOOL_INSTRUCTIONS_MARKER'))
  })
})

describe('buildBrahmaSystemPrompt — Writing Assistant', () => {
  const MANIFEST = '## Sources for this piece\n\nMANIFEST_MARKER'

  it('replaces the ordinary brief with the writing brief', () => {
    const prompt = buildBrahmaSystemPrompt({ profile: PROFILE, writingAssistant: true })
    expect(prompt.startsWith(BRAHMA_WRITING_ASSISTANT_BRIEF)).toBe(true)
    expect(prompt).not.toContain('Speak plainly and helpfully in your own voice')
    expect(prompt).toMatch(/You cannot write to any store/)
  })

  it('orders brief, manifest, SQL section, tool instructions', () => {
    const prompt = buildBrahmaSystemPrompt({
      profile: PROFILE,
      writingAssistant: true,
      contextManifest: MANIFEST,
      includeSqlAccess: true,
      toolInstructions: 'TOOL_INSTRUCTIONS_MARKER',
    })
    const order = [
      prompt.indexOf(BRAHMA_WRITING_ASSISTANT_BRIEF),
      prompt.indexOf('MANIFEST_MARKER'),
      prompt.indexOf(BRAHMA_SQL_PROMPT),
      prompt.indexOf('TOOL_INSTRUCTIONS_MARKER'),
    ]
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('adds nothing for an empty manifest', () => {
    const withEmpty = buildBrahmaSystemPrompt({ profile: PROFILE, writingAssistant: true, contextManifest: '' })
    const without = buildBrahmaSystemPrompt({ profile: PROFILE, writingAssistant: true })
    expect(withEmpty).toBe(without)
  })

  it('ignores a manifest outside Writing Assistant mode', () => {
    const prompt = buildBrahmaSystemPrompt({ profile: PROFILE, contextManifest: MANIFEST })
    expect(prompt).not.toContain('MANIFEST_MARKER')
  })

  it('leaves the ordinary prompt byte-identical (golden)', () => {
    expect(buildBrahmaSystemPrompt({
      profile: PROFILE,
      includeSqlAccess: true,
      toolInstructions: 'TOOL_INSTRUCTIONS_MARKER',
    })).toMatchSnapshot()
  })
})
