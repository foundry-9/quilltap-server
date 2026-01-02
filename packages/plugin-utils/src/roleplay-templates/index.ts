/**
 * Roleplay Template Plugin utilities
 *
 * Provides helper functions for creating and validating roleplay template plugins.
 *
 * @module @quilltap/plugin-utils/roleplay-templates
 */

export {
  // Builder functions
  createRoleplayTemplatePlugin,
  createSingleTemplatePlugin,

  // Validation utilities
  validateTemplateConfig,
  validateRoleplayTemplatePlugin,
} from './builder';

export type {
  // Builder option types
  CreateRoleplayTemplatePluginOptions,
  CreateSingleTemplatePluginOptions,
} from './builder';

// Re-export types from plugin-types for convenience
export type {
  RoleplayTemplateConfig,
  RoleplayTemplateMetadata,
  RoleplayTemplatePlugin,
  RoleplayTemplatePluginExport,
} from '@quilltap/plugin-types';
