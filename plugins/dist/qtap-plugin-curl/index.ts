/**
 * curl Tool Plugin
 *
 * Provides an HTTP request tool for LLMs to fetch web content and API responses.
 *
 * @module qtap-plugin-curl
 */

import type {
  ToolPlugin,
  ToolExecutionContext,
  ToolExecutionResult,
  UniversalTool,
} from '@quilltap/plugin-types';
import { curlToolDefinition, validateCurlInput } from './curl-tool';
import { executeCurlRequest } from './curl-handler';
import type { CurlToolInput, CurlToolConfig, CurlToolOutput } from './types';

/**
 * curl Tool Plugin Implementation
 *
 * Uses the standard multi-tool pattern with getToolDefinitions() and executeByName().
 */
export const plugin: ToolPlugin = {
  metadata: {
    toolName: 'curl',
    displayName: 'curl',
    description: 'Make HTTP requests to fetch web content, APIs, or other network resources',
    category: 'Network',
  },

  /**
   * Get tool definitions (multi-tool pattern)
   *
   * Returns an array containing the curl tool definition.
   */
  async getToolDefinitions(_config: Record<string, unknown>): Promise<UniversalTool[]> {
    return [curlToolDefinition];
  },

  /**
   * Execute a tool by name (multi-tool pattern)
   *
   * Routes execution to the curl handler.
   */
  async executeByName(
    toolName: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    // Verify this is the curl tool
    if (toolName !== 'curl') {
      return {
        success: false,
        error: `Unknown tool: ${toolName}. This plugin only provides the 'curl' tool.`,
      };
    }

    // Cast input to typed format (validated by validateInput before this is called)
    const curlInput = input as unknown as CurlToolInput;

    // Get config from context
    const config = context.toolConfig as Partial<CurlToolConfig>;

    // Execute the request
    const output = await executeCurlRequest(curlInput, config);

    return {
      success: output.success,
      result: output,
      error: output.error,
      formattedText: formatCurlOutput(output),
      metadata: {
        url: curlInput.url,
        method: curlInput.request || 'GET',
        statusCode: output.statusCode,
        timing: output.timing,
      },
    };
  },

  /**
   * Validate input arguments
   */
  validateInput(input: unknown): boolean {
    return validateCurlInput(input);
  },

  /**
   * Format results for LLM consumption
   */
  formatResults(result: ToolExecutionResult): string {
    if (result.formattedText) {
      return result.formattedText;
    }
    return JSON.stringify(result.result, null, 2);
  },

  /**
   * Check if tool is properly configured
   */
  isConfigured(config: Record<string, unknown>): boolean {
    // Check if allowedUrlPatterns has at least one pattern
    const patterns = config.allowedUrlPatterns;
    if (typeof patterns !== 'string') {
      return false;
    }

    // Parse patterns and check if any are valid
    const lines = patterns
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));

    return lines.length > 0;
  },

  /**
   * Get default configuration
   */
  getDefaultConfig(): Record<string, unknown> {
    return {
      allowedUrlPatterns: '',
      maxResponseSize: 102400,
      defaultTimeout: 30,
      followRedirects: true,
    };
  },
};

/**
 * Format curl output for LLM consumption
 */
function formatCurlOutput(output: CurlToolOutput): string {
  if (!output.success) {
    return `curl request failed: ${output.error}`;
  }

  const lines: string[] = [];

  // Status line
  lines.push(`HTTP ${output.statusCode} ${output.statusText}`);
  lines.push('');

  // Headers
  if (output.headers && Object.keys(output.headers).length > 0) {
    lines.push('Response Headers:');
    for (const [key, value] of Object.entries(output.headers)) {
      lines.push(`  ${key}: ${value}`);
    }
    lines.push('');
  }

  // Redirect info
  if (output.finalUrl) {
    lines.push(`Final URL (after redirect): ${output.finalUrl}`);
    lines.push('');
  }

  // Body
  if (output.body) {
    lines.push('Response Body:');
    lines.push(output.body);

    if (output.bodyTruncated && output.originalSize) {
      lines.push('');
      lines.push(`[Response truncated from ${output.originalSize} bytes]`);
    }
  }

  // Timing
  if (output.timing) {
    lines.push('');
    lines.push(`Request completed in ${output.timing.totalMs}ms`);
  }

  return lines.join('\n');
}

// Default export for compatibility
const pluginExport = { plugin };
export default pluginExport;
