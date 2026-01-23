/**
 * Startup State Tracking
 *
 * Tracks the state of server startup, including whether migrations have completed.
 * This is used to ensure data access waits for migrations before serving requests.
 *
 * The startup sequence is:
 * 1. 'pending' - Server just started
 * 2. 'migrations' - Running startup migrations (CRITICAL - must complete)
 * 3. 'mongodb' - MongoDB initialization in progress
 * 4. 'plugins' - Plugin initialization in progress
 * 5. 'file-storage' - File storage initialization in progress
 * 6. 'complete' - All initialization complete
 * 7. 'failed' - Initialization failed (server still runs but may have issues)
 *
 * NOTE: State is stored in `global` to persist across Next.js module reloads.
 * This is critical because instrumentation.ts runs in a separate context from
 * API routes, and module-local state would not be shared between them.
 */

import { logger } from '@/lib/logger';

export type StartupPhase =
  | 'pending'
  | 'migrations'
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

// Extend globalThis type for our startup state
declare global {
  // eslint-disable-next-line no-var
  var __quilltapStartupState: StartupStateData | undefined;
  // eslint-disable-next-line no-var
  var __quilltapStartupReadyPromise: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __quilltapStartupReadyResolve: (() => void) | undefined;
}

/**
 * Get or create the global startup state
 * Using global ensures state persists across Next.js module reloads
 */
function getGlobalState(): StartupStateData {
  if (!global.__quilltapStartupState) {
    global.__quilltapStartupState = {
      phase: 'pending',
      migrationsComplete: false,
      isReady: false,
      startTime: Date.now(),
      readyTime: null,
      error: null,
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

    logger.debug('Startup phase changed', {
      context: 'startup-state.setPhase',
      previousPhase,
      newPhase: phase,
      elapsedMs: Date.now() - state.startTime,
    });

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
    logger.debug('Migrations marked complete', {
      context: 'startup-state.markMigrationsComplete',
      elapsedMs: Date.now() - state.startTime,
    });
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
    };
    setReadyPromise(undefined);
    setReadyResolve(undefined);
  },
};
