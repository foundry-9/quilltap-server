/**
 * The recall rule in the simple-JSON tool prompt, by kind
 * (docs/developer/features/roleplay-character-latitude.md §5.3).
 *
 * @jest-environment node
 */

import { SIMPLE_JSON_RECALL_RULE, buildSimpleJsonToolInstructions } from '@/lib/tools/simple-json-prompt'
import { STORY_LOOKUP_NOTE } from '@/lib/tools/native-tool-prompt'

describe('simple-json recall rule', () => {
  it('keeps the assistant rule byte-identical to the rule as it stood', () => {
    expect(SIMPLE_JSON_RECALL_RULE.assistant).toBe(
      "- Recalling past events: when asked about a past event or specific detail not in your current recall, use `search` (with `since`/`until` when a time period is mentioned), then `read_conversation` on the source conversation, and answer from what you find. If the search lists conversations from that period, read the likeliest one with `read_conversation` before answering. Only if it finds nothing and lists no conversation from that period, say you don't recall — never invent dates, places, or details.",
    )
  })

  it('defaults to the assistant rule', () => {
    const byDefault = buildSimpleJsonToolInstructions({ search: true })

    expect(byDefault).toBe(buildSimpleJsonToolInstructions({ search: true }, 'assistant'))
    expect(byDefault).toContain(SIMPLE_JSON_RECALL_RULE.assistant)
    expect(byDefault).not.toContain(STORY_LOOKUP_NOTE)
  })

  it('gives a roleplay character the search-first, fill-the-gap rule and the story-lookup note', () => {
    const prompt = buildSimpleJsonToolInstructions({ search: true }, 'roleplay')

    expect(prompt).toContain(SIMPLE_JSON_RECALL_RULE.roleplay)
    expect(prompt).toContain('What you find is what happened; tell it as it was.')
    expect(prompt).toContain('never what {{user}} said or did, which you ask about')
    expect(prompt).toContain(STORY_LOOKUP_NOTE)
    expect(prompt).not.toContain('never invent dates, places, or details')
  })

  it('differs between the kinds only in the recall rule', () => {
    const assistant = buildSimpleJsonToolInstructions({ search: true }, 'assistant')
    const roleplay = buildSimpleJsonToolInstructions({ search: true }, 'roleplay')

    expect(roleplay.replace(SIMPLE_JSON_RECALL_RULE.roleplay, SIMPLE_JSON_RECALL_RULE.assistant)).toBe(assistant)
  })
})
