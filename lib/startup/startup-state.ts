/**
 * Startup State Tracking
 *
 * Tracks the state of server startup, including whether migrations have completed.
 * This is used to ensure data access waits for migrations before serving requests.
 *
 * The startup sequence is:
 * 1. 'pending' - Server just started
 * 2. 'mongodb' - MongoDB initialization in progress
 * 3. 'plugins' - Plugin initialization (includes migrations) in progress
 * 4. 'file-storage' - File storage initialization in progress
 * 5. 'complete' - All initialization complete
 * 6. 'failed' - Initialization failed (server still runs but may have issues)
 */

import { logger } from '@/lib/logger';

export type StartupPhase =
  | 'pending'
  | 'mongodb'
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
}

/**
 * Promise that resolves when startup is complete
 */
let readyPromise: Promise<void> | null = null;
let readyResolve: (() => void) | null = null;

/**
 * Internal state
 */
const state: StartupStateData = {
  phase: 'pending',
  migrationsComplete: false,
  isReady: false,
  startTime: Date.now(),
  readyTime: null,
  error: null,
};

/**
 * Startup state management singleton
 */
export const startupState = {
  /**
   * Get the current startup phase
   */
  getPhase(): StartupPhase {
    return state.phase;
  },

  /**
   * Set the current startup phase
   */
  setPhase(phase: StartupPhase): void {
    const previousPhase = state.phase;
    state.phase = phase;

    logger.debug('Startup phase changed', {
      context: 'startup-state.setPhase',
      previousPhase,
      newPhase: phase,
      elapsedMs: Date.now() - state.startTime,
    });

    if (phase === 'failed') {
      // If startup failed, resolve the ready promise anyway
      // so waiting code doesn't hang forever
      if (readyResolve) {
        readyResolve();
      }
    }
  },

  /**
   * Mark migrations as complete
   */
  markMigrationsComplete(): void {
    state.migrationsComplete = true;
    logger.debug('Migrations marked complete', {
      context: 'startup-state.markMigrationsComplete',
      elapsedMs: Date.now() - state.startTime,
    });
  },

  /**
   * Check if migrations are complete
   */
  areMigrationsComplete(): boolean {
    return state.migrationsComplete;
  },

  /**
   * Mark the server as ready
   */
  markReady(): void {
    state.isReady = true;
    state.readyTime = Date.now();

    logger.info('Server startup complete', {
      context: 'startup-state.markReady',
      totalStartupMs: state.readyTime - state.startTime,
      migrationsComplete: state.migrationsComplete,
    });

    // Resolve the ready promise
    if (readyResolve) {
      readyResolve();
    }
  },

  /**
   * Check if the server is ready
   */
  isReady(): boolean {
    return state.isReady;
  },

  /**
   * Set an error message
   */
  setError(error: string): void {
    state.error = error;
  },

  /**
   * Get startup stats
   */
  getStats(): StartupStateData {
    return { ...state };
  },

  /**
   * Wait for the server to be ready
   * Returns immediately if already ready
   * Times out after maxWaitMs (default 30 seconds)
   */
  async waitForReady(maxWaitMs: number = 30000): Promise<boolean> {
    // Already ready
    if (state.isReady) {
      return true;
    }

    // Create the ready promise if it doesn't exist
    if (!readyPromise) {
      readyPromise = new Promise<void>((resolve) => {
        readyResolve = resolve;
      });
    }

    // Wait with timeout
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, maxWaitMs);
    });

    await Promise.race([readyPromise, timeoutPromise]);

    return state.isReady;
  },

  /**
   * Wait for migrations to complete
   * If startup hasn't completed migrations yet, this will wait
   * Returns true if migrations are complete, false if timed out
   */
  async waitForMigrations(maxWaitMs: number = 30000): Promise<boolean> {
    // Already complete
    if (state.migrationsComplete) {
      return true;
    }

    // Wait for ready (which includes migrations)
    const startWait = Date.now();
    const pollInterval = 100;

    while (Date.now() - startWait < maxWaitMs) {
      if (state.migrationsComplete || state.phase === 'complete' || state.phase === 'failed') {
        return state.migrationsComplete;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    logger.warn('Timed out waiting for migrations', {
      context: 'startup-state.waitForMigrations',
      maxWaitMs,
      currentPhase: state.phase,
      migrationsComplete: state.migrationsComplete,
    });

    return state.migrationsComplete;
  },

  /**
   * Reset state (for testing)
   */
  reset(): void {
    state.phase = 'pending';
    state.migrationsComplete = false;
    state.isReady = false;
    state.startTime = Date.now();
    state.readyTime = null;
    state.error = null;
    readyPromise = null;
    readyResolve = null;
  },
};
