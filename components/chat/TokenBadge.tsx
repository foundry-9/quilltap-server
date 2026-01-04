'use client'

import { formatTokenCount, formatCostForDisplay } from '@/lib/utils/format-tokens'

export interface TokenBadgeProps {
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
  estimatedCostUSD?: number | null
  showTokens?: boolean
  showCost?: boolean
  className?: string
}

/**
 * TokenBadge Component
 * Displays token count and/or cost estimate for a message
 */
export function TokenBadge({
  promptTokens,
  completionTokens,
  totalTokens,
  estimatedCostUSD,
  showTokens = true,
  showCost = false,
  className = '',
}: TokenBadgeProps) {
  const prompt = promptTokens ?? 0
  const completion = completionTokens ?? 0
  const total = totalTokens ?? (prompt + completion)

  // Don't show if no tokens or both displays are off
  if (total === 0 || (!showTokens && !showCost)) {
    return null
  }

  return (
    <div
      className={`inline-flex items-center gap-2 text-xs text-muted-foreground ${className}`}
    >
      {showTokens && (
        <span className="inline-flex items-center gap-1">
          <span title="Prompt tokens">{formatTokenCount(prompt)}</span>
          <span>/</span>
          <span title="Completion tokens">{formatTokenCount(completion)}</span>
          <span className="text-muted-foreground/60">tokens</span>
        </span>
      )}
      {showCost && estimatedCostUSD !== null && estimatedCostUSD !== undefined && (
        <span
          className="text-muted-foreground/80"
          title="Estimated cost"
        >
          {formatCostForDisplay(estimatedCostUSD)}
        </span>
      )}
    </div>
  )
}
