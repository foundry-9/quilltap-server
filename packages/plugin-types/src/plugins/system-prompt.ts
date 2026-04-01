/**
 * System Prompt Plugin Interface types for Quilltap plugin development
 *
 * @module @quilltap/plugin-types/plugins/system-prompt
 */

// ============================================================================
// SYSTEM PROMPT DATA
// ============================================================================

/**
 * A single system prompt entry provided by a plugin.
 *
 * Each entry represents one system prompt template that users can
 * import into their characters as a starting point for system prompts.
 */
export interface SystemPromptData {
  /** Prompt identifier (typically the filename without extension, e.g., "CLAUDE_COMPANION") */
  name: string;

  /** The full prompt content (markdown) */
  content: string;

  /**
   * Hint about which LLM model family this prompt is optimized for.
   * e.g., "CLAUDE", "GPT-4O", "GPT-5", "DEEPSEEK", "MISTRAL_LARGE"
   */
  modelHint: string;

  /**
   * Category of the prompt (e.g., "COMPANION", "ROMANTIC").
   * Used for grouping and filtering in the UI.
   */
  category: string;
}

// ============================================================================
// SYSTEM PROMPT METADATA
// ============================================================================

/**
 * Metadata for a system prompt plugin
 */
export interface SystemPromptMetadata {
  /**
   * Unique plugin identifier (lowercase, hyphens allowed).
   * Typically derived from the plugin name by dropping the "qtap-plugin-" prefix.
   * e.g., "default-system-prompts"
   */
  pluginId: string;

  /** Human-readable display name */
  displayName: string;

  /** Plugin description */
  description?: string;

  /** Plugin version */
  version?: string;
}

// ============================================================================
// SYSTEM PROMPT PLUGIN INTERFACE
// ============================================================================

/**
 * Main System Prompt Plugin Interface
 *
 * Plugins implementing this interface provide system prompt templates
 * that users can import into their characters. Each plugin can provide
 * multiple prompts, identified by `pluginShortName/promptName`.
 *
 * Prompt names must be unique within a plugin. They are typically
 * derived from filenames (e.g., "CLAUDE_COMPANION" from "CLAUDE_COMPANION.md").
 *
 * @example
 * ```typescript
 * import type { SystemPromptPlugin } from '@quilltap/plugin-types';
 *
 * export const plugin: SystemPromptPlugin = {
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
 * };
 * ```
 */
export interface SystemPromptPlugin {
  /** Plugin metadata for UI display and identification */
  metadata: SystemPromptMetadata;

  /**
   * One or more system prompts provided by this plugin.
   * Each prompt must have a unique name within the plugin.
   */
  prompts: SystemPromptData[];

  /**
   * Optional initialization function.
   * Called when the plugin is loaded.
   */
  initialize?: () => void | Promise<void>;
}

/**
 * Standard export type for system prompt plugins
 */
export interface SystemPromptPluginExport {
  /** The system prompt plugin instance */
  plugin: SystemPromptPlugin;
}
