# Changelog

All notable changes to @quilltap/plugin-utils will be documented in this file.

## [1.0.0] - 2025-12-30

### Added

- Initial release of @quilltap/plugin-utils
- **Tool Parsing Utilities**
  - `parseToolCalls()` - Parse tool calls with auto-detection or explicit format
  - `parseOpenAIToolCalls()` - Parse OpenAI/Grok format tool calls
  - `parseAnthropicToolCalls()` - Parse Anthropic format tool calls
  - `parseGoogleToolCalls()` - Parse Google Gemini format tool calls
  - `detectToolCallFormat()` - Detect the format of a response
  - `hasToolCalls()` - Quick check if a response contains tool calls

- **Tool Conversion Utilities**
  - `convertToAnthropicFormat()` - Convert universal tool to Anthropic format
  - `convertToGoogleFormat()` - Convert universal tool to Google format
  - `convertFromAnthropicFormat()` - Convert Anthropic tool to universal format
  - `convertFromGoogleFormat()` - Convert Google tool to universal format
  - `convertToolTo()` - Convert a tool to any supported format
  - `convertToolsTo()` - Convert multiple tools to any format
  - `applyDescriptionLimit()` - Truncate tool description if too long

- **Logger Bridge**
  - `createPluginLogger()` - Create a logger that bridges to Quilltap core
  - `hasCoreLogger()` - Check if running inside Quilltap
  - `getLogLevelFromEnv()` - Get log level from environment variables
  - Support for child loggers with context inheritance
  - Automatic fallback to console logging when running standalone
