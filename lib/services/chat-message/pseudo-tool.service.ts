/**
 * Pseudo-Tool Service
 *
 * Handles pseudo-tool logic for models without native function calling support.
 * Parses text-based tool markers and converts them to standard tool calls.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  shouldUsePseudoTools,
  buildPseudoToolInstructions,
  parsePseudoToolCalls,
  convertToToolCallRequest,
  stripPseudoToolMarkers,
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
