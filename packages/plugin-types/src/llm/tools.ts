/**
 * Tool/Function calling types for Quilltap plugin development
 *
 * @module @quilltap/plugin-types/llm/tools
 */

/**
 * OpenAI-format tool definition
 * Used as the universal baseline format for tool definitions
 */
export interface OpenAIToolDefinition {
  /** Tool type - always 'function' for function calling */
  type: 'function';
  function: {
    /** Name of the function */
    name: string;
    /** Description of what the function does */
    description?: string;
    /** Parameters schema in JSON Schema format */
    parameters?: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    /** Whether to use strict mode for parameters */
    strict?: boolean;
  };
}

/**
 * Universal tool format (alias for OpenAI format)
 * Used as the standard format across all providers
 */
export interface UniversalTool {
  /** Tool type - always 'function' */
  type: 'function';
  function: {
    /** Name of the tool/function */
    name: string;
    /** Description of what the tool does */
    description: string;
    /** Parameters schema in JSON Schema format */
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * Anthropic-format tool definition
 * Tool use format expected by Anthropic Claude models
 */
export interface AnthropicToolDefinition {
  /** Name of the tool */
  name: string;
  /** Description of what the tool does */
  description?: string;
  /** Input schema in JSON Schema format */
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Google-format tool definition
 * Function calling format expected by Google Gemini models
 */
export interface GoogleToolDefinition {
  /** Name of the function */
  name: string;
  /** Description of what the function does */
  description: string;
  /** Parameters schema in JSON Schema format */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Tool call from assistant response
 * Represents a tool call made by the model
 */
export interface ToolCall {
  /** Unique ID for this tool call */
  id: string;
  /** Type of tool call - always 'function' */
  type: 'function';
  function: {
    /** Name of the function to call */
    name: string;
    /** Arguments as a JSON string */
    arguments: string;
  };
}

/**
 * Parsed tool call request
 * Used consistently across all providers after parsing
 */
export interface ToolCallRequest {
  /** Name of the tool being called */
  name: string;
  /** Parsed arguments object */
  arguments: Record<string, unknown>;
  /** Provider-assigned call ID for correlating results to calls (optional for backward compat) */
  callId?: string;
}

/**
 * Tool result to send back to the model
 */
export interface ToolResult {
  /** ID of the tool call this is responding to */
  toolCallId: string;
  /** Result content */
  content: string;
  /** Whether this result represents an error */
  isError?: boolean;
}

/**
 * Options for tool formatting operations
 */
export interface ToolFormatOptions {
  /** Image provider type for context-aware formatting */
  imageProviderType?: string;
  /** Additional custom options */
  [key: string]: unknown;
}
