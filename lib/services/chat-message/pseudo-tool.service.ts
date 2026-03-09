/**
 * Tool Mode Support Service
 *
 * Handles tool mode determination and instructions for models with and without
 * native function calling support. Provides text-block tool support for models
 * that lack native function calling.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  shouldUseTextBlockTools,
  buildNativeToolInstructions,
  parseTextBlockCalls,
  convertTextBlockToToolCallRequest,
  stripTextBlockMarkers,
  buildTextBlockInstructions,
  type ToolMode,
  type TextBlockPromptOptions,
} from '@/lib/tools'

const logger = createServiceLogger('ToolModeService')

/**
 * Tool options for enabling/disabling specific tools
 */
export interface EnabledToolOptions {
  imageGeneration: boolean
  memorySearch: boolean
  webSearch: boolean
}

/**
 * Build native tool instructions to inject into system prompt
 * Guides models with native function calling to actually invoke tools
 * rather than narrating tool usage in prose.
 */
export function buildNativeToolSystemInstructions(): string {
  return buildNativeToolInstructions(true)
}

/**
 * Determine enabled tool options based on chat configuration
 */
export function determineEnabledToolOptions(
  imageProfileId: string | null,
  allowWebSearch: boolean
): EnabledToolOptions {
  return {
    imageGeneration: !!imageProfileId,
    memorySearch: true, // Always enable memory search
    webSearch: allowWebSearch,
  }
}

// ============================================================================
// Text-Block Tool Support
// ============================================================================

/**
 * Check if text-block tools should be used for a model
 */
export function checkShouldUseTextBlockTools(
  modelSupportsNativeTools: boolean,
  profileOverride?: ToolMode
): boolean {
  return shouldUseTextBlockTools(modelSupportsNativeTools, profileOverride)
}

/**
 * Extended tool options for text-block mode (supports all tools)
 */
export interface TextBlockEnabledToolOptions extends EnabledToolOptions {
  whisper: boolean
  state: boolean
  rng: boolean
  fileManagement: boolean
  projectInfo: boolean
  helpSearch: boolean
  createNote: boolean
}

/**
 * Determine enabled text-block tool options based on chat configuration
 */
export function determineTextBlockToolOptions(
  imageProfileId: string | null,
  allowWebSearch: boolean,
  isMultiCharacter: boolean,
  hasProject: boolean,
): TextBlockEnabledToolOptions {
  return {
    imageGeneration: !!imageProfileId,
    memorySearch: true,
    webSearch: allowWebSearch,
    whisper: isMultiCharacter,
    state: true,
    rng: true,
    fileManagement: hasProject,
    projectInfo: hasProject,
    helpSearch: true,
    createNote: true,
  }
}

/**
 * Build text-block tool instructions to inject into system prompt
 */
export function buildTextBlockSystemInstructions(
  enabledOptions: TextBlockEnabledToolOptions
): string {
  const options: TextBlockPromptOptions = {
    whisper: enabledOptions.whisper,
    memorySearch: enabledOptions.memorySearch,
    imageGeneration: enabledOptions.imageGeneration,
    webSearch: enabledOptions.webSearch,
    state: enabledOptions.state,
    rng: enabledOptions.rng,
    fileManagement: enabledOptions.fileManagement,
    projectInfo: enabledOptions.projectInfo,
    helpSearch: enabledOptions.helpSearch,
    createNote: enabledOptions.createNote,
  }
  return buildTextBlockInstructions(options)
}

/**
 * Parse text-block tool calls from response text
 */
export function parseTextBlocksFromResponse(
  response: string
): Array<{ name: string; arguments: Record<string, unknown> }> {
  const textBlockCalls = parseTextBlockCalls(response)

  if (textBlockCalls.length > 0) {
    logger.info('Detected text-block tool markers in response', {
      count: textBlockCalls.length,
      tools: textBlockCalls.map(p => p.toolName),
    })
  }

  return textBlockCalls.map(convertTextBlockToToolCallRequest)
}

/**
 * Strip text-block markers from response for storage/display
 */
export function stripTextBlockMarkersFromResponse(response: string): string {
  return stripTextBlockMarkers(response)
}

/**
 * Log text-block tool usage info
 */
export function logTextBlockToolUsage(
  provider: string,
  model: string,
  enabledTools: TextBlockEnabledToolOptions
): void {
  logger.info('Using text-block tools (rich text-based tool invocation)', {
    provider,
    model,
    enabledTools: Object.entries(enabledTools)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
  })
}
