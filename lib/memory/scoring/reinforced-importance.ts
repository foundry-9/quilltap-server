/**
 * Reinforced importance — the stored column every importance filter compares.
 *
 * Pure and dependency-free, so the memories repository can compute it inside
 * its atomic reinforcement write, the job child's overlay can mirror it, and
 * the `recompute-reinforced-importance-v1` migration shares the one formula.
 *
 * @module memory/scoring/reinforced-importance
 */

/** Per-doubling bonus that reinforcement adds to a memory's base importance. */
export const REINFORCED_IMPORTANCE_STEP = 0.05

/**
 * `min(1, importance + log2(count) × 0.05)`.
 *
 * Locked decision 6 of the memory system refactor (bug 216): a row observed
 * once (count 1) scores exactly its base importance, so a fresh row — stored
 * with `reinforcedImportance = importance` — already agrees with the formula,
 * and its first reinforcement is a step along the curve rather than a jump.
 * A count below 1 (legacy rows, defensive callers) is treated as 1.
 */
export function reinforcedImportance(importance: number, count: number): number {
  const n = Number.isFinite(count) ? Math.max(1, count) : 1
  return Math.min(1.0, importance + Math.log2(n) * REINFORCED_IMPORTANCE_STEP)
}

/** The same function under its historical name. */
export const calculateReinforcedImportance = reinforcedImportance
