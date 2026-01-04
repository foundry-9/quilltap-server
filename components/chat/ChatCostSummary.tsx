'use client'

import { useEffect, useState } from 'react'
import { formatTokenCount, formatCostForDisplay } from '@/lib/utils/format-tokens'
import { clientLogger } from '@/lib/client-logger'

export interface ChatCostSummaryProps {
  chatId: string
  /** Whether to show the summary (from settings) */
  show?: boolean
  className?: string
}

interface CostData {
  totalTokens: number
  promptTokens: number
  completionTokens: number
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
        clientLogger.debug('Fetching chat cost summary', { chatId })
        const res = await fetch(`/api/chats/${chatId}/cost`)
        if (!res.ok) {
          throw new Error('Failed to fetch cost data')
        }
        const data = await res.json()
        setCostData(data)
      } catch (error) {
        clientLogger.error('Failed to fetch chat cost summary', {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setLoading(false)
      }
    }

    fetchCostData()
  }, [chatId, show])

  if (!show) {
    return null
  }

  if (loading) {
    return (
      <div className={`text-xs text-muted-foreground animate-pulse ${className}`}>
        Loading cost data...
      </div>
    )
  }

  if (!costData || costData.totalTokens === 0) {
    return null
  }

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
          {costData.priceSource === 'unavailable' && (
            <span className="text-muted-foreground/50" title="Pricing data unavailable">*</span>
          )}
        </div>
      )}
    </div>
  )
}
