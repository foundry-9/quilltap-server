'use client'

import { useEffect, useState } from 'react'
import { formatTokenCount, formatCostForDisplay } from '@/lib/utils/format-tokens'

export interface ChatCostSummaryProps {
  chatId: string
  /** Whether to show the summary (from settings) */
  show?: boolean
  className?: string
  /** Variant for different display contexts */
  variant?: 'default' | 'compact'
  /** Key to trigger refresh (e.g., message count) - when this changes, cost data is re-fetched */
  refreshKey?: number | string
}

interface CostData {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  estimatedCostUSD: number | null
  priceSource: string
}

/**
 * Warning icon (circle with exclamation) for estimated pricing
 */
function EstimateWarningIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`w-3.5 h-3.5 ${className}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

/**
 * ChatCostSummary Component
 * Displays aggregate token and cost information for a chat
 */
export function ChatCostSummary({
  chatId,
  show = true,
  className = '',
  variant = 'default',
  refreshKey,
}: ChatCostSummaryProps) {
  const [costData, setCostData] = useState<CostData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!show) {
      setLoading(false)
      return
    }

    async function fetchCostData() {
      try {
        const res = await fetch(`/api/v1/chats/${chatId}?action=cost`)
        if (!res.ok) {
          throw new Error('Failed to fetch cost data')
        }
        const data = await res.json()
        setCostData(data)
      } catch (error) {
        console.error('Failed to fetch chat cost summary', {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setLoading(false)
      }
    }

    fetchCostData()
  }, [chatId, show, refreshKey])

  if (!show) {
    return null
  }

  if (loading) {
    if (variant === 'compact') {
      return null // Don't show loading state in header
    }
    return (
      <div className={`text-xs text-muted-foreground animate-pulse ${className}`}>
        Loading cost data...
      </div>
    )
  }

  if (!costData || costData.totalTokens === 0) {
    return null
  }

  // Compact variant for header display
  if (variant === 'compact') {
    return (
      <div
        className={`
          flex items-center gap-2
          text-xs text-muted-foreground
          ${className}
        `}
      >
        <span className="hidden md:inline">{formatTokenCount(costData.totalTokens)} tokens</span>
        <span className="md:hidden">{formatTokenCount(costData.totalTokens)}</span>
        {costData.estimatedCostUSD !== null && (
          <>
            <span className="text-muted-foreground/50">•</span>
            <span>{formatCostForDisplay(costData.estimatedCostUSD)}</span>
            {costData.priceSource === 'openrouter-estimate' && (
              <span
                className="text-warning cursor-help"
                title="Cost estimated using OpenRouter pricing data. Actual cost may vary."
              >
                <EstimateWarningIcon />
              </span>
            )}
            {costData.priceSource === 'unavailable' && (
              <span className="text-muted-foreground/50" title="Pricing data unavailable">*</span>
            )}
          </>
        )}
      </div>
    )
  }

  // Default variant
  return (
    <div
      className={`
        flex items-center gap-3 px-3 py-2
        text-xs text-muted-foreground
        bg-muted/30 border border-border/50 rounded-lg
        ${className}
      `}
    >
      <div className="flex items-center gap-1">
        <span className="font-medium">Total:</span>
        <span>{formatTokenCount(costData.totalTokens)} tokens</span>
      </div>
      <div className="hidden sm:flex items-center gap-1 text-muted-foreground/70">
        <span>({formatTokenCount(costData.promptTokens)} in</span>
        <span>/</span>
        <span>{formatTokenCount(costData.completionTokens)} out)</span>
      </div>
      {costData.estimatedCostUSD !== null && (
        <div className="flex items-center gap-1 ml-auto">
          <span className="font-medium">Est. cost:</span>
          <span>{formatCostForDisplay(costData.estimatedCostUSD)}</span>
          {costData.priceSource === 'openrouter-estimate' && (
            <span
              className="text-warning cursor-help"
              title="Cost estimated using OpenRouter pricing data. Actual cost may vary."
            >
              <EstimateWarningIcon />
            </span>
          )}
          {costData.priceSource === 'unavailable' && (
            <span className="text-muted-foreground/50" title="Pricing data unavailable">*</span>
          )}
        </div>
      )}
    </div>
  )
}
