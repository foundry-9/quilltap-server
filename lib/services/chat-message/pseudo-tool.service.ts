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
  resolveToolMode,
  buildNativeToolInstructions,
  parseTextBlockCalls,
  convertTextBlockToToolCallRequest,
  stripTextBlockMarkers,
  buildTextBlockInstructions,
  parseSimpleJsonCalls,
  convertSimpleJsonToToolCallRequest,
  stripSimpleJsonMarkers,
  hasSimpleJsonMarkers,
  buildSimpleJsonToolInstructions,
  escapeXmlAttribute,
  SIMPLE_JSON_STOP_SEQUENCES,
  type ToolMode,
  type ResolvedToolMode,
  type TextBlockPromptOptions,
  type SimpleJsonPromptOptions,
} from '@/lib/tools'

const logger = createServiceLogger('ToolModeService')

/**
 * Tool options for enabling/disabling specific tools
 */
export interface EnabledToolOptions {
  imageGeneration: boolean
  search: boolean
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
    search: true, // Always enable search
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
  projectInfo: boolean
  helpSearch: boolean
  helpSettings: boolean
  helpNavigate: boolean
  createNote: boolean
  wardrobeList: boolean
  wardrobeUpdateOutfit: boolean
  wardrobeChangeItem: boolean
  wardrobeCreateItem: boolean
}

/**
 * Determine enabled text-block tool options based on chat configuration
 */
export function determineTextBlockToolOptions(
  imageProfileId: string | null,
  allowWebSearch: boolean,
  isMultiCharacter: boolean,
  hasProject: boolean,
  helpToolsEnabled?: boolean,
  canDressThemselves?: boolean,
  canCreateOutfits?: boolean,
): TextBlockEnabledToolOptions {
  return {
    imageGeneration: !!imageProfileId,
    search: true,
    webSearch: allowWebSearch,
    whisper: isMultiCharacter,
    state: true,
    rng: true,
    projectInfo: hasProject,
    helpSearch: !!helpToolsEnabled,
    helpSettings: !!helpToolsEnabled,
    helpNavigate: !!helpToolsEnabled,
    createNote: true,
    wardrobeList: canDressThemselves !== false,
    wardrobeUpdateOutfit: canDressThemselves !== false,
    wardrobeChangeItem: canDressThemselves !== false,
    wardrobeCreateItem: canCreateOutfits !== false,
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
    search: enabledOptions.search,
    imageGeneration: enabledOptions.imageGeneration,
    webSearch: enabledOptions.webSearch,
    state: enabledOptions.state,
    rng: enabledOptions.rng,
    projectInfo: enabledOptions.projectInfo,
    helpSearch: enabledOptions.helpSearch,
    helpSettings: enabledOptions.helpSettings,
    helpNavigate: enabledOptions.helpNavigate,
    createNote: enabledOptions.createNote,
    wardrobeList: enabledOptions.wardrobeList,
    wardrobeUpdateOutfit: enabledOptions.wardrobeUpdateOutfit,
    wardrobeChangeItem: enabledOptions.wardrobeChangeItem,
    wardrobeCreateItem: enabledOptions.wardrobeCreateItem,
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

// ============================================================================
// Simple-JSON Tool Support
// ============================================================================

/**
 * Resolve which strategy the request should use. Returns one of
 * 'native' | 'simple-json' | 'text-block'. The orchestrator switches on this.
 */
export function checkResolvedToolMode(
  modelSupportsNativeTools: boolean,
  profileOverride?: ToolMode
): ResolvedToolMode {
  return resolveToolMode(modelSupportsNativeTools, profileOverride)
}

/**
 * Build simple-json system-prompt instructions. Mirrors the shape of
 * `buildTextBlockSystemInstructions` so the orchestrator wires it in
 * symmetrically.
 */
export function buildSimpleJsonSystemInstructions(
  enabledOptions: TextBlockEnabledToolOptions
): string {
  const options: SimpleJsonPromptOptions = {
    whisper: enabledOptions.whisper,
    search: enabledOptions.search,
    imageGeneration: enabledOptions.imageGeneration,
    webSearch: enabledOptions.webSearch,
    state: enabledOptions.state,
    rng: enabledOptions.rng,
    projectInfo: enabledOptions.projectInfo,
    helpSearch: enabledOptions.helpSearch,
    helpSettings: enabledOptions.helpSettings,
    helpNavigate: enabledOptions.helpNavigate,
    createNote: enabledOptions.createNote,
    wardrobeList: enabledOptions.wardrobeList,
    wardrobeUpdateOutfit: enabledOptions.wardrobeUpdateOutfit,
    wardrobeChangeItem: enabledOptions.wardrobeChangeItem,
    wardrobeCreateItem: enabledOptions.wardrobeCreateItem,
  }
  return buildSimpleJsonToolInstructions(options)
}

/**
 * Parse simple-json tool calls from a response. Adds structured logging on
 * each emission so parser-tier hit rates can be monitored from combined.log.
 */
export function parseSimpleJsonFromResponse(
  response: string,
  context?: { provider?: string; model?: string }
): Array<{ name: string; arguments: Record<string, unknown> }> {
  const parsedCalls = parseSimpleJsonCalls(response)

  if (parsedCalls.length > 0) {
    const first = parsedCalls[0]
    logger.info('Detected simple-json tool call in response', {
      toolName: first.toolName,
      parserTier: first.parserTier,
      responseLength: response.length,
      provider: context?.provider,
      model: context?.model,
    })
  }

  return parsedCalls.map(convertSimpleJsonToToolCallRequest)
}

/** Strip simple-json markers from a response for storage / display. */
export function stripSimpleJsonFromResponse(response: string): string {
  return stripSimpleJsonMarkers(response)
}

/** Quick boolean check — runs before the full parser. */
export function hasSimpleJsonInResponse(response: string): boolean {
  return hasSimpleJsonMarkers(response)
}

/** Log info about simple-json mode being active for this request. */
export function logSimpleJsonToolUsage(
  provider: string,
  model: string,
  enabledTools: TextBlockEnabledToolOptions
): void {
  logger.info('Using simple-json tools (<tool_call> JSON-in-XML)', {
    provider,
    model,
    enabledTools: Object.entries(enabledTools)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
  })
}

/** Format a tool result for the continuation slate as a `<tool_result>` block. */
export function formatSimpleJsonToolResult(toolName: string, content: string): string {
  return `<tool_result name="${escapeXmlAttribute(toolName)}">\n${content}\n</tool_result>`
}

/** Stop sequences the orchestrator should pass to the provider for simple-json. */
export const SIMPLE_JSON_STOP = SIMPLE_JSON_STOP_SEQUENCES
