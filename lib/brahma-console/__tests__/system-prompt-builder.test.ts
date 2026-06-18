/**
 * Unit tests for the Brahma Console system-prompt builder — specifically the
 * `includeSqlAccess` toggle that appends the read-only SQL-access section.
 *
 * Pure construction-level checks; no LLM or repo mocking.
 */

import { buildBrahmaSystemPrompt } from '../system-prompt-builder'
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
