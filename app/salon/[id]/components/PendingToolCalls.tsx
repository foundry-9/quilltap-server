'use client'

import { QuillAnimation } from '@/components/chat/QuillAnimation'

interface PendingToolCall {
  id: string
  name: string
  status: 'pending' | 'success' | 'error'
  result?: unknown
  arguments?: Record<string, unknown>
}

interface PendingToolCallsProps {
  pendingToolCalls: PendingToolCall[]
}

const DISPLAY_NAMES: Record<string, string> = {
  'generate_image': 'Image Generation',
  'search': 'Search',
  'search_web': 'Web Search',
}

export function PendingToolCalls({ pendingToolCalls }: PendingToolCallsProps) {
  if (pendingToolCalls.length === 0) {
    return null
  }

  const getEmojiForTools = () => {
    if (pendingToolCalls.some(tc => tc.name === 'generate_image')) return '🎨'
    if (pendingToolCalls.some(tc => tc.name === 'search')) return '🧠'
    if (pendingToolCalls.some(tc => tc.name === 'search_web')) return '🔍'
    return '⚙️'
  }

  return (
    <div className="qt-chat-message-row qt-chat-message-row-assistant">
      <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full qt-bg-muted text-lg">
        {getEmojiForTools()}
      </div>
      <div className="flex-1 min-w-0">
        <details className="group" open={pendingToolCalls.some(tc => tc.status === 'pending')}>
          <summary className="px-4 py-2 rounded-lg qt-bg-muted border qt-border-default cursor-pointer list-none flex items-center gap-2">
            <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm qt-text-primary">
              {pendingToolCalls.map(tc => DISPLAY_NAMES[tc.name] || tc.name).join(', ')}
            </span>
            {pendingToolCalls.some(tc => tc.status === 'pending') && (
              <QuillAnimation size="sm" className="ml-auto qt-text-secondary" />
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
    </div>
  )
}
