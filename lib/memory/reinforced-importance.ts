/**
 * Reinforced importance: the score protection and ranking read once a memory
 * has been observed more than once.
 *
 * Pure and dependency-free so the memories repository can compute it inside
 * its atomic reinforcement write without importing the gate, and so the
 * `recompute-reinforced-importance-v1` migration can share the one formula.
 */

/** Per-doubling bonus that reinforcement adds to a memory's base importance. */
export const REINFORCED_IMPORTANCE_STEP = 0.05

/**
 * Calculate reinforced importance: `min(1, importance + log2(count) × 0.05)`.
 *
 * Locked decision 6 of the memory system refactor (bug 216): a row observed
 * once (count 1) scores exactly its base importance, so a fresh row — stored
 * with `reinforcedImportance = importance` — already agrees with the formula,
 * and its first reinforcement is a step along the curve rather than a jump.
 * A count below 1 (legacy rows, defensive callers) is treated as 1.
 */
export function calculateReinforcedImportance(baseImportance: number, reinforcementCount: number): number {
  const count = Number.isFinite(reinforcementCount) ? Math.max(1, reinforcementCount) : 1
  return Math.min(1.0, baseImportance + Math.log2(count) * REINFORCED_IMPORTANCE_STEP)
}
