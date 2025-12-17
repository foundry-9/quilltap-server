/**
 * Pseudo-Tool Prompt Builder
 *
 * Builds system prompt instructions that teach LLMs how to use text-based
 * tool markers when native function calling is not supported.
 */

import { logger } from '@/lib/logger'

/**
 * Options for which tools are enabled
 */
export interface PseudoToolOptions {
  /** Enable memory search tool */
  memorySearch?: boolean
  /** Enable image generation tool */
  imageGeneration?: boolean
  /** Enable web search tool */
  webSearch?: boolean
}

/**
 * Build the system prompt instructions for pseudo-tool usage
 *
 * These instructions teach the LLM to use [TOOL:name]...[/TOOL] markers
 * in their responses when they want to invoke a tool.
 */
export function buildPseudoToolInstructions(options: PseudoToolOptions): string {
  const toolDocs: string[] = []

  // Memory search tool
  if (options.memorySearch !== false) {
    toolDocs.push(`
### Memory Search
Search your memories for information about past conversations, preferences, or facts you've learned about the user.
Format: [TOOL:memory]what to search for[/TOOL]
Example: [TOOL:memory]user's favorite food[/TOOL]
Example: [TOOL:memory]what we discussed last time[/TOOL]`)
  }

  // Image generation tool
  if (options.imageGeneration) {
    toolDocs.push(`
### Image Generation
Generate an image to show in the conversation. Describe the image in detail.
Format: [TOOL:image]detailed description of the image[/TOOL]
Example: [TOOL:image]a cozy coffee shop on a rainy day, warm lighting, steaming cup of coffee on a wooden table[/TOOL]
Example: [TOOL:image]portrait of a majestic wolf in a snowy forest, moonlight[/TOOL]`)
  }

  // Web search tool
  if (options.webSearch) {
    toolDocs.push(`
### Web Search
Search the web for current information that isn't in your training data.
Format: [TOOL:search]search query[/TOOL]
Example: [TOOL:search]latest news about space exploration[/TOOL]
Example: [TOOL:search]current weather in Tokyo[/TOOL]`)
  }

  // If no tools enabled, return empty string
  if (toolDocs.length === 0) {
    return ''
  }

  const instructions = `
## Available Tools

You can use the following tools by including special markers in your response. When you want to use a tool, write the marker and I will execute the tool and provide you with the results.
${toolDocs.join('\n')}

## Tool Usage Instructions
- Place tool markers naturally in your response where you want to use the tool
- You may use multiple tools in a single response
- After using a tool, I will provide the results, then you can continue your response
- Only use tools when they would genuinely help answer the question or enhance the conversation
- Don't use tools unnecessarily - only when you actually need the information or capability
`

  logger.debug('[PseudoToolPrompt] Built pseudo-tool instructions', {
    enabledTools: [
      options.memorySearch !== false ? 'memory' : null,
      options.imageGeneration ? 'image' : null,
      options.webSearch ? 'search' : null,
    ].filter(Boolean),
  })

  return instructions.trim()
}
