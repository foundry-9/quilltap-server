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
