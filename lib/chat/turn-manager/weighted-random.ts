/**
 * Weighted random selection.
 *
 * Lives on its own so both consumers can reach it without importing each other:
 * `selection.ts` (the one-at-a-time pick and the opening-character pick at chat
 * creation) and `cycle-order.ts` (the whole-rotation draw).
 */

/**
 * Weighted-random pick: each item's chance is its weight over the total. When
 * the weights sum to nothing (every candidate at 0 talkativeness) every item is
 * equally likely instead, and `equalWeights` says so. `weights` is parallel to
 * `items` and `randomValue` is the draw, both for the caller's debug trail.
 */
export function pickWeightedRandom<T>(
  items: T[],
  weightOf: (item: T) => number,
): { item: T; weights: number[]; randomValue: number; equalWeights: boolean } {
  const weights = items.map(weightOf);
  let totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const equalWeights = totalWeight <= 0;
  if (equalWeights) {
    weights.fill(1);
    totalWeight = items.length;
  }
  const randomValue = Math.random() * totalWeight;
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += weights[i];
    if (randomValue < cumulative) {
      return { item: items[i], weights, randomValue, equalWeights };
    }
  }
  return { item: items[items.length - 1], weights, randomValue, equalWeights };
}
