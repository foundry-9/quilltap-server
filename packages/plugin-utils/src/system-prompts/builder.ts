/**
 * System Prompt Plugin Builder utilities
 *
 * Provides helper functions for creating and validating system prompt plugins.
 *
 * @module @quilltap/plugin-utils/system-prompts
 */

import type {
  SystemPromptData,
  SystemPromptMetadata,
  SystemPromptPlugin,
} from '@quilltap/plugin-types';

// ============================================================================
// BUILDER OPTIONS
// ============================================================================

/**
 * Options for creating a system prompt plugin
 */
export interface CreateSystemPromptPluginOptions {
  /** Plugin metadata */
  metadata: SystemPromptMetadata;

  /**
   * One or more system prompts.
   * Each prompt must have a unique name within the plugin.
   */
  prompts: SystemPromptData[];

  /**
   * Optional initialization function.
   * Called when the plugin is loaded.
   */
  initialize?: () => void | Promise<void>;
}

// ============================================================================
// BUILDER FUNCTIONS
// ============================================================================

/**
 * Creates a system prompt plugin.
 *
 * @param options - Plugin configuration options
 * @returns A valid SystemPromptPlugin instance
 *
 * @example
 * ```typescript
 * import { createSystemPromptPlugin } from '@quilltap/plugin-utils';
 *
 * export const plugin = createSystemPromptPlugin({
 *   metadata: {
 *     pluginId: 'my-prompts',
 *     displayName: 'My Prompt Collection',
 *     description: 'Custom system prompts for various models',
 *   },
 *   prompts: [
 *     {
 *       name: 'CLAUDE_CREATIVE',
 *       content: '# Creative Writing Prompt\n\nYou are {{char}}...',
 *       modelHint: 'CLAUDE',
 *       category: 'CREATIVE',
 *     },
 *   ],
 * });
 * ```
 */
export function createSystemPromptPlugin(
  options: CreateSystemPromptPluginOptions
): SystemPromptPlugin {
  const { metadata, prompts, initialize } = options;

  // Validate prompts
  if (prompts.length === 0) {
    throw new Error('At least one system prompt is required');
  }

  // Check for duplicate names
  const names = new Set<string>();
  for (const prompt of prompts) {
    if (!prompt.name || prompt.name.trim() === '') {
      throw new Error('Prompt name is required');
    }
    if (!prompt.content || prompt.content.trim() === '') {
      throw new Error(`Prompt "${prompt.name}" requires content`);
    }
    if (!prompt.modelHint || prompt.modelHint.trim() === '') {
      throw new Error(`Prompt "${prompt.name}" requires a modelHint`);
    }
    if (!prompt.category || prompt.category.trim() === '') {
      throw new Error(`Prompt "${prompt.name}" requires a category`);
    }
    if (names.has(prompt.name)) {
      throw new Error(`Duplicate prompt name: "${prompt.name}"`);
    }
    names.add(prompt.name);
  }

  // Create the plugin
  const plugin: SystemPromptPlugin = {
    metadata,
    prompts,
  };

  // Add initialize function if provided
  if (initialize) {
    plugin.initialize = async () => {
      await initialize();
    };
  }

  return plugin;
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validates a complete system prompt plugin
 *
 * @param plugin - The plugin to validate
 * @returns True if valid, throws Error if invalid
 */
export function validateSystemPromptPlugin(plugin: SystemPromptPlugin): boolean {
  // Validate metadata
  if (!plugin.metadata) {
    throw new Error('Plugin metadata is required');
  }

  if (!plugin.metadata.pluginId || plugin.metadata.pluginId.trim() === '') {
    throw new Error('Plugin metadata.pluginId is required');
  }

  if (!/^[a-z0-9-]+$/.test(plugin.metadata.pluginId)) {
    throw new Error('Plugin pluginId must be lowercase alphanumeric with hyphens only');
  }

  if (!plugin.metadata.displayName || plugin.metadata.displayName.trim() === '') {
    throw new Error('Plugin metadata.displayName is required');
  }

  // Validate prompts
  if (!plugin.prompts || !Array.isArray(plugin.prompts) || plugin.prompts.length === 0) {
    throw new Error('Plugin must have at least one prompt');
  }

  const names = new Set<string>();
  for (const prompt of plugin.prompts) {
    if (!prompt.name || prompt.name.trim() === '') {
      throw new Error('Prompt name is required');
    }
    if (!prompt.content || prompt.content.trim() === '') {
      throw new Error(`Prompt "${prompt.name}" requires content`);
    }
    if (!prompt.modelHint || prompt.modelHint.trim() === '') {
      throw new Error(`Prompt "${prompt.name}" requires a modelHint`);
    }
    if (!prompt.category || prompt.category.trim() === '') {
      throw new Error(`Prompt "${prompt.name}" requires a category`);
    }
    if (names.has(prompt.name)) {
      throw new Error(`Duplicate prompt name: "${prompt.name}"`);
    }
    names.add(prompt.name);
  }

  return true;
}
