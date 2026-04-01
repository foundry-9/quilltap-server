/**
 * Tool Utilities
 *
 * Exports all tool-related utilities for parsing and converting
 * tool calls between different LLM provider formats.
 *
 * @module @quilltap/plugin-utils/tools
 */

// Re-export types
export type {
  OpenAIToolDefinition,
  UniversalTool,
  AnthropicToolDefinition,
  GoogleToolDefinition,
  ToolCall,
  ToolCallRequest,
  ToolResult,
  ToolFormatOptions,
} from './types';

// Export parsers
export {
  parseToolCalls,
  parseOpenAIToolCalls,
  parseAnthropicToolCalls,
  parseGoogleToolCalls,
  detectToolCallFormat,
  hasToolCalls,
} from './parsers';

export type { ToolCallFormat } from './parsers';

// Export converters
export {
  convertToAnthropicFormat,
  convertToGoogleFormat,
  convertFromAnthropicFormat,
  convertFromGoogleFormat,
  convertToolTo,
  convertToolsTo,
  applyDescriptionLimit,
  // Backward-compatible aliases
  convertOpenAIToAnthropicFormat,
  convertOpenAIToGoogleFormat,
} from './converters';

export type { ToolConvertTarget } from './converters';

// Export text-based tool call parsers (for spontaneous XML emissions)
export {
  // Composite utilities
  parseAllXMLFormats,
  parseAllXMLAsToolCalls,
  hasAnyXMLToolMarkers,
  stripAllXMLToolMarkers,
  // Individual format parsers
  parseFunctionCallsFormat,
  parseToolCallFormat,
  parseFunctionCallFormat,
  parseToolUseFormat,
  parseInvokeFormat,
  // Individual marker checks
  hasFunctionCallsMarkers,
  hasToolCallMarkers,
  hasFunctionCallMarkers,
  hasToolUseMarkers,
  hasInvokeMarkers,
  // Individual strippers
  stripFunctionCallsMarkers,
  stripToolCallMarkers,
  stripFunctionCallMarkers,
  stripToolUseMarkers,
  stripInvokeMarkers,
  // Utilities
  normalizeToolName,
  convertToToolCallRequest as convertTextToolToRequest,
} from './text-parsers';

export type { ParsedTextTool } from './text-parsers';
