# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-01-09

### Added

- Added file storage plugin types for building custom storage backend plugins:
  - `FileBackendCapabilities` - Interface describing storage backend features
  - `FileBackendMetadata` - Backend registration metadata
  - `FileMetadata` - Stored file metadata (size, contentType, lastModified)
  - `FileStorageBackend` - Core interface with upload, download, delete, exists, and optional operations
  - `FileStorageConfigField` - Configuration field definitions for plugin setup UI
  - `FileStorageProviderPlugin` - Main plugin interface for storage providers
  - `FileStoragePluginExport` - Standard export type for file storage plugins
- Added `@types/node` to devDependencies for Node.js type support (Buffer, Readable)

## [1.5.1] - 2026-01-05

### Added

- Added `maxBase64Size?: number` field to `AttachmentSupport` interface
  - Allows provider plugins to specify their maximum base64-encoded file size limit
  - Used by core to automatically resize images that exceed provider limits
  - Anthropic sets 5MB, OpenAI/Google/Grok set 20MB

## [1.5.0] - 2026-01-02

### Added

- Added `RenderingPattern` interface for configurable message content styling:
  - `pattern: string` - Regex pattern as a string (converted to RegExp at runtime)
  - `className: string` - CSS class to apply to matched text
  - `flags?: string` - Optional regex flags (e.g., 'm' for multiline)
- Added `DialogueDetection` interface for paragraph-level dialogue detection:
  - `openingChars: string[]` - Opening quote characters to detect
  - `closingChars: string[]` - Closing quote characters to detect
  - `className: string` - CSS class to apply to dialogue paragraphs
- Added `renderingPatterns?: RenderingPattern[]` field to `RoleplayTemplateConfig`
- Added `dialogueDetection?: DialogueDetection` field to `RoleplayTemplateConfig`
- Exported `AnnotationButton`, `RenderingPattern`, `DialogueDetection` from `@quilltap/plugin-types/plugins`

## [1.4.0] - 2026-01-02

### Added

- Added `AnnotationButton` interface for roleplay template annotation buttons:
  - `label: string` - Full name for tooltip (e.g., "Narration", "Internal Monologue")
  - `abbrev: string` - Abbreviated label for button display (e.g., "Nar", "Int", "OOC")
  - `prefix: string` - Opening delimiter (e.g., "[", "{", "// ")
  - `suffix: string` - Closing delimiter (e.g., "]", "}", "")
- Added `annotationButtons?: AnnotationButton[]` field to `RoleplayTemplateConfig` interface
  - Enables roleplay template plugins to define custom annotation formatting buttons
  - Used by the Document Editing Mode formatting toolbar

## [1.3.0] - 2026-01-02

### Added

- Added `requiresRestart?: boolean` field to `PluginManifest` interface
  - Optional field to indicate if a plugin requires a server restart to activate
  - If not specified, restart requirement is inferred from capabilities (AUTH_METHODS, DATABASE_BACKEND, FILE_BACKEND, UPGRADE_MIGRATION)
  - Used by hosted deployments to enforce site-wide installation for restart-requiring plugins

## [1.2.0] - 2025-12-31

### Added

- Roleplay template plugin types:
  - `RoleplayTemplatePlugin` main interface for roleplay template plugins
  - `RoleplayTemplateMetadata` for template identification and display
  - `RoleplayTemplateConfig` for individual template configuration
  - `RoleplayTemplatePluginExport` standard export type
- Added `ROLEPLAY_TEMPLATE` to `PluginCapability` type
- Added `TEMPLATE` to `PluginCategory` type
- Exported roleplay template types via `@quilltap/plugin-types/plugins`

## [1.1.0] - 2025-12-31

### Added

- Theme plugin types for self-contained theme plugins:
  - `ThemePlugin` main interface for theme plugins
  - `ThemeMetadata` for theme identification and display
  - `ThemeTokens` complete theme token structure
  - `ColorPalette` for light and dark mode colors
  - `Typography`, `Spacing`, `Effects` for design tokens
  - `FontDefinition` for font loading configuration
  - `EmbeddedFont` for self-contained font embedding
  - `ThemePluginExport` standard export type
- Exported theme types via `@quilltap/plugin-types/plugins`

## [1.0.3] - 2025-12-30

### Added

- New runtime configuration types for `LLMProviderPlugin`:
  - `MessageFormatSupport` - configures name field support for multi-character chats
  - `CheapModelConfig` - specifies recommended cheap models for background tasks
  - `ToolFormatType` - declares which tool format the provider uses ('openai' | 'anthropic' | 'google')
- New optional properties on `LLMProviderPlugin`:
  - `messageFormat?: MessageFormatSupport`
  - `charsPerToken?: number` - token estimation multiplier (default: 3.5)
  - `toolFormat?: ToolFormatType` - tool format type
  - `cheapModels?: CheapModelConfig` - cheap model configuration
  - `defaultContextWindow?: number` - fallback context window (default: 8192)
- Added `pricing?: { input: number; output: number }` to `ModelInfo` interface

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
