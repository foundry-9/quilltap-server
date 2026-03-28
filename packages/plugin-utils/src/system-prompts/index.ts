/**
 * System Prompt Plugin utilities
 *
 * Provides helper functions for creating and validating system prompt plugins.
 *
 * @module @quilltap/plugin-utils/system-prompts
 */

export {
  // Builder functions
  createSystemPromptPlugin,

  // Validation utilities
  validateSystemPromptPlugin,
} from './builder';

export type {
  // Builder option types
  CreateSystemPromptPluginOptions,
} from './builder';

// Re-export types from plugin-types for convenience
export type {
  SystemPromptData,
  SystemPromptMetadata,
  SystemPromptPlugin,
  SystemPromptPluginExport,
} from '@quilltap/plugin-types';
