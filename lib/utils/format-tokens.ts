/**
 * Token formatting utilities
 *
 * Client-safe utilities for formatting token counts and costs.
 * These functions have no server dependencies and can be used in React components.
 */

/**
 * Format cost for display (e.g., "$0.0023" or "< $0.01")
 */
export function formatCostForDisplay(costUSD: number | null): string {
  if (costUSD === null) {
    return 'N/A';
  }

  if (costUSD === 0) {
    return 'Free';
  }

  if (costUSD < 0.01) {
    return `$${costUSD.toFixed(4)}`;
  }

  if (costUSD < 1) {
    return `$${costUSD.toFixed(3)}`;
  }

  return `$${costUSD.toFixed(2)}`;
}

/**
 * Format token count for display (e.g., "1.5K" or "2.3M")
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}
