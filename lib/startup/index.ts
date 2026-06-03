/**
 * Startup Module Exports
 *
 * Centralized exports for all startup/initialization functionality.
 */

// Plugin initialization
export {
  initializePlugins,
  isPluginSystemInitialized,
  resetPluginSystem,
  getPluginSystemState,
  type PluginInitializationResult,
} from './plugin-initialization';

// Startup state tracking
export { startupState, type StartupPhase } from './startup-state';
