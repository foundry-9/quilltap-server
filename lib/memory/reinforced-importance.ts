/**
 * Reinforced importance: the score protection and ranking read once a memory
 * has been observed more than once.
 *
 * Pure and dependency-free so the memories repository can compute it inside
 * its atomic reinforcement write without importing the gate.
 */

/**
 * Calculate reinforced importance: importance + log2(count + 1) * 0.05, capped at 1.0
 */
export function calculateReinforcedImportance(baseImportance: number, reinforcementCount: number): number {
  return Math.min(1.0, baseImportance + Math.log2(reinforcementCount + 1) * 0.05)
}
