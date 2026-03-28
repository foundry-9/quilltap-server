/**
 * @quilltap/plugin-types
 *
 * Type definitions for Quilltap plugin development.
 *
 * This package provides TypeScript types and interfaces for building
 * Quilltap plugins, including LLM providers, authentication providers,
 * and utility plugins.
 *
 * @packageDocumentation
 * @module @quilltap/plugin-types
 */

// ============================================================================
// LLM Types
// ============================================================================

export type {
  // Core message types
  FileAttachment,
  LLMMessage,
  JSONSchemaDefinition,
  ResponseFormat,
  LLMParams,

  // Response types
  TokenUsage,
  CacheUsage,
  AttachmentResults,
  LLMResponse,
  StreamChunk,

  // Image generation types
  ImageGenParams,
  GeneratedImage,
  ImageGenResponse,

  // Model metadata
  ModelWarningLevel,
  ModelWarning,
  ModelMetadata,

  // Provider interfaces
  LLMProvider,
  ImageGenProvider,
} from './llm/base';

export type {
  // Tool definitions
  OpenAIToolDefinition,
  UniversalTool,
  AnthropicToolDefinition,
  GoogleToolDefinition,

  // Tool calls
  ToolCall,
  ToolCallRequest,
  ToolResult,
  ToolFormatOptions,
} from './llm/tools';

export type {
  // Embedding types
  EmbeddingResult,
  EmbeddingOptions,
  EmbeddingProvider,
  LocalEmbeddingProviderState,
  LocalEmbeddingProvider,
} from './llm/embeddings';

export { isLocalEmbeddingProvider } from './llm/embeddings';

// ============================================================================
// Plugin Types
// ============================================================================

export type {
  // Provider plugin types
  ProviderMetadata,
  ProviderConfigRequirements,
  ProviderCapabilities,
  AttachmentSupport,
  ModelInfo,
  EmbeddingModelInfo,
  ImageGenerationModelInfo,
  ImageStyleInfo,
  ImageProviderConstraints,
  IconProps,
  PluginIconData,
  LLMProviderPlugin,
  ProviderPluginExport,
  // Runtime configuration types
  MessageFormatSupport,
  CheapModelConfig,
  ToolFormatType,
} from './plugins/provider';

export type {
  // Manifest types
  PluginCapability,
  PluginCategory,
  PluginStatus,
  PluginAuthor,
  PluginCompatibility,
  ProviderConfig,
  SearchProviderConfig,
  PluginPermissions,
  PluginManifest,
  InstalledPluginInfo,
} from './plugins/manifest';

export type {
  // Theme plugin types
  ColorPalette,
  Typography,
  Spacing,
  Effects,
  ThemeTokens,
  FontDefinition,
  EmbeddedFont,
  ThemeMetadata,
  SubsystemOverrides,
  ThemePlugin,
  ThemePluginExport,
} from './plugins/theme';

export type {
  // Roleplay template plugin types
  RoleplayTemplateConfig,
  RoleplayTemplateMetadata,
  RoleplayTemplatePlugin,
  RoleplayTemplatePluginExport,
} from './plugins/roleplay-template';

export type {
  // System prompt plugin types
  SystemPromptData,
  SystemPromptMetadata,
  SystemPromptPlugin,
  SystemPromptPluginExport,
} from './plugins/system-prompt';

export type {
  // Tool plugin types
  ToolMetadata,
  ToolHierarchyInfo,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolPlugin,
  ToolPluginExport,
} from './plugins/tool';

export type {
  // Search provider plugin types
  SearchProviderMetadata,
  SearchProviderConfigRequirements,
  SearchResult,
  SearchOutput,
  SearchProviderPlugin,
  SearchProviderPluginExport,
} from './plugins/search-provider';

export type {
  // Moderation provider plugin types
  ModerationProviderMetadata,
  ModerationProviderConfigRequirements,
  ModerationCategoryResult,
  ModerationResult,
  ModerationProviderPlugin,
  ModerationProviderPluginExport,
} from './plugins/moderation-provider';

// ============================================================================
// Common Types
// ============================================================================

export type { LogLevel, LogContext, PluginLogger } from './common/logger';

// Error classes (these are values, not just types)
export {
  PluginError,
  ApiKeyError,
  ProviderApiError,
  RateLimitError,
  ConfigurationError,
  ModelNotFoundError,
  AttachmentError,
  ToolExecutionError,
} from './common/errors';

// Logger factories
export { createConsoleLogger, createNoopLogger } from './common/logger';

// ============================================================================
// Version
// ============================================================================

/**
 * Version of the plugin-types package.
 * Can be used at runtime to check compatibility.
 */
export const PLUGIN_TYPES_VERSION = '1.18.0';
