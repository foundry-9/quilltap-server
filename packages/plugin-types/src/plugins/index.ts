/**
 * Plugin types barrel export
 *
 * @module @quilltap/plugin-types/plugins
 */

export type {
  ProviderMetadata,
  ProviderConfigRequirements,
  ProviderCapabilities,
  AttachmentSupport,
  ModelInfo,
  EmbeddingModelInfo,
  ImageGenerationModelInfo,
  ImageProviderConstraints,
  IconProps,
  LLMProviderPlugin,
  ProviderPluginExport,
} from './provider';

export type {
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
} from './manifest';

export type {
  ColorPalette,
  Typography,
  Spacing,
  Effects,
  ThemeTokens,
  FontDefinition,
  EmbeddedFont,
  ThemeMetadata,
  ThemePlugin,
  ThemePluginExport,
} from './theme';

export type {
  AnnotationButton,
  RenderingPattern,
  DialogueDetection,
  RoleplayTemplateConfig,
  RoleplayTemplateMetadata,
  RoleplayTemplatePlugin,
  RoleplayTemplatePluginExport,
} from './roleplay-template';

export type {
  SearchProviderMetadata,
  SearchProviderConfigRequirements,
  SearchResult,
  SearchOutput,
  SearchProviderPlugin,
  SearchProviderPluginExport,
} from './search-provider';
