'use client'

import { useState } from 'react'
import { formatTokenCount, formatCostForDisplay } from '@/lib/utils/format-tokens'
import { formatMessageTime } from '@/lib/format-time'
import type { SystemEvent, SystemEventType } from '@/lib/schemas/types'

export interface SystemEventMessageProps {
  event: SystemEvent
  collapsed?: boolean
}

/**
 * Get display info for a system event type
 */
function getEventTypeInfo(type: SystemEventType): { icon: string; label: string; color: string } {
  switch (type) {
    case 'MEMORY_EXTRACTION':
      return { icon: 'brain', label: 'Memory Extraction', color: 'text-purple-500' }
    case 'SUMMARIZATION':
      return { icon: 'file-text', label: 'Summarization', color: 'text-blue-500' }
    case 'TITLE_GENERATION':
      return { icon: 'tag', label: 'Title Generation', color: 'text-green-500' }
    case 'CONTEXT_SUMMARY':
      return { icon: 'layers', label: 'Context Summary', color: 'text-orange-500' }
    case 'IMAGE_PROMPT_CRAFTING':
      return { icon: 'image', label: 'Image Prompt', color: 'text-pink-500' }
    default:
      return { icon: 'cog', label: 'System', color: 'text-gray-500' }
  }
}

/**
 * Simple icon component using Unicode symbols
 */
function EventIcon({ type, className }: { type: SystemEventType; className?: string }) {
  const symbols: Record<string, string> = {
    brain: '\uD83E\uDDE0', // brain emoji
    'file-text': '\uD83D\uDCC4', // page
    tag: '\uD83C\uDFF7\uFE0F', // label
    layers: '\uD83D\uDDC2\uFE0F', // file folder
    image: '\uD83D\uDDBC\uFE0F', // frame
    cog: '\u2699\uFE0F', // gear
  }
  const info = getEventTypeInfo(type)
  return <span className={className}>{symbols[info.icon] || symbols.cog}</span>
}

/**
 * SystemEventMessage Component
 * Displays a system event (cheap LLM operation) in the chat timeline
 */
export function SystemEventMessage({
  event,
  collapsed: initialCollapsed = true,
}: SystemEventMessageProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const typeInfo = getEventTypeInfo(event.systemEventType)
  const totalTokens = event.totalTokens ?? ((event.promptTokens ?? 0) + (event.completionTokens ?? 0))

  const timeAgo = event.createdAt
    ? formatMessageTime(event.createdAt)
    : null

  return (
    <div className="flex justify-center py-2">
      <div
        className={`
          max-w-md w-full px-4 py-2
          bg-muted/30 border border-border/50 rounded-lg
          text-xs transition-all cursor-pointer
          hover:bg-muted/50
        `}
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setCollapsed(!collapsed)}
      >
        {/* Header - always visible */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <EventIcon type={event.systemEventType} className="text-sm" />
            <span className={`font-medium ${typeInfo.color}`}>{typeInfo.label}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            {totalTokens > 0 && (
              <span>{formatTokenCount(totalTokens)} tokens</span>
            )}
            {event.estimatedCostUSD !== null && event.estimatedCostUSD !== undefined && (
              <span>{formatCostForDisplay(event.estimatedCostUSD)}</span>
            )}
            <span className="text-muted-foreground/60">{collapsed ? '\u25BC' : '\u25B2'}</span>
          </div>
        </div>

        {/* Expanded details */}
        {!collapsed && (
          <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
            <p className="text-muted-foreground">{event.description}</p>
            {(event.promptTokens !== null || event.completionTokens !== null) && (
              <div className="flex gap-3 text-muted-foreground/80">
                {event.promptTokens !== null && (
                  <span>Prompt: {formatTokenCount(event.promptTokens ?? 0)}</span>
                )}
                {event.completionTokens !== null && (
                  <span>Completion: {formatTokenCount(event.completionTokens ?? 0)}</span>
                )}
              </div>
            )}
            {(event.provider || event.modelName) && (
              <div className="text-muted-foreground/60">
                {event.provider && <span>{event.provider}</span>}
                {event.provider && event.modelName && <span> / </span>}
                {event.modelName && <span>{event.modelName}</span>}
              </div>
            )}
            {timeAgo && (
              <div className="text-muted-foreground/40">{timeAgo}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
