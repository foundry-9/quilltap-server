/**
 * Plugin Manifest types for Quilltap plugin development
 *
 * @module @quilltap/plugin-types/plugins/manifest
 */

/**
 * Plugin capability types
 */
export type PluginCapability =
  | 'LLM_PROVIDER'
  | 'AUTH_PROVIDER'
  | 'STORAGE_BACKEND'
  | 'THEME'
  | 'ROLEPLAY_TEMPLATE'
  | 'TOOL_PROVIDER'
  | 'UTILITY';

/**
 * Plugin category
 */
export type PluginCategory =
  | 'PROVIDER'
  | 'AUTH'
  | 'STORAGE'
  | 'UI'
  | 'TEMPLATE'
  | 'TOOLS'
  | 'UTILITY';

/**
 * Plugin status
 */
export type PluginStatus =
  | 'STABLE'
  | 'BETA'
  | 'EXPERIMENTAL'
  | 'DEPRECATED';

/**
 * Author information
 */
export interface PluginAuthor {
  /** Author name */
  name: string;
  /** Author email */
  email?: string;
  /** Author website or profile URL */
  url?: string;
}

/**
 * Compatibility requirements
 */
export interface PluginCompatibility {
  /** Minimum Quilltap version (semver range) */
  quilltapVersion: string;
  /** Minimum Node.js version (semver range) */
  nodeVersion?: string;
}

/**
 * Provider-specific configuration (for LLM_PROVIDER plugins)
 */
export interface ProviderConfig {
  /** Internal provider name */
  providerName: string;
  /** Human-readable display name */
  displayName: string;
  /** Provider description */
  description: string;
  /** Short abbreviation */
  abbreviation: string;
  /** UI color configuration */
  colors: {
    bg: string;
    text: string;
    icon: string;
  };
  /** Whether the provider requires an API key */
  requiresApiKey: boolean;
  /** Whether the provider requires a base URL */
  requiresBaseUrl: boolean;
  /** Label for API key input */
  apiKeyLabel?: string;
  /**
   * Legacy provider names that should be treated as aliases for this provider.
   * Used for backward compatibility when provider names change.
   * Example: ['GOOGLE_IMAGEN'] for the GOOGLE provider.
   */
  legacyNames?: string[];
  /** Provider capabilities */
  capabilities: {
    chat: boolean;
    imageGeneration: boolean;
    embeddings: boolean;
    webSearch: boolean;
  };
  /** Attachment support configuration */
  attachmentSupport: {
    supported: boolean;
    mimeTypes: string[];
    description: string;
  };
}

/**
 * Required permissions for the plugin
 */
export interface PluginPermissions {
  /** Network domains the plugin may access */
  network?: string[];
  /** Whether the plugin accesses user data */
  userData?: boolean;
  /** Whether the plugin accesses the database */
  database?: boolean;
  /** Whether the plugin accesses the file system */
  fileSystem?: boolean;
}

/**
 * Plugin manifest schema
 *
 * This is the structure of the quilltap-manifest.json file
 * that every Quilltap plugin must include.
 */
export interface PluginManifest {
  /** JSON schema reference */
  $schema?: string;

  /** Package name (must start with qtap-plugin-) */
  name: string;

  /** Human-readable title */
  title: string;

  /** Plugin description */
  description: string;

  /** Semantic version */
  version: string;

  /** Author information */
  author: PluginAuthor;

  /** License identifier (SPDX) */
  license: string;

  /** Compatibility requirements */
  compatibility: PluginCompatibility;

  /** Plugin capabilities */
  capabilities: PluginCapability[];

  /** Plugin category */
  category: PluginCategory;

  /** Main entry point (relative path) */
  main: string;

  /** Whether TypeScript source is available */
  typescript?: boolean;

  /** Frontend framework used */
  frontend?: 'REACT' | 'NONE';

  /** Styling approach used */
  styling?: 'TAILWIND' | 'CSS' | 'NONE';

  /** Whether to enable by default when installed */
  enabledByDefault?: boolean;

  /** Plugin status */
  status: PluginStatus;

  /** Search keywords */
  keywords?: string[];

  /** Provider-specific configuration (for LLM_PROVIDER plugins) */
  providerConfig?: ProviderConfig;

  /** Required permissions */
  permissions?: PluginPermissions;

  /** Repository URL */
  repository?: string | {
    type: string;
    url: string;
    directory?: string;
  };

  /** Homepage URL */
  homepage?: string;

  /** Bug tracker URL */
  bugs?: string | {
    url: string;
    email?: string;
  };

  /**
   * Whether this plugin requires a server restart to activate.
   *
   * If not specified, this is inferred from capabilities:
   * - AUTH_METHODS, DATABASE_BACKEND, FILE_BACKEND, UPGRADE_MIGRATION → requires restart
   *
   * Set explicitly to override the inferred value.
   */
  requiresRestart?: boolean;
}

/**
 * Installed plugin metadata
 * Extended manifest with installation-specific information
 */
export interface InstalledPluginInfo extends PluginManifest {
  /** Whether the plugin is currently enabled */
  enabled: boolean;
  /** Installation timestamp */
  installedAt?: string;
  /** Last update timestamp */
  updatedAt?: string;
  /** Installation scope (all plugins are site-wide) */
  scope?: 'site';
  /** Path to installed plugin */
  installPath?: string;
}
