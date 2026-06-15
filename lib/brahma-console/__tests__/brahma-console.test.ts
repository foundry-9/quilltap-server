/**
 * Unit tests for Brahma Console primitives:
 *  - the `isHelpLikeChatType` titling/summary predicate
 *  - the memory-free Brahma `search` tool schema + definition
 *  - the Brahma surface flags on the tool builder (net tool set)
 *
 * These are pure / construction-level checks — no LLM or repo mocking.
 */

import { isHelpLikeChatType } from '@/lib/schemas/chat.types'
import {
  searchScriptoriumToolInputSchema,
  searchScriptoriumBrahmaToolInputSchema,
  searchScriptoriumBrahmaToolDefinition,
} from '@/lib/tools/search-scriptorium-tool'
import { buildToolsForProvider } from '@/lib/tools/plugin-tool-builder'

/** Extract the function name from a built tool object regardless of provider shape. */
function toolName(tool: unknown): string | undefined {
  const t = tool as { function?: { name?: string }; name?: string }
  return t.function?.name || t.name
}

describe('isHelpLikeChatType', () => {
  it('treats help and brahma as help-like (lightweight titling/summary path)', () => {
    expect(isHelpLikeChatType('help')).toBe(true)
    expect(isHelpLikeChatType('brahma')).toBe(true)
  })

  it('does NOT treat salon, autonomous, null, or undefined as help-like', () => {
    expect(isHelpLikeChatType('salon')).toBe(false)
    expect(isHelpLikeChatType('autonomous')).toBe(false)
    expect(isHelpLikeChatType(null)).toBe(false)
    expect(isHelpLikeChatType(undefined)).toBe(false)
  })
})

describe('Brahma search tool schema — no memories', () => {
  it('rejects the "memories" source', () => {
    expect(
      searchScriptoriumBrahmaToolInputSchema.safeParse({ query: 'x', sources: ['memories'] }).success
    ).toBe(false)
  })

  it('accepts documents / conversations / knowledge', () => {
    expect(
      searchScriptoriumBrahmaToolInputSchema.safeParse({ query: 'x', sources: ['documents', 'conversations', 'knowledge'] }).success
    ).toBe(true)
  })

  it('the standard (non-Brahma) search schema still allows memories', () => {
    expect(
      searchScriptoriumToolInputSchema.safeParse({ query: 'x', sources: ['memories'] }).success
    ).toBe(true)
  })

  it('the Brahma tool definition keeps the tool name `search` and exposes no `memories` enum value', () => {
    expect(searchScriptoriumBrahmaToolDefinition.function.name).toBe('search')
    const paramsJson = JSON.stringify(searchScriptoriumBrahmaToolDefinition.function.parameters)
    expect(paramsJson).not.toContain('"memories"')
  })
})

describe('buildToolsForProvider — Brahma surface flags', () => {
  it('strips workspace tools, keeps search (no-memories) + doc_* + submit_final_response', async () => {
    const tools = await buildToolsForProvider('OPENAI', {
      agentMode: true,
      documentEditing: true,
      includeWorkspaceTools: false,
      excludeMemorySearch: true,
      rng: false,
      state: false,
      includePluginTools: false,
    })
    const names = tools.map(toolName)

    // Present: the Brahma net tool set
    expect(names).toContain('search')
    expect(names).toContain('doc_read_file')
    expect(names).toContain('doc_write_file')
    expect(names).toContain('submit_final_response')

    // Stripped: the always-on workspace tools
    expect(names).not.toContain('send_mail')
    expect(names).not.toContain('list_email')
    expect(names).not.toContain('read_conversation')
    expect(names).not.toContain('upsert_annotation')
    expect(names).not.toContain('delete_annotation')
    expect(names).not.toContain('terminal_list')
    expect(names).not.toContain('terminal_read')
    expect(names).not.toContain('self_inventory')
    expect(names).not.toContain('rng')
    expect(names).not.toContain('state')

    // The search tool present is the memory-free Brahma variant.
    const search = tools.find(t => toolName(t) === 'search') as { function: { parameters: unknown } }
    expect(JSON.stringify(search.function.parameters)).not.toContain('"memories"')
  })

  it('a character surface (workspace tools on, standard search) keeps the memory source', async () => {
    const tools = await buildToolsForProvider('OPENAI', {
      includePluginTools: false,
    })
    const names = tools.map(toolName)
    expect(names).toContain('search')
    expect(names).toContain('send_mail')
    const search = tools.find(t => toolName(t) === 'search') as { function: { parameters: unknown } }
    expect(JSON.stringify(search.function.parameters)).toContain('"memories"')
  })
})
