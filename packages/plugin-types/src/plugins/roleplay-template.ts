/**
 * Roleplay Template Plugin Interface types for Quilltap plugin development
 *
 * @module @quilltap/plugin-types/plugins/roleplay-template
 */

// ============================================================================
// ROLEPLAY TEMPLATE CONFIGURATION
// ============================================================================

/**
 * Configuration for a single roleplay template
 *
 * A roleplay template defines a formatting protocol for AI responses,
 * such as how dialogue, actions, thoughts, and OOC comments should be formatted.
 */
export interface RoleplayTemplateConfig {
  /** Display name for the template */
  name: string;

  /** Optional description explaining the template's formatting style */
  description?: string;

  /**
   * The system prompt that defines the formatting rules.
   * This is prepended to character system prompts when the template is active.
   */
  systemPrompt: string;

  /** Tags for categorization and searchability */
  tags?: string[];
}

// ============================================================================
// ROLEPLAY TEMPLATE METADATA
// ============================================================================

/**
 * Metadata for a roleplay template plugin
 */
export interface RoleplayTemplateMetadata {
  /**
   * Unique template identifier (lowercase, hyphens allowed)
   * This is typically derived from the plugin name
   */
  templateId: string;

  /** Human-readable display name */
  displayName: string;

  /** Template description */
  description?: string;

  /** Template author */
  author?: string | {
    name: string;
    email?: string;
    url?: string;
  };

  /** Template tags for categorization */
  tags?: string[];

  /** Template version */
  version?: string;
}

// ============================================================================
// ROLEPLAY TEMPLATE PLUGIN INTERFACE
// ============================================================================

/**
 * Main Roleplay Template Plugin Interface
 *
 * Plugins implementing this interface can be dynamically loaded
 * by Quilltap to provide custom roleplay formatting templates.
 *
 * A plugin can provide one or more templates. Each template defines
 * a unique formatting protocol for AI responses.
 *
 * @example
 * ```typescript
 * import type { RoleplayTemplatePlugin } from '@quilltap/plugin-types';
 *
 * export const plugin: RoleplayTemplatePlugin = {
 *   metadata: {
 *     templateId: 'my-rp-format',
 *     displayName: 'My RP Format',
 *     description: 'A custom roleplay formatting style',
 *     tags: ['custom', 'roleplay'],
 *   },
 *   templates: [
 *     {
 *       name: 'My RP Format',
 *       description: 'Custom formatting with specific syntax',
 *       systemPrompt: `[FORMATTING INSTRUCTIONS]
 * 1. Dialogue: Use quotation marks
 * 2. Actions: Use asterisks *like this*
 * ...`,
 *       tags: ['custom'],
 *     },
 *   ],
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Plugin with multiple templates
 * import type { RoleplayTemplatePlugin } from '@quilltap/plugin-types';
 *
 * export const plugin: RoleplayTemplatePlugin = {
 *   metadata: {
 *     templateId: 'format-pack',
 *     displayName: 'RP Format Pack',
 *     description: 'A collection of roleplay formats',
 *   },
 *   templates: [
 *     {
 *       name: 'Screenplay',
 *       systemPrompt: '...',
 *     },
 *     {
 *       name: 'Novel',
 *       systemPrompt: '...',
 *     },
 *   ],
 * };
 * ```
 */
export interface RoleplayTemplatePlugin {
  /** Plugin metadata for UI display and identification */
  metadata: RoleplayTemplateMetadata;

  /**
   * One or more roleplay templates provided by this plugin.
   * Each template has its own name, description, and system prompt.
   */
  templates: RoleplayTemplateConfig[];

  /**
   * Optional initialization function
   * Called when the plugin is loaded
   */
  initialize?: () => void | Promise<void>;
}

/**
 * Standard export type for roleplay template plugins
 */
export interface RoleplayTemplatePluginExport {
  /** The roleplay template plugin instance */
  plugin: RoleplayTemplatePlugin;
}
