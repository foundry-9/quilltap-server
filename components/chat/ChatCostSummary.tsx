'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { formatTokenCount, formatCostForDisplay } from '@/lib/utils/format-tokens'
import { Icon } from '@/components/ui/icon'

export interface ChatCostSummaryProps {
  chatId: string
  /** Whether to show the summary (from settings) */
  show?: boolean
  className?: string
  /** Variant for different display contexts */
  variant?: 'default' | 'compact'
}

interface CostData {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  /** Input tokens served from a provider's prompt cache */
  cacheReadTokens?: number
  /** Input tokens written into a provider's prompt cache */
  cacheWriteTokens?: number
  estimatedCostUSD: number | null
  priceSource: string
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
}: ChatCostSummaryProps) {
  // Refreshed by the `chats` realtime topic (lib/realtime/topic-map.ts): a
  // new message is what moves the totals.
  const { data: costData, isLoading: loading } = useQuery({
    queryKey: queryKeys.chats.cost(chatId),
    queryFn: async ({ signal }) => {
      try {
        return await apiFetch<CostData>(`/api/v1/chats/${chatId}?action=cost`, { signal })
      } catch (error) {
        // Warn rather than error: a missing cost breakdown is a UI
        // degradation, not a red console alarm. Aborts are expected.
        if (!signal.aborted) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`ChatCostSummary: ${message} (chatId=${chatId})`)
        }
        throw error
      }
    },
    enabled: show,
    retry: false,
  })

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
                <Icon name="info" className="w-3.5 h-3.5" />
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
        <span>{formatTokenCount(costData.completionTokens)} out</span>
        {(costData.cacheReadTokens ?? 0) > 0 && (
          <>
            <span>/</span>
            <span title="Input tokens served from the provider's prompt cache, priced at its cache rate">
              {formatTokenCount(costData.cacheReadTokens ?? 0)} cached
            </span>
          </>
        )}
        {(costData.cacheWriteTokens ?? 0) > 0 && (
          <>
            <span>/</span>
            <span title="Input tokens written into the provider's prompt cache, priced at its cache-write rate">
              {formatTokenCount(costData.cacheWriteTokens ?? 0)} cache-written
            </span>
          </>
        )}
        <span>)</span>
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
              <Icon name="info" className="w-3.5 h-3.5" />
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
