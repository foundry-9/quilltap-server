# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2025-12-30

### Fixed

- Removed unused eslint-disable directives

## [1.0.1] - 2025-12-30

### Fixed

- Changed `formatTools` and `parseToolCalls` signatures to use `any` instead of `unknown` for backward compatibility with existing plugin implementations

## [1.0.0] - 2025-12-30

### Added

- Initial release of `@quilltap/plugin-types`
- Core LLM types:
  - `LLMProvider` interface
  - `LLMParams`, `LLMResponse`, `StreamChunk` types
  - `LLMMessage`, `FileAttachment` types
  - `ImageGenParams`, `ImageGenResponse` types
  - `ModelMetadata`, `ModelWarning` types
- Tool/function calling types:
  - `OpenAIToolDefinition`, `AnthropicToolDefinition`, `GoogleToolDefinition`
  - `UniversalTool` (alias for OpenAI format)
  - `ToolCall`, `ToolCallRequest`, `ToolResult`
- Plugin interface types:
  - `LLMProviderPlugin` main interface
  - `ProviderMetadata`, `ProviderCapabilities`
  - `AttachmentSupport`, `ModelInfo`
  - `EmbeddingModelInfo`, `ImageGenerationModelInfo`
- Plugin manifest types:
  - `PluginManifest` schema
  - `PluginCapability`, `PluginCategory`, `PluginStatus`
  - `InstalledPluginInfo`
- Common utilities:
  - Error classes: `PluginError`, `ApiKeyError`, `ProviderApiError`, `RateLimitError`
  - Additional errors: `ConfigurationError`, `ModelNotFoundError`, `AttachmentError`, `ToolExecutionError`
  - Logger interface: `PluginLogger`
  - Logger factories: `createConsoleLogger`, `createNoopLogger`
- Submodule exports for granular imports:
  - `@quilltap/plugin-types/llm`
  - `@quilltap/plugin-types/plugins`
  - `@quilltap/plugin-types/common`
- `PLUGIN_TYPES_VERSION` export for runtime compatibility checks
