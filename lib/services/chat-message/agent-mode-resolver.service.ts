/**
 * Agent Mode Resolver Service
 *
 * Handles resolving agent mode settings through the cascade:
 * Global ChatSettings → Character → Project → Chat
 *
 * Also provides system prompt instructions for agent mode behavior.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import type { ChatMetadata, Character, Project, ChatSettings } from '@/lib/schemas/types'
import type { AgentModeSettings } from '@/lib/schemas/settings.types'

const logger = createServiceLogger('AgentModeResolverService')

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
 * @param character The primary character (may have defaultAgentModeEnabled)
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
  }

  logger.info('[AgentMode] Resolved agent mode', {
    chatId: chat?.id,
    ...result,
  })

  return result
}

/**
 * Build the agent mode system prompt instructions
 *
 * These instructions guide the LLM on how to behave in agent mode,
 * including when and how to use the submit_final_response tool.
 *
 * @param maxTurns Maximum turns before forced final response
 * @returns System prompt text to inject
 */
export function buildAgentModeInstructions(maxTurns: number): string {
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
 * Build the "force final" system message
 *
 * This message is sent when the max turns limit is reached to prompt
 * the LLM to call submit_final_response with its best answer.
 *
 * @returns System message to force final response
 */
export function buildForceFinalMessage(): string {
  return `You have reached the maximum number of agent turns. Please call the submit_final_response tool NOW with your best answer based on the information you have gathered. Do not call any other tools - only submit_final_response.`
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
