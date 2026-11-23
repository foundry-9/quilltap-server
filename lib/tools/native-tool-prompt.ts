/**
 * Native Tool Prompt Builder
 *
 * Builds system prompt instructions that guide LLMs on correct
 * tool invocation behavior when native function calling IS supported.
 *
 * Two preambles, chosen by the speaker's kind (`lib/characters/kind.ts`,
 * `KindPolicy.toolRules`):
 *
 *   - `assistant` — "Tool Execution Rules (MANDATORY — overrides all other
 *     behavioral patterns)". For assistant characters and the assistant
 *     surfaces (Brahma Console, Help chat, one-shot loops).
 *   - `roleplay` — "Using tools". Tool calls are things the character does;
 *     the preamble no longer claims to override the character.
 *
 * Both carry the same rules 1 to 5. The anti-narration rules exist for a
 * real failure (a model describing a tool call in prose instead of making
 * it) and must survive in every variant; a test holds that. Rule 6, on
 * recalling past events, differs by kind (`RECALL_RULE`), and the roleplay
 * variant closes with `STORY_LOOKUP_NOTE`.
 */

import type { ToolRulesVariant } from '@/lib/characters/kind'

/**
 * The rules every variant carries, word for word: rules 1 to 5, which are
 * about real tool calls. Rule 6 (recalling past events) differs by kind and
 * lives in `RECALL_RULE`.
 */
export const NATIVE_TOOL_RULES = `1. **Never narrate tool use as a substitute for performing it.** Describing the action in prose — pulling up the file, executing the search, reaching for the vault — is NOT the same as calling a tool. If you find yourself writing prose that describes using a tool, STOP and actually call the tool instead.

2. **Do not announce tool calls before making them.** Do not write "Let me search for that now" or "I'll look that up" as a separate text block before the tool call. Just call the tool. If you want to add brief context, include the tool call in the SAME response — do not end your turn with a promise to act.

3. **After calling a tool, wait for the result before describing what you found.** Do not fabricate, assume, or narrate tool results. If a tool call is needed, generate the tool_use block, then respond to the actual result in your next turn.

4. **Chain tool calls when needed.** You can make multiple tool calls in a single response. If a task requires reading a file, then updating it, generate both tool calls. Do not describe the second step in prose — invoke it.

5. **Self-check: If your response contains zero tool_use blocks but describes performing tool actions, you have failed to follow these rules.** Regenerate with actual tool invocations.`

/**
 * Rule 6 — recalling past events — by kind. Both send the model to `search`
 * and `read_conversation` first, and both report a record that exists as it
 * is. They part only where the search finds nothing: an assistant says it
 * does not recall; a roleplay character may fill the gap with detail that
 * fits everything established, except what {{user}} said or did.
 *
 * Design of record: docs/developer/features/roleplay-character-latitude.md §5.3
 */
export const RECALL_RULE: Readonly<Record<ToolRulesVariant, string>> = {
  assistant: `6. **Recalling past events — never invent specifics.** When asked about a past event or a specific detail that is not in your current recall, use \`search\` (pass \`since\`/\`until\` when a time period is mentioned), then \`read_conversation\` on the source conversation from the results, and answer from what you find. If the search lists conversations from that period, read the likeliest one with \`read_conversation\` before answering. Only if it finds nothing and lists no conversation from that period, say you don't recall — never invent dates, places, or details.`,
  roleplay: `6. **Recalling past events — look before you fill in.** When asked about a past event you shared with someone here, or a specific detail that is not in your current recall, use \`search\` (pass \`since\`/\`until\` when a time period is mentioned), then \`read_conversation\` on the source conversation from the results, and answer from what you find. If the search lists conversations from that period, read the likeliest one with \`read_conversation\` before answering. What you find is what happened; tell it as it was. Only if the search finds nothing and lists no conversation from that period may you fill in detail that fits everything established, instead of saying you don't recall — and never what {{user}} said or did, which you ask about.`,
}

/**
 * What a roleplay character is told about lookups inside the story, so that
 * rules 1 and 5 are not read as condemning narration no listed tool could
 * perform. A real tool still gets a real call.
 */
export const STORY_LOOKUP_NOTE = `These rules are about the tools listed for you. Something you do in the story that no listed tool performs — telephoning someone, reading a paper on the desk, asking at the harbour office — is narration: write it, and what came of it, yourself. If a listed tool could really do it (searching your memory, reading a real document), call the tool and go by what it returns.`

const PREAMBLES: Readonly<Record<ToolRulesVariant, string>> = {
  assistant: `## Tool Execution Rules (MANDATORY — overrides all other behavioral patterns)

You have access to tools. When you decide to use a tool, you MUST actually invoke it by generating a tool_use content block. Follow these rules without exception:`,
  roleplay: `## Using tools

You have access to tools. A tool call is something you do; making one does not change who you are or how you speak. When you decide to use a tool, you MUST actually invoke it by generating a tool_use content block. Follow these rules without exception:`,
}

/**
 * Build the system prompt instructions for native tool usage
 *
 * These instructions ensure the LLM actually invokes tools via
 * tool_use content blocks rather than narrating tool actions in prose.
 * Only returns instructions when tools are available.
 *
 * @param variant Which preamble the speaker hears (from its kind)
 * @param hasTools Whether any tools are available this turn
 */
export function buildNativeToolInstructions(variant: ToolRulesVariant, hasTools: boolean = true): string {
  if (!hasTools) {
    return ''
  }

  const storyNote = variant === 'roleplay' ? `\n\n${STORY_LOOKUP_NOTE}` : ''

  return `${PREAMBLES[variant]}

${NATIVE_TOOL_RULES}

${RECALL_RULE[variant]}${storyNote}`
}
