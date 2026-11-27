'use client'

import { QuillAnimation } from '@/components/chat/QuillAnimation'
import { Icon } from '@/components/ui/icon'

interface PendingToolCall {
  id: string
  name: string
  status: 'pending' | 'success' | 'error'
  result?: unknown
  arguments?: Record<string, unknown>
}

interface PendingToolCallsProps {
  pendingToolCalls: PendingToolCall[]
  /** Add a paragraph break beneath the block because the live prose resumes
   *  under it. Omitted when the turn ends on the tool call. */
  beforeProse?: boolean
}

const DISPLAY_NAMES: Record<string, string> = {
  'generate_image': 'Image Generation',
  'search': 'Search',
  'search_web': 'Web Search',
}

/**
 * A turn's in-progress tool calls as a collapsible block, nested as its own
 * paragraph inside the streaming bubble (the character's avatar already heads
 * that row).
 */
export function PendingToolCalls({ pendingToolCalls, beforeProse = false }: PendingToolCallsProps) {
  if (pendingToolCalls.length === 0) {
    return null
  }

  return (
    <div className={`qt-chat-message-tools${beforeProse ? ' qt-chat-message-tools-before-prose' : ''}`}>
      <details className="qt-chat-pending-tools group" open={pendingToolCalls.some(tc => tc.status === 'pending')}>
        <summary className="px-4 py-2 rounded-lg qt-bg-muted border qt-border-default cursor-pointer list-none flex items-center gap-2">
          <Icon name="chevron-right" className="w-4 h-4 transition-transform group-open:rotate-90" />
          <span className="text-sm qt-text-primary">
            {pendingToolCalls.map(tc => DISPLAY_NAMES[tc.name] || tc.name).join(', ')}
          </span>
          {pendingToolCalls.some(tc => tc.status === 'pending') && (
            <QuillAnimation size="sm" label={null} className="ml-auto qt-text-secondary" />
          )}
          {pendingToolCalls.every(tc => tc.status === 'success') && (
            <span className="ml-auto text-xs px-2 py-0.5 qt-bg-success/20 qt-text-success rounded">
              Complete
            </span>
          )}
          {pendingToolCalls.some(tc => tc.status === 'error') && (
            <span className="ml-auto text-xs px-2 py-0.5 qt-bg-destructive/20 qt-text-destructive rounded">
              Error
            </span>
          )}
        </summary>
        <div className="mt-2 px-4 py-2 rounded-lg qt-bg-muted border qt-border-default">
          {pendingToolCalls.map((tc) => (
            <div key={tc.id} className="qt-text-xs">
              <span className="font-medium">{tc.name}</span>
              {tc.arguments && Object.keys(tc.arguments).length > 0 && (
                <span className="ml-2 qt-text-secondary/70">
                  ({Object.entries(tc.arguments).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 50) : JSON.stringify(v)}`).join(', ')})
                </span>
              )}
              {tc.status === 'success' && <span className="ml-2 qt-text-success">✓</span>}
              {tc.status === 'error' && <span className="ml-2 qt-text-destructive">✗</span>}
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
