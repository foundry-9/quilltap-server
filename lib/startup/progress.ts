/**
 * Startup Progress Publisher
 *
 * In-memory ring buffer + current-label tracker for the server's startup
 * sequence. Drives the loading-screen UI at `/api/v1/system/startup-status`.
 *
 * Companion to `startup-state.ts`:
 *   - `startupState` owns the coarse phase (pending/locked/migrations/...)
 *     and the readiness gate.
 *   - `startupProgress` owns the *event stream* — what's happening within
 *     each phase, with prettified labels and optional sub-progress tiers.
 *
 * Stored on `globalThis` so state survives Next.js module reloads, same as
 * startup-state.
 */

import { startupState } from './startup-state';
import { prettify } from './prettify';

export type ProgressTier = {
  current: number;
  total: number;
  unit: string;
};

export type StartupEventLevel = 'info' | 'warn' | 'error';

export interface StartupEvent {
  /** Epoch ms when the event was emitted. */
  ts: number;
  /** Coarse phase from `startupState` at the time of emission. */
  phase: string;
  /** Machine-readable label (e.g. migration id, subsystem milestone key). */
  rawLabel: string;
  /** Human-friendly label, already prettified. */
  prettyLabel: string;
  /** Optional additional detail (e.g. "41 records preserved", "224/459 files"). */
  detail?: string;
  level: StartupEventLevel;
  /** Optional progress tiers when the event itself represents progress. */
  progress?: ProgressTier[];
}

export interface StartupProgressSnapshot {
  /** Pretty label for what the server is doing *right now*, or null. */
  currentLabel: string | null;
  /** The raw label backing currentLabel, for UI debugging / testing. */
  currentRawLabel: string | null;
  /** Current sub-progress tiers (outer-to-inner) for the active work, if any. */
  currentSubProgress: ProgressTier[] | null;
  /** Recent events, oldest first. Capped at EVENT_BUFFER_SIZE. */
  recentEvents: StartupEvent[];
}

interface StartupProgressData {
  currentLabel: string | null;
  currentRawLabel: string | null;
  currentSubProgress: ProgressTier[] | null;
  events: StartupEvent[];
}

const EVENT_BUFFER_SIZE = 25;

declare global {
  var __quilltapStartupProgress: StartupProgressData | undefined;
}

function getState(): StartupProgressData {
  if (!global.__quilltapStartupProgress) {
    global.__quilltapStartupProgress = {
      currentLabel: null,
      currentRawLabel: null,
      currentSubProgress: null,
      events: [],
    };
  }
  return global.__quilltapStartupProgress;
}

function pushEvent(event: StartupEvent): void {
  const state = getState();
  state.events.push(event);
  if (state.events.length > EVENT_BUFFER_SIZE) {
    state.events.splice(0, state.events.length - EVENT_BUFFER_SIZE);
  }
}

export const startupProgress = {
  /**
   * Set the current high-level label — what the server is working on right
   * now. Emits an info event so the recent-events tail reflects the transition.
   */
  setCurrent(
    rawLabel: string,
    opts?: { prettyLabel?: string; detail?: string }
  ): void {
    const state = getState();
    const prettyLabel = opts?.prettyLabel ?? prettify(rawLabel);
    state.currentRawLabel = rawLabel;
    state.currentLabel = prettyLabel;
    state.currentSubProgress = null;
    pushEvent({
      ts: Date.now(),
      phase: startupState.getPhase(),
      rawLabel,
      prettyLabel,
      detail: opts?.detail,
      level: 'info',
    });
  },

  /**
   * Clear the current label (silent transition, no event).
   */
  clearCurrent(): void {
    const state = getState();
    state.currentLabel = null;
    state.currentRawLabel = null;
    state.currentSubProgress = null;
  },

  /**
   * Replace sub-progress tiers for the currently active work. Outer-to-inner.
   * Pass null or an empty array to clear. Does not emit an event — UI polls
   * the snapshot, so progress updates flow on the next poll tick.
   */
  setSubProgress(tiers: ProgressTier[] | null): void {
    const state = getState();
    state.currentSubProgress = tiers && tiers.length > 0 ? tiers : null;
  },

  /**
   * Emit a one-off event without changing the current label. Used by
   * subsystems that want to log a milestone (e.g. "Reconciliation finished —
   * 41 records preserved") without claiming the headline.
   */
  publish(event: {
    rawLabel: string;
    prettyLabel?: string;
    detail?: string;
    level?: StartupEventLevel;
    progress?: ProgressTier[];
  }): void {
    pushEvent({
      ts: Date.now(),
      phase: startupState.getPhase(),
      rawLabel: event.rawLabel,
      prettyLabel: event.prettyLabel ?? prettify(event.rawLabel),
      detail: event.detail,
      level: event.level ?? 'info',
      progress: event.progress,
    });
  },

  /**
   * Snapshot for the `/api/v1/system/startup-status` endpoint.
   */
  snapshot(): StartupProgressSnapshot {
    const state = getState();
    return {
      currentLabel: state.currentLabel,
      currentRawLabel: state.currentRawLabel,
      currentSubProgress: state.currentSubProgress ? [...state.currentSubProgress] : null,
      recentEvents: [...state.events],
    };
  },

  /**
   * Reset state. Used by tests.
   */
  reset(): void {
    global.__quilltapStartupProgress = {
      currentLabel: null,
      currentRawLabel: null,
      currentSubProgress: null,
      events: [],
    };
  },
};
