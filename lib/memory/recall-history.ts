/**
 * Commonplace Book recall anti-repetition ring buffer.
 *
 * Persisted per-chat in `chats.commonplaceRecallHistory` as a JSON object
 * `{ turns: string[][] }` — one inner array of whispered memory IDs per recent
 * turn, most recent last, capped to {@link RECALL_HISTORY_TURNS}. (Wrapped in an
 * object rather than a bare array so it stays a plain JSON record column like
 * `commonplaceSceneCache`, not an auto-detected SQLite "array column".)
 *
 * The recall path unions these IDs into a "recently whispered" set and applies a
 * bounded penalty (see lib/memory/recall-tags.ts `recentlyWhispered`) so the same
 * memory doesn't get whispered turn after turn and read as a stuck record.
 *
 * Ephemeral UX state — NOT part of .qtap export.
 */

/** How many recent whisper-turns to remember for anti-repetition. */
export const RECALL_HISTORY_TURNS = 3

/** Persisted shape of the recall-history column. */
export interface RecallHistory {
  /** One inner array of whispered memory IDs per recent turn, most recent last. */
  turns: string[][]
}

/** Coerce the raw JSON column into a clean `string[][]`, dropping anything malformed. */
export function parseRecallHistory(raw: unknown): string[][] {
  const turns =
    raw && typeof raw === 'object' && 'turns' in raw
      ? (raw as { turns: unknown }).turns
      : undefined
  if (!Array.isArray(turns)) return []
  return (turns as unknown[])
    .filter((turn): turn is unknown[] => Array.isArray(turn))
    .map(turn => turn.filter((id): id is string => typeof id === 'string' && id.length > 0))
}

/** Union of all memory IDs across the retained recent turns. */
export function recentlyWhisperedIdSet(raw: unknown): ReadonlySet<string> {
  const set = new Set<string>()
  for (const turn of parseRecallHistory(raw)) {
    for (const id of turn) set.add(id)
  }
  return set
}

/**
 * Append this turn's whispered IDs and trim to the last {@link RECALL_HISTORY_TURNS}.
 * Empty turns are not recorded — the buffer tracks recent *whispers*, not silence,
 * so a gap turn doesn't prematurely age a still-recent memory out of the penalty.
 */
export function appendRecallTurn(raw: unknown, newIds: readonly string[]): RecallHistory {
  const turns = parseRecallHistory(raw)
  if (newIds.length === 0) return { turns }
  turns.push([...new Set(newIds)])
  return { turns: turns.slice(-RECALL_HISTORY_TURNS) }
}
