# Changelog

All notable changes to @quilltap/plugin-utils will be documented in this file.

## [1.1.0] - 2025-12-30

### Added

- **OpenAI-Compatible Provider Base Class**
  - `OpenAICompatibleProvider` - Reusable base class for OpenAI-compatible LLM providers
  - `OpenAICompatibleProviderConfig` - Configuration interface for customizing providers
  - Supports streaming and non-streaming chat completions
  - Configurable API key requirements (`requireApiKey` option)
  - Customizable provider name for logging (`providerName` option)
  - Customizable attachment error messages (`attachmentErrorMessage` option)
  - Includes API key validation and model listing
  - Uses the plugin logger bridge for consistent logging
  - Peer dependency on `openai` package (optional, only needed if using this provider)

- **New Export Path**
  - `@quilltap/plugin-utils/providers` - Direct import path for provider base classes

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
