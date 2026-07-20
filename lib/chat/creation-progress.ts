/**
 * Chat-Creation Progress Bus ("The Green Room")
 *
 * `POST /api/v1/chats` does a lot of slow, blocking work before it returns —
 * resolving the cast, running a per-character LLM "choose what to wear" step,
 * compiling identity stacks, backfilling continuation history, seeding the
 * opening scene. None of that is visible to the user today.
 *
 * That request must keep returning JSON (the client's raw fetch and the
 * autonomous/continuation branches all depend on it), so progress travels on a
 * SEPARATE side-channel keyed by a client-generated correlation id (`progressId`).
 * The create handler publishes events here; a standalone SSE route
 * (`/api/v1/chats/creation-progress`) subscribes and streams them to the
 * blocking status dialog.
 *
 * Design notes:
 *   - Single-user, single-process server → an in-memory `globalThis` singleton
 *     is sufficient (same reload-safe storage trick as `lib/startup/progress.ts`).
 *   - Each channel BUFFERS its events so a subscriber that connects a tick late
 *     (the dialog opens its reader around the same instant the POST fires)
 *     replays everything and never misses early events or the terminal signal.
 *   - `done`/`error` are terminal; after either, the channel is scheduled for
 *     cleanup on a TTL so a late reconnect still resolves before the buffer is
 *     dropped.
 *   - When `progressId` is absent (tests, older callers), the emitter is a
 *     no-op and chat creation behaves exactly as before.
 */

import { EventEmitter } from 'events';

/** One resolved garment in a slot preview. */
export interface OutfitPreviewEntry {
  id: string;
  title: string;
  isComposite: boolean;
}

/** The decided four-slot outfit, rendered read-only in the dialog. */
export interface OutfitPreviewSlots {
  top: OutfitPreviewEntry[];
  bottom: OutfitPreviewEntry[];
  footwear: OutfitPreviewEntry[];
  accessories: OutfitPreviewEntry[];
}

export type CreationProgressEvent =
  | { kind: 'status'; message: string; ts: number }
  | { kind: 'log'; message: string; level?: 'info' | 'warn' | 'error'; ts: number }
  | { kind: 'wardrobe-start'; characterId: string; characterName: string; ts: number }
  | {
      kind: 'wardrobe-result';
      characterId: string;
      characterName: string;
      slots: OutfitPreviewSlots;
      ts: number;
    }
  | { kind: 'done'; ts: number }
  | { kind: 'error'; message: string; ts: number };

interface Channel {
  buffer: CreationProgressEvent[];
  emitter: EventEmitter;
  /** Set once a terminal `done`/`error` has been published. */
  finished: boolean;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

/** Cap the per-channel buffer — a creation flow emits a few dozen events at most. */
const MAX_BUFFER = 200;
/** Keep a finished channel around briefly so a late reconnect still resolves. */
const CLEANUP_TTL_MS = 60_000;

declare global {
  var __quilltapCreationProgress: Map<string, Channel> | undefined;
}

function channels(): Map<string, Channel> {
  if (!global.__quilltapCreationProgress) {
    global.__quilltapCreationProgress = new Map();
  }
  return global.__quilltapCreationProgress;
}

function getOrCreateChannel(id: string): Channel {
  const map = channels();
  let ch = map.get(id);
  if (!ch) {
    const emitter = new EventEmitter();
    // The dialog is the usual single subscriber, but a reconnect can briefly
    // overlap — lift the cap so Node doesn't warn.
    emitter.setMaxListeners(50);
    ch = { buffer: [], emitter, finished: false };
    map.set(id, ch);
  }
  return ch;
}

function scheduleCleanup(id: string): void {
  const ch = channels().get(id);
  if (!ch) return;
  if (ch.cleanupTimer) clearTimeout(ch.cleanupTimer);
  ch.cleanupTimer = setTimeout(() => {
    channels().delete(id);
  }, CLEANUP_TTL_MS);
  // Never keep the process alive just to clean up a channel.
  ch.cleanupTimer.unref?.();
}

/**
 * Append an event to a channel and fan it out to live subscribers. No-op after
 * the channel has finished (a terminal event was already published).
 */
export function publishCreationProgress(id: string, event: CreationProgressEvent): void {
  if (!id) return;
  const ch = getOrCreateChannel(id);
  if (ch.finished) return;
  ch.buffer.push(event);
  if (ch.buffer.length > MAX_BUFFER) {
    ch.buffer.splice(0, ch.buffer.length - MAX_BUFFER);
  }
  ch.emitter.emit('event', event);
}

/**
 * Subscribe to a channel. Returns the buffered backlog to replay immediately
 * (which may already include the terminal `done`/`error`) plus an unsubscribe.
 */
export function subscribeCreationProgress(
  id: string,
  listener: (event: CreationProgressEvent) => void,
): { replay: CreationProgressEvent[]; unsubscribe: () => void } {
  const ch = getOrCreateChannel(id);
  // A fresh subscriber to a still-running channel cancels any pending self-heal
  // cleanup (see unsubscribe) — the flow is clearly still being watched.
  if (!ch.finished && ch.cleanupTimer) {
    clearTimeout(ch.cleanupTimer);
    ch.cleanupTimer = undefined;
  }
  const replay = [...ch.buffer];
  ch.emitter.on('event', listener);
  return {
    replay,
    unsubscribe: () => {
      ch.emitter.off('event', listener);
      // Self-heal: if the channel never reached a terminal event (validation
      // error before any publish, server threw, client bailed) and nobody is
      // listening anymore, schedule cleanup so it doesn't linger forever. An
      // in-flight POST that publishes again just recreates the channel.
      if (!ch.finished && ch.emitter.listenerCount('event') === 0) {
        scheduleCleanup(id);
      }
    },
  };
}

/** Publish the terminal `done` event and schedule the channel for cleanup. */
export function finishCreationProgress(id: string): void {
  if (!id) return;
  const ch = getOrCreateChannel(id);
  if (ch.finished) return;
  const event: CreationProgressEvent = { kind: 'done', ts: Date.now() };
  ch.finished = true;
  ch.buffer.push(event);
  ch.emitter.emit('event', event);
  scheduleCleanup(id);
}

/** Publish the terminal `error` event and schedule the channel for cleanup. */
export function failCreationProgress(id: string, message: string): void {
  if (!id) return;
  const ch = getOrCreateChannel(id);
  if (ch.finished) return;
  const event: CreationProgressEvent = { kind: 'error', message, ts: Date.now() };
  ch.finished = true;
  ch.buffer.push(event);
  ch.emitter.emit('event', event);
  scheduleCleanup(id);
}

/**
 * A per-id emitter handed to the creation flow. When `id` is null/undefined it
 * is entirely inert, so callers never have to branch on whether progress is
 * being tracked.
 */
export interface CreationProgressEmitter {
  status(message: string): void;
  log(message: string, level?: 'info' | 'warn' | 'error'): void;
  wardrobeStart(characterId: string, characterName: string): void;
  wardrobeResult(characterId: string, characterName: string, slots: OutfitPreviewSlots): void;
  finish(): void;
  fail(message: string): void;
}

const NOOP_EMITTER: CreationProgressEmitter = {
  status: () => {},
  log: () => {},
  wardrobeStart: () => {},
  wardrobeResult: () => {},
  finish: () => {},
  fail: () => {},
};

export function createCreationProgressEmitter(
  id: string | undefined | null,
): CreationProgressEmitter {
  if (!id) return NOOP_EMITTER;
  return {
    status: (message) => publishCreationProgress(id, { kind: 'status', message, ts: Date.now() }),
    log: (message, level) =>
      publishCreationProgress(id, { kind: 'log', message, level, ts: Date.now() }),
    wardrobeStart: (characterId, characterName) =>
      publishCreationProgress(id, {
        kind: 'wardrobe-start',
        characterId,
        characterName,
        ts: Date.now(),
      }),
    wardrobeResult: (characterId, characterName, slots) =>
      publishCreationProgress(id, {
        kind: 'wardrobe-result',
        characterId,
        characterName,
        slots,
        ts: Date.now(),
      }),
    finish: () => finishCreationProgress(id),
    fail: (message) => failCreationProgress(id, message),
  };
}

/** Test-only: drop all channels and their pending cleanup timers. */
export function __resetCreationProgressForTests(): void {
  const map = global.__quilltapCreationProgress;
  if (map) {
    for (const ch of map.values()) {
      if (ch.cleanupTimer) clearTimeout(ch.cleanupTimer);
    }
    map.clear();
  }
}
