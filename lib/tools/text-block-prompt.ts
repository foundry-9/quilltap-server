/**
 * Text-Block Prompt Builder
 *
 * Builds system prompt instructions that teach LLMs how to use text-block
 * tool markers when native function calling is not supported.
 *
 * Text-blocks support all tools (not just the 3 in legacy pseudo-tools),
 * named parameters, content blocks, and self-closing forms.
 */

import { logger } from '@/lib/logger'

/**
 * Options for which tools to document in the text-block instructions
 */
export interface TextBlockPromptOptions {
  /** Enable whisper (private messaging) tool */
  whisper?: boolean
  /** Enable search tool */
  search?: boolean
  /** Enable image generation tool */
  imageGeneration?: boolean
  /** Enable web search tool */
  webSearch?: boolean
  /** Enable state management tool */
  state?: boolean
  /** Enable RNG/dice tool */
  rng?: boolean
  /** Enable project info tool */
  projectInfo?: boolean
  /** Enable help search tool */
  helpSearch?: boolean
  /** Enable help settings tool */
  helpSettings?: boolean
  /** Enable help navigate tool */
  helpNavigate?: boolean
  /** Enable create note tool */
  createNote?: boolean
  /** Enable list wardrobe tool */
  wardrobeList?: boolean
  /** Enable update outfit item tool */
  wardrobeUpdateOutfit?: boolean
  /** Enable create wardrobe item tool */
  wardrobeCreateItem?: boolean
}

/**
 * Build the system prompt instructions for text-block tool usage.
 *
 * These instructions teach the LLM to use [[TOOL_NAME param="value"]]content[[/TOOL_NAME]]
 * markers in their responses when they want to invoke a tool.
 */
export function buildTextBlockInstructions(options: TextBlockPromptOptions): string {
  const toolDocs: string[] = []

  if (options.whisper) {
    toolDocs.push(`
### Whisper (Private Message)
Send a private message to a specific character that other characters won't see.
Format: [[WHISPER to="character name"]]your private message[[/WHISPER]]
Example: [[WHISPER to="Elena"]]I need to tell you something the others shouldn't hear.[[/WHISPER]]`)
  }

  if (options.search !== false) {
    toolDocs.push(`
### Search
Search the Scriptorium for information about past conversations, preferences, or facts.
Format: [[SEARCH]]what to search for[[/SEARCH]]
Example: [[SEARCH]]user's favorite food[[/SEARCH]]
Example: [[SEARCH limit="3"]]what we discussed about the garden[[/SEARCH]]`)
  }

  if (options.imageGeneration) {
    toolDocs.push(`
### Image Generation
Generate an image to show in the conversation. Describe the image in detail.
Format: [[GENERATE_IMAGE]]detailed description of the image[[/GENERATE_IMAGE]]
Example: [[GENERATE_IMAGE]]a cozy coffee shop on a rainy day, warm lighting, steaming cup of coffee on a wooden table[[/GENERATE_IMAGE]]`)
  }

  if (options.webSearch) {
    toolDocs.push(`
### Web Search
Search the web for current information that isn't in your training data.
Format: [[SEARCH_WEB]]search query[[/SEARCH_WEB]]
Example: [[SEARCH_WEB]]latest news about space exploration[[/SEARCH_WEB]]`)
  }

  if (options.state) {
    toolDocs.push(`
### State Management
Get or set persistent state values that survive across messages.
Format (get): [[STATE operation="get" key="hp" /]]
Format (set): [[STATE operation="set" key="hp" value="85" /]]
Format (list): [[STATE operation="list" /]]`)
  }

  if (options.rng) {
    toolDocs.push(`
### Dice / Random Number
Roll dice or generate random numbers.
Format: [[RNG type="d20" /]]
Format: [[RNG type="d6" count="3" /]]
Format: [[RNG type="number" min="1" max="100" /]]`)
  }

  if (options.projectInfo) {
    toolDocs.push(`
### Project Info
Get information about the current project — name, description, character roster, instructions.
Format: [[PROJECT_INFO action="get_info" /]]
Format: [[PROJECT_INFO action="get_instructions" /]]`)
  }

  if (options.helpSearch) {
    toolDocs.push(`
### Help Search
Search the help documentation for information about features and capabilities.
Format: [[HELP_SEARCH]]how do I use memories[[/HELP_SEARCH]]`)
  }

  if (options.helpSettings) {
    toolDocs.push(`
### Help Settings
Read instance settings to understand and assist with the current configuration. API keys are never shown.
Format: [[HELP_SETTINGS category="overview" /]]
Categories: overview, chat, connections, embeddings, images, appearance, templates, system`)
  }

  if (options.helpNavigate) {
    toolDocs.push(`
### Help Navigate
Navigate the user's browser to a specific Quilltap page or settings section.
Format: [[HELP_NAVIGATE url="/settings?tab=chat&section=dangerous-content" /]]`)
  }

  if (options.createNote) {
    toolDocs.push(`
### Create Note
Create a note to remember something for later.
Format: [[CREATE_NOTE title="Meeting Notes"]]content of the note[[/CREATE_NOTE]]`)
  }

  if (options.wardrobeList) {
    toolDocs.push(`
### List Wardrobe
Browse your wardrobe to see available clothing and outfits.
Format: [[WARDROBE /]]
With filters: [[WARDROBE type_filter="top" /]]`)
  }

  if (options.wardrobeUpdateOutfit) {
    toolDocs.push(`
### Equip/Remove Outfit Item
Change what you're wearing by equipping or removing items from outfit slots.
To equip: [[EQUIP slot="top" id="item-uuid" /]]
To equip by name: [[EQUIP slot="top" title="Charcoal Sweater" /]]
To remove: [[EQUIP slot="top" /]]`)
  }

  if (options.wardrobeCreateItem) {
    toolDocs.push(`
### Create Wardrobe Item
Design and add a new clothing item to your wardrobe, or gift one to another character.
Format: [[CREATE_WARDROBE_ITEM title="Red Scarf" types="accessories" appropriateness="casual"]]A soft crimson scarf with golden tassels[[/CREATE_WARDROBE_ITEM]]
Gift to another character: [[CREATE_WARDROBE_ITEM title="Red Scarf" types="accessories" recipient="CharacterName"]]A gift for you[[/CREATE_WARDROBE_ITEM]]`)
  }

  if (toolDocs.length === 0) {
    return ''
  }

  const instructions = `
## Available Tools

You can use the following tools by including special markers in your response. When you want to use a tool, write the marker exactly as shown and I will execute the tool and provide you with the results.

### Marker Format
- **With content:** [[TOOL_NAME param="value"]]content here[[/TOOL_NAME]]
- **Self-closing (no content):** [[TOOL_NAME param="value" /]]
- Parameter values must be in double quotes
- Tool names are case-insensitive
${toolDocs.join('\n')}

## Tool Usage Instructions
- Place tool markers naturally in your response where you want to use the tool
- You may use multiple tools in a single response
- After using a tool, I will provide the results, then you can continue your response
- Only use tools when they would genuinely help — don't use them unnecessarily
- Do NOT nest tool markers inside each other
`

  return instructions.trim()
}
