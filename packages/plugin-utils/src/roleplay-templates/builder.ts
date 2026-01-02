/**
 * Roleplay Template Plugin Builder utilities
 *
 * Provides helper functions for creating and validating roleplay template plugins.
 *
 * @module @quilltap/plugin-utils/roleplay-templates
 */

import type {
  RoleplayTemplateConfig,
  RoleplayTemplateMetadata,
  RoleplayTemplatePlugin,
} from '@quilltap/plugin-types';
import { createPluginLogger } from '../logging';

// ============================================================================
// BUILDER OPTIONS
// ============================================================================

/**
 * Options for creating a roleplay template plugin
 */
export interface CreateRoleplayTemplatePluginOptions {
  /** Plugin metadata */
  metadata: RoleplayTemplateMetadata;

  /**
   * One or more roleplay templates.
   * Pass a single template object or an array of templates.
   */
  templates: RoleplayTemplateConfig | RoleplayTemplateConfig[];

  /**
   * Optional initialization function.
   * Called when the plugin is loaded.
   */
  initialize?: () => void | Promise<void>;

  /**
   * Whether to enable debug logging.
   * Defaults to false.
   */
  enableLogging?: boolean;
}

/**
 * Simplified options for plugins that provide a single template
 */
export interface CreateSingleTemplatePluginOptions {
  /** Unique template identifier (lowercase, hyphens allowed) */
  templateId: string;

  /** Human-readable display name */
  displayName: string;

  /** Template description */
  description?: string;

  /**
   * The system prompt that defines the formatting rules.
   * This is prepended to character system prompts when the template is active.
   */
  systemPrompt: string;

  /** Template author */
  author?: string | {
    name: string;
    email?: string;
    url?: string;
  };

  /** Tags for categorization and searchability */
  tags?: string[];

  /** Template version */
  version?: string;

  /**
   * Optional initialization function.
   * Called when the plugin is loaded.
   */
  initialize?: () => void | Promise<void>;

  /**
   * Whether to enable debug logging.
   * Defaults to false.
   */
  enableLogging?: boolean;
}

// ============================================================================
// BUILDER FUNCTIONS
// ============================================================================

/**
 * Creates a roleplay template plugin with full control over metadata and templates.
 *
 * Use this when you want to provide multiple templates or have fine-grained
 * control over the plugin structure.
 *
 * @param options - Plugin configuration options
 * @returns A valid RoleplayTemplatePlugin instance
 *
 * @example
 * ```typescript
 * import { createRoleplayTemplatePlugin } from '@quilltap/plugin-utils';
 *
 * export const plugin = createRoleplayTemplatePlugin({
 *   metadata: {
 *     templateId: 'my-rp-format',
 *     displayName: 'My RP Format',
 *     description: 'A custom roleplay formatting style',
 *   },
 *   templates: [
 *     {
 *       name: 'My RP Format',
 *       description: 'Custom formatting with specific syntax',
 *       systemPrompt: '[FORMATTING INSTRUCTIONS]...',
 *       tags: ['custom'],
 *     },
 *   ],
 * });
 * ```
 */
export function createRoleplayTemplatePlugin(
  options: CreateRoleplayTemplatePluginOptions
): RoleplayTemplatePlugin {
  const { metadata, templates, initialize, enableLogging = false } = options;

  // Normalize templates to array
  const templateArray = Array.isArray(templates) ? templates : [templates];

  // Validate templates
  if (templateArray.length === 0) {
    throw new Error('At least one template is required');
  }

  for (const template of templateArray) {
    if (!template.name || template.name.trim() === '') {
      throw new Error('Template name is required');
    }
    if (!template.systemPrompt || template.systemPrompt.trim() === '') {
      throw new Error(`Template "${template.name}" requires a systemPrompt`);
    }
  }

  // Create the plugin
  const plugin: RoleplayTemplatePlugin = {
    metadata: {
      ...metadata,
      // Ensure tags from templates are included in metadata if not already set
      tags: metadata.tags ?? Array.from(
        new Set(templateArray.flatMap(t => t.tags ?? []))
      ),
    },
    templates: templateArray,
  };

  // Add initialize function with optional logging
  if (initialize || enableLogging) {
    plugin.initialize = async () => {
      if (enableLogging) {
        const logger = createPluginLogger(metadata.templateId);
        logger.debug('Roleplay template plugin loaded', {
          context: 'init',
          templateId: metadata.templateId,
          displayName: metadata.displayName,
          templateCount: templateArray.length,
          templateNames: templateArray.map(t => t.name),
        });
      }

      if (initialize) {
        await initialize();
      }
    };
  }

  return plugin;
}

/**
 * Creates a simple roleplay template plugin with a single template.
 *
 * This is a convenience function for the common case of a plugin
 * that provides just one roleplay template.
 *
 * @param options - Simplified plugin configuration
 * @returns A valid RoleplayTemplatePlugin instance
 *
 * @example
 * ```typescript
 * import { createSingleTemplatePlugin } from '@quilltap/plugin-utils';
 *
 * export const plugin = createSingleTemplatePlugin({
 *   templateId: 'quilltap-rp',
 *   displayName: 'Quilltap RP',
 *   description: 'Custom formatting with [actions], {thoughts}, and // OOC',
 *   systemPrompt: `[FORMATTING INSTRUCTIONS]
 * 1. DIALOGUE: Write as bare text without quotes
 * 2. ACTIONS: Use [square brackets]
 * 3. THOUGHTS: Use {curly braces}
 * 4. OOC: Use // prefix`,
 *   tags: ['quilltap', 'custom'],
 * });
 * ```
 */
export function createSingleTemplatePlugin(
  options: CreateSingleTemplatePluginOptions
): RoleplayTemplatePlugin {
  const {
    templateId,
    displayName,
    description,
    systemPrompt,
    author,
    tags,
    version,
    initialize,
    enableLogging,
  } = options;

  return createRoleplayTemplatePlugin({
    metadata: {
      templateId,
      displayName,
      description,
      author,
      tags,
      version,
    },
    templates: {
      name: displayName,
      description,
      systemPrompt,
      tags,
    },
    initialize,
    enableLogging,
  });
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validates a roleplay template configuration
 *
 * @param template - The template configuration to validate
 * @returns True if valid, throws Error if invalid
 */
export function validateTemplateConfig(template: RoleplayTemplateConfig): boolean {
  if (!template.name || template.name.trim() === '') {
    throw new Error('Template name is required');
  }

  if (template.name.length > 100) {
    throw new Error('Template name must be 100 characters or less');
  }

  if (!template.systemPrompt || template.systemPrompt.trim() === '') {
    throw new Error('Template systemPrompt is required');
  }

  if (template.description && template.description.length > 500) {
    throw new Error('Template description must be 500 characters or less');
  }

  if (template.tags) {
    if (!Array.isArray(template.tags)) {
      throw new Error('Template tags must be an array');
    }
    for (const tag of template.tags) {
      if (typeof tag !== 'string') {
        throw new Error('All tags must be strings');
      }
    }
  }

  return true;
}

/**
 * Validates a complete roleplay template plugin
 *
 * @param plugin - The plugin to validate
 * @returns True if valid, throws Error if invalid
 */
export function validateRoleplayTemplatePlugin(plugin: RoleplayTemplatePlugin): boolean {
  // Validate metadata
  if (!plugin.metadata) {
    throw new Error('Plugin metadata is required');
  }

  if (!plugin.metadata.templateId || plugin.metadata.templateId.trim() === '') {
    throw new Error('Plugin metadata.templateId is required');
  }

  if (!/^[a-z0-9-]+$/.test(plugin.metadata.templateId)) {
    throw new Error('Plugin templateId must be lowercase alphanumeric with hyphens only');
  }

  if (!plugin.metadata.displayName || plugin.metadata.displayName.trim() === '') {
    throw new Error('Plugin metadata.displayName is required');
  }

  // Validate templates
  if (!plugin.templates || !Array.isArray(plugin.templates) || plugin.templates.length === 0) {
    throw new Error('Plugin must have at least one template');
  }

  for (const template of plugin.templates) {
    validateTemplateConfig(template);
  }

  return true;
}
