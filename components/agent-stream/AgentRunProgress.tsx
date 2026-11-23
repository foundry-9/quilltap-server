'use client'

/**
 * What an agent run shows while it is under way: who is at work, one line per
 * tool call (pending, failed or done) and the reasoning as it streams. Each
 * surface supplies its own wording — the label, the list's name and the line
 * for a call are in the persona's voice.
 *
 * @module components/agent-stream/AgentRunProgress
 */

import { Icon } from '@/components/ui/icon'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import { ThinkingBlock } from '@/components/chat/ThinkingBlock'
import type { AgentStreamToolCall } from './parse-agent-stream'

export interface AgentRunProgressProps {
  /** Who is at work, e.g. "Aurora is designing…". */
  label: string
  /** The accessible name of the list of tool calls. */
  listLabel: string
  toolCalls: AgentStreamToolCall[]
  reasoning: string
  /** One line for a tool call, in the surface's voice. */
  describe: (call: AgentStreamToolCall) => string
}

export function AgentRunProgress({ label, listLabel, toolCalls, reasoning, describe }: AgentRunProgressProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <QuillAnimation size="lg" label={label} />
        <span className="text-sm qt-text-secondary">{label}</span>
      </div>
      {toolCalls.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label={listLabel}>
          {toolCalls.map((call, i) => (
            <li key={i} className="flex items-start gap-2">
              {call.pending ? (
                <QuillAnimation size="sm" label={null} className="mt-0.5" />
              ) : call.success === false ? (
                <Icon name="close" className="w-4 h-4 mt-0.5 qt-text-danger" title="Came to nothing" />
              ) : (
                <Icon name="check" className="w-4 h-4 mt-0.5 qt-text-success" title="Done" />
              )}
              <span className="qt-text-secondary break-words">{describe(call)}</span>
            </li>
          ))}
        </ul>
      )}
      <ThinkingBlock content={reasoning} streaming />
    </div>
  )
}
