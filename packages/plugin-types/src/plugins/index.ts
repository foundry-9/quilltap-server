/**
 * Plugin types barrel export
 *
 * @module @quilltap/plugin-types/plugins
 */

export type {
  TextProviderPlugin,
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
  ScoringProviderMetadata,
  ScoringProviderConfigRequirements,
  ScoringProviderPlugin,
  ScoringProviderPluginExport,
} from './scoring-provider';

export type {
  PluginCapability,
  PluginCategory,
  PluginStatus,
  PluginAuthor,
  PluginCompatibility,
  ProviderConfig,
  SearchProviderConfig,
  ModerationProviderConfig,
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
  NarrationDelimiters,
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

export type {
  ModerationProviderMetadata,
  ModerationProviderConfigRequirements,
  ModerationCategoryResult,
  ModerationResult,
  ModerationProviderPlugin,
  ModerationProviderPluginExport,
} from './moderation-provider';
