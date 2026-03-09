/**
 * XML Tool Call Parser
 *
 * Parses XML-style tool calls from LLM responses and converts them to the
 * standard ToolCallRequest format for execution. Supports multiple XML formats:
 * - DeepSeek: <function_calls><invoke name="..."><parameter name="..." string="...">value</parameter></invoke></function_calls>
 * - Claude-style: <function_calls><invoke name="..."><parameter name="...">value</parameter></invoke></function_calls>
 * - Generic: <tool_call><name>...</name><arguments><query>...</query></arguments></tool_call>
 * - Function call: <function_call name="..."><param name="...">value</param></function_call>
 * - Tool use: <tool_use><name>...</name><arguments>...</arguments></tool_use> (Gemini)
 */

import { logger } from '@/lib/logger'

/**
 * Parsed XML tool call from text
 */
export interface ParsedXMLTool {
  /** The tool name (function name from XML) */
  toolName: string
  /** Arguments extracted from parameters */
  arguments: Record<string, unknown>
  /** The full matched XML text (for replacement/stripping) */
  fullMatch: string
  /** Start index in the original text */
  startIndex: number
  /** End index in the original text */
  endIndex: number
  /** Which XML format was detected */
  format: 'deepseek' | 'claude' | 'generic' | 'function_call' | 'tool_use'
}

/**
 * Standard tool call request format (matches existing tool executor interface)
 */
export interface ToolCallRequest {
  name: string
  arguments: Record<string, unknown>
}

/**
 * Map XML tool names to internal tool names
 * Includes common variations and aliases
 */
const XML_TOOL_NAME_MAP: Record<string, string> = {
  // Direct mappings
  'search_memories': 'search_memories',
  'generate_image': 'generate_image',
  'search_web': 'search_web',

  // Common variations/aliases
  'memory': 'search_memories',
  'memory_search': 'search_memories',
  'search_memory': 'search_memories',
  'memories': 'search_memories',

  'image': 'generate_image',
  'create_image': 'generate_image',
  'image_generation': 'generate_image',
  'gen_image': 'generate_image',

  'search': 'search_web',
  'web_search': 'search_web',
  'websearch': 'search_web',
  'web': 'search_web',
}

/**
 * Map an XML tool name to the internal tool name
 */
export function mapXMLToolName(xmlName: string): string {
  const normalized = xmlName.toLowerCase().trim()
  return XML_TOOL_NAME_MAP[normalized] || xmlName
}

/**
 * Parse <function_calls><invoke> format (DeepSeek and Claude style)
 */
function parseFunctionCallsFormat(response: string): ParsedXMLTool[] {
  const results: ParsedXMLTool[] = []

  // Pattern for <function_calls> wrapper
  const functionCallsPattern = /<function_calls>([\s\S]*?)<\/function_calls>/gi

  let wrapperMatch
  while ((wrapperMatch = functionCallsPattern.exec(response)) !== null) {
    const wrapperContent = wrapperMatch[1]
    const wrapperStartIndex = wrapperMatch.index
    // Calculate the offset where the wrapper content starts (after <function_calls>)
    const contentOffset = wrapperStartIndex + '<function_calls>'.length

    // Pattern for <invoke> elements within the wrapper
    const invokePattern = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi

    let invokeMatch
    while ((invokeMatch = invokePattern.exec(wrapperContent)) !== null) {
      const toolName = invokeMatch[1]
      const paramContent = invokeMatch[2]
      // Calculate actual position of this invoke in the original response
      const invokeStartIndex = contentOffset + invokeMatch.index
      const invokeEndIndex = invokeStartIndex + invokeMatch[0].length

      // Parse parameters - try DeepSeek format first (with string attribute)
      const args: Record<string, unknown> = {}
      let format: 'deepseek' | 'claude' = 'claude'

      // DeepSeek format: <parameter name="..." string="...">value</parameter>
      const deepseekParamPattern = /<parameter\s+name=["']([^"']+)["']\s+string=["']([^"']*)["'][^>]*>([^<]*)<\/parameter>/gi
      let paramMatch
      while ((paramMatch = deepseekParamPattern.exec(paramContent)) !== null) {
        const paramName = paramMatch[1]
        const stringAttr = paramMatch[2]
        const value = paramMatch[3].trim()

        // Convert based on string attribute
        if (stringAttr === 'false') {
          // Try to parse as number or boolean
          const numVal = Number(value)
          if (!isNaN(numVal)) {
            args[paramName] = numVal
          } else if (value === 'true') {
            args[paramName] = true
          } else if (value === 'false') {
            args[paramName] = false
          } else {
            args[paramName] = value
          }
        } else {
          args[paramName] = value
        }
        format = 'deepseek'
      }

      // If no DeepSeek params found, try Claude format: <parameter name="...">value</parameter>
      if (Object.keys(args).length === 0) {
        const claudeParamPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/parameter>/gi
        while ((paramMatch = claudeParamPattern.exec(paramContent)) !== null) {
          args[paramMatch[1]] = paramMatch[2].trim()
        }
      }

      // Also check for antml:parameter format (Claude Code style)
      const antmlParamPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/antml:parameter>/gi
      while ((paramMatch = antmlParamPattern.exec(paramContent)) !== null) {
        args[paramMatch[1]] = paramMatch[2].trim()
      }

      results.push({
        toolName: mapXMLToolName(toolName),
        arguments: args,
        fullMatch: invokeMatch[0],
        startIndex: invokeStartIndex,
        endIndex: invokeEndIndex,
        format,
      })
    }
  }

  return results
}

/**
 * Parse <tool_call> format (generic)
 */
function parseToolCallFormat(response: string): ParsedXMLTool[] {
  const results: ParsedXMLTool[] = []

  // Pattern for <tool_call> wrapper
  const toolCallPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi

  let match
  while ((match = toolCallPattern.exec(response)) !== null) {
    const content = match[1]
    const startIndex = match.index

    // Extract name
    const nameMatch = /<name>([^<]+)<\/name>/i.exec(content)
    if (!nameMatch) continue

    const toolName = nameMatch[1].trim()
    const args: Record<string, unknown> = {}

    // Extract arguments - can be nested or flat
    const argsMatch = /<arguments>([\s\S]*?)<\/arguments>/i.exec(content)
    if (argsMatch) {
      // Parse child elements as arguments
      const argsContent = argsMatch[1]
      const argPattern = /<(\w+)>([^<]*)<\/\1>/gi
      let argMatch
      while ((argMatch = argPattern.exec(argsContent)) !== null) {
        args[argMatch[1]] = argMatch[2].trim()
      }
    }

    results.push({
      toolName: mapXMLToolName(toolName),
      arguments: args,
      fullMatch: match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
      format: 'generic',
    })
  }

  return results
}

/**
 * Parse <function_call name="..."> format
 */
function parseFunctionCallFormat(response: string): ParsedXMLTool[] {
  const results: ParsedXMLTool[] = []

  // Pattern for <function_call name="...">
  const functionCallPattern = /<function_call\s+name=["']([^"']+)["']>([\s\S]*?)<\/function_call>/gi

  let match
  while ((match = functionCallPattern.exec(response)) !== null) {
    const toolName = match[1]
    const content = match[2]
    const startIndex = match.index

    const args: Record<string, unknown> = {}

    // Parse <param> elements
    const paramPattern = /<param\s+name=["']([^"']+)["']>([^<]*)<\/param>/gi
    let paramMatch
    while ((paramMatch = paramPattern.exec(content)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim()
    }

    // Also try <parameter> elements
    const parameterPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/parameter>/gi
    while ((paramMatch = parameterPattern.exec(content)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim()
    }

    results.push({
      toolName: mapXMLToolName(toolName),
      arguments: args,
      fullMatch: match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
      format: 'function_call',
    })
  }

  return results
}

/**
 * Parse <tool_use> format (Gemini and others)
 *
 * Handles multiple sub-formats:
 * - Bare JSON: <tool_use>{"name":"fn","input":{"query":"val"}}</tool_use> (Gemini's primary format)
 * - XML children: <tool_use><name>fn</name><arguments><query>val</query></arguments></tool_use>
 * - JSON in arguments: <tool_use><name>fn</name><arguments>{"query":"val"}</arguments></tool_use>
 * - Attributed: <tool_use name="fn"><arguments>...</arguments></tool_use>
 */
function parseToolUseFormat(response: string): ParsedXMLTool[] {
  const results: ParsedXMLTool[] = []

  // Pattern for <tool_use> with optional name attribute
  const toolUsePattern = /<tool_use(?:\s+name=["']([^"']+)["'])?\s*>([\s\S]*?)<\/tool_use>/gi

  let match
  while ((match = toolUsePattern.exec(response)) !== null) {
    const attrName = match[1]
    const content = match[2]
    const startIndex = match.index

    // First, try parsing the entire content as a JSON blob (Gemini's primary format):
    // <tool_use>{"name": "tool_name", "input": {...}}</tool_use>
    const trimmedContent = content.trim()
    if (trimmedContent.startsWith('{')) {
      try {
        const jsonBlob = JSON.parse(trimmedContent)
        if (typeof jsonBlob === 'object' && jsonBlob !== null && jsonBlob.name) {
          const args = jsonBlob.input || jsonBlob.arguments || jsonBlob.parameters || {}
          results.push({
            toolName: mapXMLToolName(jsonBlob.name),
            arguments: typeof args === 'object' && args !== null ? args : {},
            fullMatch: match[0],
            startIndex,
            endIndex: startIndex + match[0].length,
            format: 'tool_use',
          })
          continue
        }
      } catch {
        // Not valid JSON, fall through to XML parsing
      }
    }

    // Extract name from attribute or child element
    let toolName = attrName
    if (!toolName) {
      const nameMatch = /<name>([^<]+)<\/name>/i.exec(content)
      if (!nameMatch) continue
      toolName = nameMatch[1].trim()
    }

    const args: Record<string, unknown> = {}

    // Extract arguments block (try <arguments>, <input>, or <parameters>)
    const argsMatch = /<(?:arguments|input|parameters)>([\s\S]*?)<\/(?:arguments|input|parameters)>/i.exec(content)
    if (argsMatch) {
      const argsContent = argsMatch[1].trim()

      // Try JSON first (Gemini often emits JSON inside <arguments>)
      if (argsContent.startsWith('{')) {
        try {
          const parsed = JSON.parse(argsContent)
          if (typeof parsed === 'object' && parsed !== null) {
            Object.assign(args, parsed)
          }
        } catch {
          // Not valid JSON, fall through to XML parsing
        }
      }

      // If no args parsed from JSON, try XML child elements
      if (Object.keys(args).length === 0) {
        const argPattern = /<(\w+)>([^<]*)<\/\1>/gi
        let argMatch
        while ((argMatch = argPattern.exec(argsContent)) !== null) {
          args[argMatch[1]] = argMatch[2].trim()
        }
      }
    }

    results.push({
      toolName: mapXMLToolName(toolName),
      arguments: args,
      fullMatch: match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
      format: 'tool_use',
    })
  }

  return results
}

/**
 * Parse all XML tool calls from response text
 * Checks all supported formats and returns unified results
 *
 * @param response - The LLM's text response
 * @returns Array of parsed XML tool calls
 */
export function parseXMLToolCalls(response: string): ParsedXMLTool[] {
  const allResults: ParsedXMLTool[] = []

  // Try all formats
  allResults.push(...parseFunctionCallsFormat(response))
  allResults.push(...parseToolCallFormat(response))
  allResults.push(...parseFunctionCallFormat(response))
  allResults.push(...parseToolUseFormat(response))

  // Deduplicate by startIndex (in case multiple patterns match the same block)
  const seen = new Set<number>()
  const deduped = allResults.filter(result => {
    if (seen.has(result.startIndex)) {
      return false
    }
    seen.add(result.startIndex)
    return true
  })

  // Sort by startIndex for consistent ordering
  deduped.sort((a, b) => a.startIndex - b.startIndex)

  return deduped
}

/**
 * Convert a parsed XML tool to the standard ToolCallRequest format
 *
 * This allows XML tools to be executed through the same pipeline
 * as native tool calls.
 */
export function convertXMLToToolCallRequest(parsed: ParsedXMLTool): ToolCallRequest {
  // For tools with specific argument expectations, normalize the arguments
  switch (parsed.toolName) {
    case 'search_memories':
      return {
        name: 'search_memories',
        arguments: {
          query: parsed.arguments.query || parsed.arguments.search || Object.values(parsed.arguments)[0] || '',
          limit: parsed.arguments.limit,
        },
      }

    case 'generate_image':
      return {
        name: 'generate_image',
        arguments: {
          prompt: parsed.arguments.prompt || parsed.arguments.description || Object.values(parsed.arguments)[0] || '',
        },
      }

    case 'search_web':
      return {
        name: 'search_web',
        arguments: {
          query: parsed.arguments.query || parsed.arguments.search || Object.values(parsed.arguments)[0] || '',
        },
      }

    default:
      // Pass through unknown tools with their original arguments
      logger.warn('[XMLToolParser] Unknown tool name, passing through', {
        toolName: parsed.toolName,
        originalArguments: parsed.arguments,
      })
      return {
        name: parsed.toolName,
        arguments: parsed.arguments,
      }
  }
}

/**
 * Strip all XML tool call markers from response text for display
 *
 * Removes all supported XML tool patterns so the displayed response
 * is clean. Tool execution status is shown separately in the UI.
 */
export function stripXMLToolMarkers(response: string): string {
  let stripped = response

  // Remove <function_calls>...</function_calls> blocks
  stripped = stripped.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')

  // Remove <tool_call>...</tool_call> blocks
  stripped = stripped.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')

  // Remove <function_call ...>...</function_call> blocks
  stripped = stripped.replace(/<function_call\s+[^>]*>[\s\S]*?<\/function_call>/gi, '')

  // Remove <tool_use>...</tool_use> blocks
  stripped = stripped.replace(/<tool_use[\s>][\s\S]*?<\/tool_use>/gi, '')

  // Clean up any double spaces or newlines left behind
  stripped = stripped
    .replace(/\n{3,}/g, '\n\n')  // Collapse multiple newlines
    .replace(/  +/g, ' ')        // Collapse multiple spaces
    .trim()

  return stripped
}

/**
 * Check if a response contains any XML tool call patterns
 * This is a quick check before doing full parsing
 */
export function hasXMLToolMarkers(response: string): boolean {
  return (
    /<function_calls>/i.test(response) ||
    /<tool_call>/i.test(response) ||
    /<function_call\s+/i.test(response) ||
    /<tool_use[\s>]/i.test(response)
  )
}
