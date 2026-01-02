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
} from './converters';

export type { ToolConvertTarget } from './converters';
