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

  // Fetch cost data when dependencies change
  useEffect(() => {
    if (!show) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch effect; setLoading is managed by loading lifecycle
      setLoading(false)
      return
    }

    // AbortController lets us cancel the in-flight fetch cleanly when the
    // effect re-runs (StrictMode double-invoke in dev) or the component
    // unmounts. Without this, the aborted fetch would surface as a generic
    // "Failed to fetch chat cost summary" error on every render.
    const controller = new AbortController()
    let cancelled = false

    async function fetchCostData() {
      try {
        const res = await fetch(`/api/v1/chats/${chatId}?action=cost`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`Cost endpoint returned HTTP ${res.status}`)
        }
        const data = await res.json()
        if (!cancelled) setCostData(data)
      } catch (error) {
        // Swallow aborts — they're the expected outcome of effect cleanup.
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        // Use warn rather than error; a missing cost breakdown is a UI degradation,
        // not something the user needs to see as a red console alarm every render.
        console.warn(`ChatCostSummary: ${message} (chatId=${chatId})`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchCostData()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [chatId, show, refreshKey])

  if (!show) {
    return null
  }

  if (loading) {
    if (variant === 'compact') {
      return null // Don't show loading state in header
    }
    return (
      <div className={`text-xs qt-text-secondary animate-pulse ${className}`}>
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
          text-xs qt-text-secondary
          ${className}
        `}
      >
        <span className="hidden md:inline">{formatTokenCount(costData.totalTokens)} tokens</span>
        <span className="md:hidden">{formatTokenCount(costData.totalTokens)}</span>
        {costData.estimatedCostUSD !== null && (
          <>
            <span className="qt-text-secondary/50">•</span>
            <span>{formatCostForDisplay(costData.estimatedCostUSD)}</span>
            {costData.priceSource === 'openrouter-estimate' && (
              <span
                className="qt-text-warning cursor-help"
                title="Cost estimated using OpenRouter pricing data. Actual cost may vary."
              >
                <EstimateWarningIcon />
              </span>
            )}
            {costData.priceSource === 'unavailable' && (
              <span className="qt-text-secondary/50" title="Pricing data unavailable">*</span>
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
        text-xs qt-text-secondary
        qt-bg-muted/30 border qt-border-default/50 rounded-lg
        ${className}
      `}
    >
      <div className="flex items-center gap-1">
        <span className="font-medium">Total:</span>
        <span>{formatTokenCount(costData.totalTokens)} tokens</span>
      </div>
      <div className="hidden sm:flex items-center gap-1 qt-text-secondary/70">
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
              className="qt-text-warning cursor-help"
              title="Cost estimated using OpenRouter pricing data. Actual cost may vary."
            >
              <EstimateWarningIcon />
            </span>
          )}
          {costData.priceSource === 'unavailable' && (
            <span className="qt-text-secondary/50" title="Pricing data unavailable">*</span>
          )}
        </div>
      )}
    </div>
  )
}
