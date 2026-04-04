/**
 * Moderation Provider Plugin Interface
 *
 * Re-exports types from @quilltap/plugin-types as the single source of truth.
 * This file is kept for backward compatibility and for the createModerationProviderLogger function.
 *
 * @module plugins/interfaces/moderation-provider-plugin
 */

import { logger } from '@/lib/logger';

// Re-export moderation types (deprecated, use scoring types)
export type {
  ModerationProviderMetadata,
  ModerationProviderConfigRequirements,
  ModerationCategoryResult,
  ModerationResult,
  ModerationProviderPlugin,
  ModerationProviderPluginExport,
} from '@quilltap/plugin-types';

// Re-export scoring types (new canonical names)
export type {
  ScoringProviderMetadata,
  ScoringProviderConfigRequirements,
  ScoringProviderPlugin,
  ScoringProviderPluginExport,
  ScoringProvider,
  ScoringTask,
  ScoringInput,
  CategoryScore,
  ScoringResult,
} from '@quilltap/plugin-types';

/**
 * Create a debug logger for moderation provider plugin operations
 *
 * @param providerName The name of the moderation provider for context
 * @returns A logger instance with moderation provider context
 *
 * @internal
 */
export function createModerationProviderLogger(providerName: string) {
  return logger.child({
    module: 'plugin-moderation-provider',
    provider: providerName,
  });
}
