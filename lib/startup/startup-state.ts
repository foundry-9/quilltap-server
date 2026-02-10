/**
 * Startup State Tracking
 *
 * Tracks the state of server startup, including whether migrations have completed.
 * This is used to ensure data access waits for migrations before serving requests.
 *
 * The startup sequence is:
 * 1. 'pending' - Server just started
 * 2. 'migrations' - Running startup migrations (CRITICAL - must complete)
 * 3. 'seeding' - Seeding initial data (first startup only, non-blocking)
 * 4. 'plugin-updates' - Auto-upgrading npm-installed plugins (non-blocking)
 * 5. 'plugins' - Plugin initialization in progress
 * 6. 'file-storage' - File storage initialization in progress
 * 7. 'complete' - All initialization complete
 * 8. 'failed' - Initialization failed (server still runs but may have issues)
 *
 * NOTE: State is stored in `global` to persist across Next.js module reloads.
 * This is critical because instrumentation.ts runs in a separate context from
 * API routes, and module-local state would not be shared between them.
 */

import { logger } from '@/lib/logger';
import type { UpgradeResults } from '@/lib/plugins/upgrader';
import type { PepperState } from './pepper-vault';

export type StartupPhase =
  | 'pending'
  | 'migrations'
  | 'seeding'
  | 'plugin-updates'
  | 'plugins'
  | 'file-storage'
  | 'complete'
  | 'failed';

interface StartupStateData {
  phase: StartupPhase;
  migrationsComplete: boolean;
  isReady: boolean;
  startTime: number;
  readyTime: number | null;
  error: string | null;
  /** Plugin upgrade results from startup */
  pluginUpgrades: UpgradeResults | null;
  /** Whether upgrade notifications have been sent to the client */
  upgradesNotified: boolean;
  /** Pepper vault state */
  pepperState: PepperState;
}

// Extend globalThis type for our startup state
declare global {
  var __quilltapStartupState: StartupStateData | undefined;
  var __quilltapStartupReadyPromise: Promise<void> | undefined;
  var __quilltapStartupReadyResolve: (() => void) | undefined;
}

/**
 * Get or create the global startup state
 * Using global ensures state persists across Next.js module reloads
 */
function getGlobalState(): StartupStateData {
  if (!global.__quilltapStartupState) {
    // In test environment, default pepper to resolved so tests don't need
    // to explicitly configure the pepper vault
    const isTest = process.env.NODE_ENV === 'test';
    global.__quilltapStartupState = {
      phase: 'pending',
      migrationsComplete: false,
      isReady: false,
      startTime: Date.now(),
      readyTime: null,
      error: null,
      pluginUpgrades: null,
      upgradesNotified: false,
      pepperState: isTest ? 'resolved' : 'needs-setup',
    };
  }
  return global.__quilltapStartupState;
}

/**
 * Get the ready promise resolver
 */
function getReadyResolve(): (() => void) | undefined {
  return global.__quilltapStartupReadyResolve;
}

/**
 * Set the ready promise resolver
 */
function setReadyResolve(resolve: (() => void) | undefined): void {
  global.__quilltapStartupReadyResolve = resolve;
}

/**
 * Get the ready promise
 */
function getReadyPromise(): Promise<void> | undefined {
  return global.__quilltapStartupReadyPromise;
}

/**
 * Set the ready promise
 */
function setReadyPromise(promise: Promise<void> | undefined): void {
  global.__quilltapStartupReadyPromise = promise;
}

/**
 * Startup state management singleton
 */
export const startupState = {
  /**
   * Get the current startup phase
   */
  getPhase(): StartupPhase {
    return getGlobalState().phase;
  },

  /**
   * Set the current startup phase
   */
  setPhase(phase: StartupPhase): void {
    const state = getGlobalState();
    const previousPhase = state.phase;
    state.phase = phase;
    if (phase === 'failed') {
      // If startup failed, resolve the ready promise anyway
      // so waiting code doesn't hang forever
      const readyResolve = getReadyResolve();
      if (readyResolve) {
        readyResolve();
      }
    }
  },

  /**
   * Mark migrations as complete
   */
  markMigrationsComplete(): void {
    const state = getGlobalState();
    state.migrationsComplete = true;
  },

  /**
   * Check if migrations are complete
   */
  areMigrationsComplete(): boolean {
    return getGlobalState().migrationsComplete;
  },

  /**
   * Mark the server as ready
   */
  markReady(): void {
    const state = getGlobalState();
    state.isReady = true;
    state.readyTime = Date.now();

    logger.info('Server startup complete', {
      context: 'startup-state.markReady',
      totalStartupMs: state.readyTime - state.startTime,
      migrationsComplete: state.migrationsComplete,
    });

    // Resolve the ready promise
    const readyResolve = getReadyResolve();
    if (readyResolve) {
      readyResolve();
    }
  },

  /**
   * Check if the server is ready
   */
  isReady(): boolean {
    return getGlobalState().isReady;
  },

  /**
   * Set an error message
   */
  setError(error: string): void {
    getGlobalState().error = error;
  },

  /**
   * Get startup stats
   */
  getStats(): StartupStateData {
    return { ...getGlobalState() };
  },

  /**
   * Store plugin upgrade results
   */
  setPluginUpgrades(results: UpgradeResults): void {
    const state = getGlobalState();
    state.pluginUpgrades = results;
  },

  /**
   * Get plugin upgrade results
   */
  getPluginUpgrades(): UpgradeResults | null {
    return getGlobalState().pluginUpgrades;
  },

  /**
   * Mark that upgrade notifications have been sent to the client
   */
  markUpgradesNotified(): void {
    const state = getGlobalState();
    state.upgradesNotified = true;
  },

  /**
   * Check if there are un-notified upgrades
   */
  hasUnnotifiedUpgrades(): boolean {
    const state = getGlobalState();
    if (state.upgradesNotified) {
      return false;
    }
    const upgrades = state.pluginUpgrades;
    if (!upgrades) {
      return false;
    }
    // Has un-notified upgrades if there are any upgraded or failed plugins
    return upgrades.upgraded.length > 0 || upgrades.failed.length > 0;
  },

  /**
   * Set the pepper vault state
   */
  setPepperState(state: PepperState): void {
    getGlobalState().pepperState = state;
  },

  /**
   * Get the pepper vault state
   */
  getPepperState(): PepperState {
    return getGlobalState().pepperState;
  },

  /**
   * Check if the pepper is available and encryption is ready.
   * Both 'resolved' and 'needs-vault-storage' are operational states
   * — the pepper IS in process.env and works, just needs vault storage.
   */
  isPepperResolved(): boolean {
    const state = getGlobalState().pepperState;
    return state === 'resolved' || state === 'needs-vault-storage';
  },

  /**
   * Wait for the server to be ready
   * Returns immediately if already ready
   * Times out after maxWaitMs (default 30 seconds)
   */
  async waitForReady(maxWaitMs: number = 30000): Promise<boolean> {
    const state = getGlobalState();

    // Already ready
    if (state.isReady) {
      return true;
    }

    // Create the ready promise if it doesn't exist
    let readyPromise = getReadyPromise();
    if (!readyPromise) {
      readyPromise = new Promise<void>((resolve) => {
        setReadyResolve(resolve);
      });
      setReadyPromise(readyPromise);
    }

    // Wait with timeout
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, maxWaitMs);
    });

    await Promise.race([readyPromise, timeoutPromise]);

    return getGlobalState().isReady;
  },

  /**
   * Wait for migrations to complete
   * If startup hasn't completed migrations yet, this will wait
   * Returns true if migrations are complete, false if timed out
   *
   * Note: With the new migration system, migrations run in instrumentation.ts
   * before the server starts accepting requests. This wait is now primarily
   * a safety check for edge cases.
   */
  async waitForMigrations(maxWaitMs: number = 30000): Promise<boolean> {
    const state = getGlobalState();

    // Already complete
    if (state.migrationsComplete) {
      return true;
    }

    // Wait for ready (which includes migrations)
    const startWait = Date.now();
    const pollInterval = 100;

    while (Date.now() - startWait < maxWaitMs) {
      const currentState = getGlobalState();
      if (currentState.migrationsComplete || currentState.phase === 'complete' || currentState.phase === 'failed') {
        return currentState.migrationsComplete;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    const currentState = getGlobalState();
    logger.warn('Timed out waiting for migrations', {
      context: 'startup-state.waitForMigrations',
      maxWaitMs,
      currentPhase: currentState.phase,
      migrationsComplete: currentState.migrationsComplete,
    });

    return currentState.migrationsComplete;
  },

  /**
   * Reset state (for testing)
   */
  reset(): void {
    global.__quilltapStartupState = {
      phase: 'pending',
      migrationsComplete: false,
      isReady: false,
      startTime: Date.now(),
      readyTime: null,
      error: null,
      pluginUpgrades: null,
      upgradesNotified: false,
      pepperState: 'needs-setup',
    };
    setReadyPromise(undefined);
    setReadyResolve(undefined);
  },
};
