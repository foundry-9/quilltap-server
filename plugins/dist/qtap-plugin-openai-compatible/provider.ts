/**
 * OpenAI-Compatible Provider Implementation for Quilltap Plugin
 *
 * This module re-exports the OpenAICompatibleProvider from @quilltap/plugin-utils,
 * which is the canonical implementation. This allows:
 * - Bundled plugins to use the same code as external plugins
 * - External plugins to extend the same base class
 * - Single source of truth for the implementation
 */

// Re-export everything from plugin-utils
export {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderConfig,
} from '@quilltap/plugin-utils';
