/**
 * Pseudo-Tool Service
 *
 * Handles pseudo-tool logic for models without native function calling support.
 * Parses text-based tool markers and converts them to standard tool calls.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  shouldUsePseudoTools,
  shouldUseTextBlockTools,
  buildPseudoToolInstructions,
  buildNativeToolInstructions,
  parsePseudoToolCalls,
  convertToToolCallRequest,
  stripPseudoToolMarkers,
  parseTextBlockCalls,
  convertTextBlockToToolCallRequest,
  stripTextBlockMarkers,
  buildTextBlockInstructions,
  type ToolMode,
  type TextBlockPromptOptions,
} from '@/lib/tools'

const logger = createServiceLogger('PseudoToolService')

/**
 * Tool options for enabling/disabling specific tools
 */
export interface EnabledToolOptions {
  imageGeneration: boolean
  memorySearch: boolean
  webSearch: boolean
}

/**
 * Parsed pseudo-tool call
 */
export interface PseudoToolCall {
  name: string
  arguments: Record<string, unknown>
}

/**
 * Check if pseudo-tools should be used for a model
 */
export function checkShouldUsePseudoTools(modelSupportsNativeTools: boolean): boolean {
  return shouldUsePseudoTools(modelSupportsNativeTools)
}

/**
 * Build pseudo-tool instructions to inject into system prompt
 */
export function buildPseudoToolSystemInstructions(
  enabledToolOptions: EnabledToolOptions
): string {
  return buildPseudoToolInstructions(enabledToolOptions)
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
 * Parse pseudo-tool calls from response text
 */
export function parsePseudoToolsFromResponse(
  response: string
): Array<{ name: string; arguments: Record<string, unknown> }> {
  const pseudoToolCalls = parsePseudoToolCalls(response)

  if (pseudoToolCalls.length > 0) {
    logger.info('Detected pseudo-tool markers in response', {
      count: pseudoToolCalls.length,
      tools: pseudoToolCalls.map(p => p.toolName),
    })
  }

  return pseudoToolCalls.map(convertToToolCallRequest)
}

/**
 * Strip pseudo-tool markers from response for storage/display
 */
export function stripPseudoToolMarkersFromResponse(response: string): string {
  const strippedResponse = stripPseudoToolMarkers(response)

  return strippedResponse
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

/**
 * Log pseudo-tool usage info
 */
export function logPseudoToolUsage(
  provider: string,
  model: string,
  enabledTools: EnabledToolOptions
): void {
  logger.info('Using pseudo-tools (model does not support native function calling)', {
    provider,
    model,
    enabledTools: Object.entries(enabledTools)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
  })
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
