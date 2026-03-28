/**
 * Abstract Base Registry
 *
 * Provides the foundational global-state persistence pattern, initialization
 * lifecycle, and common utility methods shared by all singleton registries
 * in the Quilltap plugin system.
 *
 * @module plugins/base-registry
 */

import { logger as rootLogger } from '@/lib/logger';
import type { Logger } from '@/lib/logger';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimal state shape every registry must have.
 */
export interface BaseRegistryState {
  initialized: boolean;
  lastInitTime: Date | null;
}

// ============================================================================
// ABSTRACT BASE REGISTRY
// ============================================================================

/**
 * Abstract base class for all singleton registries.
 *
 * Centralises the HMR-safe global state persistence pattern used by every
 * registry: a `declare global` variable accessed through `globalThis`, with
 * lazy initialisation on first access.
 *
 * Subclasses must provide:
 *  - `registryName`   – used as the `module` field in the child logger
 *  - `globalStateKey`  – the `globalThis` key (e.g. `'__quilltapFooState'`)
 *  - `createEmptyState()` – factory for the initial state object
 */
export abstract class AbstractRegistry<TState extends BaseRegistryState> {
  /** Human-readable registry name, used for logging. */
  protected abstract readonly registryName: string;

  /** Key on `globalThis` where the state object is stored. */
  protected abstract readonly globalStateKey: string;

  /** Create a fresh, uninitialised state object. */
  protected abstract createEmptyState(): TState;

  /** Module-scoped logger. Initialised lazily to allow `registryName` to be set by subclass. */
  private _registryLogger: Logger | null = null;

  protected get registryLogger(): Logger {
    if (!this._registryLogger) {
      this._registryLogger = rootLogger.child({ module: this.registryName });
    }
    return this._registryLogger;
  }

  /**
   * Access the global registry state, creating it on first access.
   * This ensures state survives Next.js hot module reloads in development.
   */
  protected get state(): TState {
    const g = globalThis as Record<string, unknown>;
    if (!g[this.globalStateKey]) {
      g[this.globalStateKey] = this.createEmptyState();
    }
    return g[this.globalStateKey] as TState;
  }

  /**
   * Check if the registry has been initialised.
   */
  isInitialized(): boolean {
    return this.state.initialized;
  }

  /**
   * Reset the registry to a fresh state (primarily for testing).
   */
  reset(): void {
    (globalThis as Record<string, unknown>)[this.globalStateKey] = this.createEmptyState();
  }
}
