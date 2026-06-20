/**
 * Retention windows for the daily maintenance sweep.
 *
 * These are deliberately hardcoded constants — there is no settings row, no
 * `instance_settings` knob, no UI, and no migration for them in v1. The whole
 * point of the maintenance tick is to reap data that has no bearing on
 * characters, stories, or memories; the windows below are conservative enough
 * that exposing them as tunables would be more rope than value. If they ever
 * become user-configurable, that change needs a migration *and* a
 * `PRETTY_LABELS` entry (see CLAUDE.md "Writing migrations").
 *
 * All windows are expressed in days and converted to a cutoff `Date` at the
 * call site (`Date.now() - days * DAY_MS`).
 */

/** Completed background jobs are reaped this many days after `completedAt`. */
export const COMPLETED_JOB_RETENTION_DAYS = 7;

/**
 * Dead (retry-exhausted) background jobs are reaped this many days after
 * `completedAt`. Longer than completed jobs because a DEAD row is the only
 * forensic trail for a job that gave up. `FAILED` is the transient
 * between-retries state and is NEVER reaped on a timer.
 */
export const DEAD_JOB_RETENTION_DAYS = 30;

/**
 * A chat is "stale" once it has had no activity for this many days
 * (`lastMessageAt`, fallback `updatedAt`). Only then do we collapse its
 * superseded generated story-backgrounds and chat-scoped avatars down to the
 * currently-referenced ones. Active chats are never touched.
 */
export const STALE_CHAT_RETENTION_DAYS = 30;

/**
 * Closed terminal (Ariel) PTY sessions are reaped this many days after
 * `exitedAt`, along with their transcript files. Sessions still running
 * (`exitedAt IS NULL`) are never touched.
 */
export const CLOSED_TERMINAL_RETENTION_DAYS = 30;

/** Milliseconds in a day — shared cutoff helper denominator. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Convert a retention window in days to an absolute cutoff `Date`. */
export function retentionCutoff(days: number, now: number = Date.now()): Date {
  return new Date(now - days * DAY_MS);
}
