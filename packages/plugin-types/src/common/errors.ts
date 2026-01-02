/**
 * Common error types for Quilltap plugin development
 *
 * @module @quilltap/plugin-types/common/errors
 */

/**
 * Base plugin error
 *
 * All plugin-specific errors should extend this class.
 */
export class PluginError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly pluginName?: string
  ) {
    super(message);
    this.name = 'PluginError';
  }
}

/**
 * API key validation error
 *
 * Thrown when an API key is invalid or has insufficient permissions.
 */
export class ApiKeyError extends PluginError {
  constructor(message: string, pluginName?: string) {
    super(message, 'API_KEY_ERROR', pluginName);
    this.name = 'ApiKeyError';
  }
}

/**
 * Provider API error
 *
 * Thrown when the provider API returns an error.
 */
export class ProviderApiError extends PluginError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: unknown,
    pluginName?: string
  ) {
    super(message, 'PROVIDER_API_ERROR', pluginName);
    this.name = 'ProviderApiError';
  }
}

/**
 * Rate limit error
 *
 * Thrown when the provider rate limits the request.
 */
export class RateLimitError extends ProviderApiError {
  public override readonly code = 'RATE_LIMIT_ERROR';

  constructor(
    message: string,
    public readonly retryAfter?: number,
    pluginName?: string
  ) {
    super(message, 429, undefined, pluginName);
    this.name = 'RateLimitError';
  }
}

/**
 * Configuration error
 *
 * Thrown when plugin configuration is invalid.
 */
export class ConfigurationError extends PluginError {
  constructor(message: string, pluginName?: string) {
    super(message, 'CONFIGURATION_ERROR', pluginName);
    this.name = 'ConfigurationError';
  }
}

/**
 * Model not found error
 *
 * Thrown when a requested model is not available.
 */
export class ModelNotFoundError extends PluginError {
  constructor(
    message: string,
    public readonly modelId?: string,
    pluginName?: string
  ) {
    super(message, 'MODEL_NOT_FOUND', pluginName);
    this.name = 'ModelNotFoundError';
  }
}

/**
 * Attachment error
 *
 * Thrown when there's an issue processing file attachments.
 */
export class AttachmentError extends PluginError {
  constructor(
    message: string,
    public readonly attachmentId?: string,
    pluginName?: string
  ) {
    super(message, 'ATTACHMENT_ERROR', pluginName);
    this.name = 'AttachmentError';
  }
}

/**
 * Tool execution error
 *
 * Thrown when a tool call fails to execute.
 */
export class ToolExecutionError extends PluginError {
  constructor(
    message: string,
    public readonly toolName?: string,
    pluginName?: string
  ) {
    super(message, 'TOOL_EXECUTION_ERROR', pluginName);
    this.name = 'ToolExecutionError';
  }
}
