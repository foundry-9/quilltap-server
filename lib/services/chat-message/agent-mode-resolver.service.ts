/**
 * Agent Mode Resolver Service
 *
 * Handles resolving agent mode settings through the cascade:
 * Global ChatSettings → Character → Project → Chat
 *
 * The cascade decides only whether Agent Mode is on. What it means — its
 * flavour — comes from the responding character's kind
 * (`lib/characters/kind.ts`): a roleplay character acts in the scene
 * (`in-character`), an assistant researches and reports (`research`). The
 * Brahma Console, the Help chat and the one-shot loops are assistants by
 * construction and always pass `research`.
 *
 * Also provides system prompt instructions for agent mode behavior.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import type { ChatMetadata, Character, Project, ChatSettings } from '@/lib/schemas/types'
import type { AgentModeSettings } from '@/lib/schemas/settings.types'
import { characterKindPolicy, type AgentModeFlavor } from '@/lib/characters/kind'

const logger = createServiceLogger('AgentModeResolverService')

/**
 * What the agent-mode instructions are for: a character's kind-derived flavor,
 * or `'writing'` — the Brahma Console's Writing Assistant, whose final answer
 * is the finished piece and nothing else.
 */
export type AgentInstructionKind = AgentModeFlavor | 'writing'

/** The Writing Assistant's "finish now" instruction (forced final turn and stuck-loop nudge). */
export const WRITING_FINISH_NOW =
  'Stop researching and do not call any more tools except submit_final_response. Call the submit_final_response tool NOW with the finished piece and nothing else: no preamble, no notes, no account of what you read.'

/**
 * Resolved agent mode state
 */
export interface ResolvedAgentMode {
  /** Whether agent mode is enabled */
  enabled: boolean
  /** Maximum number of turns before forcing final response */
  maxTurns: number
  /** Where the enabled setting came from */
  enabledSource: 'global' | 'character' | 'project' | 'chat'
  /** What Agent Mode means for the responding character (from its kind) */
  flavor: AgentModeFlavor
}

/**
 * Default agent mode settings when not configured
 */
export const DEFAULT_AGENT_MODE_SETTINGS: AgentModeSettings = {
  maxTurns: 10,
  defaultEnabled: false,
}

/**
 * Resolve the effective agent mode setting through the cascade:
 * Global → Character → Project → Chat
 *
 * Each level can override the previous if it has an explicit setting (not null).
 *
 * @param chat The chat metadata (may have agentModeEnabled)
 * @param project The project (may have defaultAgentModeEnabled)
 * @param character The responding character (may have defaultAgentModeEnabled; its kind sets the flavour)
 * @param globalSettings The global chat settings (has agentModeSettings)
 * @returns The resolved agent mode state
 */
export function resolveAgentModeSetting(
  chat: ChatMetadata | null,
  project: Project | null,
  character: Character | null,
  globalSettings: ChatSettings | null
): ResolvedAgentMode {
  // Start with global settings
  const agentModeSettings = globalSettings?.agentModeSettings ?? DEFAULT_AGENT_MODE_SETTINGS
  let enabled = agentModeSettings.defaultEnabled
  let enabledSource: 'global' | 'character' | 'project' | 'chat' = 'global'
  const maxTurns = agentModeSettings.maxTurns

  // Character level override (if explicitly set)
  if (character?.defaultAgentModeEnabled !== null && character?.defaultAgentModeEnabled !== undefined) {
    enabled = character.defaultAgentModeEnabled
    enabledSource = 'character'
  }

  // Project level override (if explicitly set)
  if (project?.defaultAgentModeEnabled !== null && project?.defaultAgentModeEnabled !== undefined) {
    enabled = project.defaultAgentModeEnabled
    enabledSource = 'project'
  }

  // Chat level override (if explicitly set)
  if (chat?.agentModeEnabled !== null && chat?.agentModeEnabled !== undefined) {
    enabled = chat.agentModeEnabled
    enabledSource = 'chat'
  }

  const result: ResolvedAgentMode = {
    enabled,
    maxTurns,
    enabledSource,
    flavor: characterKindPolicy(character).agentFlavor,
  }

  logger.info('[AgentMode] Resolved agent mode', {
    chatId: chat?.id,
    ...result,
  })

  return result
}

/**
 * Build the agent mode system prompt instructions.
 *
 * `research` guides the assistant's loop, including when and how to use the
 * submit_final_response tool. `in-character` tells a roleplay character that
 * its tools are things it does in the scene, and that the turn is still
 * written in character, as prose; that flavour is never offered
 * submit_final_response.
 *
 * @param maxTurns Maximum turns before forced final response
 * @param flavor What Agent Mode means for this caller
 * @returns System prompt text to inject
 */
export function buildAgentModeInstructions(maxTurns: number, flavor: AgentInstructionKind): string {
  if (flavor === 'writing') {
    return `
## Agent Mode Instructions

You may use tools iteratively to research the piece before you write it: search, read and query as much as the request calls for. You have up to **${maxTurns} tool iterations**; when you reach the limit you will be asked to finish at once.

When the piece is ready, call the \`submit_final_response\` tool with the finished piece and nothing else in its \`response\` parameter — no preamble, no notes, no account of your research. If you do not call it, your last message without tool calls is taken as the piece, so it too must be the finished piece and nothing else. Do NOT call other tools after \`submit_final_response\`.
`.trim()
  }
  if (flavor === 'in-character') {
    return `
## Acting in the scene

You can use tools this turn, and you may use several in a row when the moment calls for it. Your tools are things you do in the story: looking something up, checking a record, moving an object, sending word to someone. Use them when you would, for your own reasons, and not because they are there.

When you have done what you meant to do, write your turn as you always do: in character, in prose. Do not summarize what you did, report results as a list, or address anyone outside the story.

You have up to **${maxTurns} tool steps** this turn.
`.trim()
  }

  return `
## Agent Mode Instructions

You are operating in **Agent Mode**. This means you should:

1. **Use tools iteratively** to gather information, verify results, and refine your understanding before answering
2. **Think step-by-step** and use multiple tool calls when needed to build a comprehensive answer
3. **Verify your work** by checking results and correcting any errors you discover
4. **Submit your final answer** using the \`submit_final_response\` tool **only** when you have completed multi-step agentic work this turn that warrants a structured summary

### Important Guidelines:
- You have up to **${maxTurns} tool iterations** before you must submit your final response
- Each time you use a tool counts as one iteration
- When you reach the limit, you will be prompted to submit your final response immediately
- Do NOT call other tools after calling \`submit_final_response\`
- The \`response\` parameter should contain your complete, well-formatted answer

### When to Submit — and When NOT To:
- **Submit** when you have done real agentic work this turn (multi-step research, file edits, verification) and the user needs a structured summary of what you did.
- **Do NOT submit** if the user's message is conversational, relational, or a simple follow-up — just respond in character with natural prose. You may still use tools like memory search to inform that reply; agent mode availability does not mean every turn must end in \`submit_final_response\`.
- **Do NOT submit** just to re-summarize or wrap up work from a previous turn that already concluded. Each turn stands on its own.
- If uncertain between submitting and replying conversationally, prefer the natural prose reply.

### Response Format:
When you do submit, your final response should be polished and ready for the user to read. Include all relevant information from your tool use, formatted clearly. Otherwise, reply as you normally would — in character, as prose.
`.trim()
}

/**
 * Build the "force final" message sent when the max turns limit is reached.
 *
 * `research` prompts the LLM to call submit_final_response with its best
 * answer. `in-character` has no such tool: it tells the character to stop
 * using tools and write the turn.
 *
 * @param flavor What Agent Mode means for this caller
 * @returns Message to force the final response
 */
export function buildForceFinalMessage(flavor: AgentInstructionKind): string {
  if (flavor === 'writing') {
    return WRITING_FINISH_NOW
  }
  if (flavor === 'in-character') {
    return `You have used every tool step you have this turn. Do not call any more tools. Write your turn now, in character and in prose, from what you have found and done.`
  }
  return `You have reached the maximum number of agent turns. Please call the submit_final_response tool NOW with your best answer based on the information you have gathered. Do not call any other tools - only submit_final_response.`
}

/**
 * Extract the response text from a `submit_final_response` payload that a model
 * emitted as plain text instead of a proper tool call — e.g. some models output
 * the tool arguments as raw JSON: `{"response":"actual content here"}`. Returns
 * the inner `response` string when the text is exactly such a payload, otherwise
 * the original text unchanged.
 */
export function extractSubmitFinalResponseFromText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{"response"')) return text
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed?.response === 'string' && parsed.response.length > 0) {
      return parsed.response
    }
  } catch {
    /* not valid JSON — fall through and return the original text */
  }
  return text
}

/**
 * Generate a summary of an agent iteration for collapsing in the UI
 *
 * This function creates a brief summary of what happened during an agent iteration,
 * suitable for display in a collapsed state in the chat UI.
 *
 * @param iterationNumber The iteration number (1-indexed)
 * @param toolsUsed List of tool names that were called
 * @param contentPreview Preview of the LLM's content (if any)
 * @returns A brief summary string
 */
export function generateIterationSummary(
  iterationNumber: number,
  toolsUsed: string[],
  contentPreview?: string
): string {
  if (toolsUsed.length === 0) {
    return `Turn ${iterationNumber}: Thinking...`
  }

  const toolList = toolsUsed.join(', ')

  if (toolsUsed.length === 1) {
    return `Turn ${iterationNumber}: Used ${toolList}`
  }

  return `Turn ${iterationNumber}: Used ${toolsUsed.length} tools (${toolList})`
}
