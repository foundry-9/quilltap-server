'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { ToolResultFrame, ToolsDetectedFrame } from '@/lib/chat/stream-frames'
import type { ToolExecutionStatus } from './useToolExecutionStatus'
import { resolveToolResultErrorText, type PendingToolCall, type StreamingToolBatch } from './stream-helpers'

/**
 * In-progress tool calls for the turn being streamed, grouped into batches by
 * the point in the prose where each fired (`StreamingToolBatch`), so the
 * streaming bubble can interleave them with the text. Shared by every turn
 * stream the Salon opens.
 */
export function useStreamingToolBatches({
  publishToolExecutionStatus,
  onToolResult,
}: {
  publishToolExecutionStatus: (status: ToolExecutionStatus) => void
  /** Called when a tool result arrives, allowing the page to react to specific tools */
  onToolResult?: (name: string, success: boolean, result: unknown) => void
}) {
  const [streamingToolBatches, setStreamingToolBatches] = useState<StreamingToolBatch[]>([])
  // Monotonic batch counter so tool-call React keys stay unique across batches.
  const toolBatchSeqRef = useRef(0)
  // The page's callback, read through a ref so the trackers stay stable.
  const onToolResultRef = useRef(onToolResult)
  useEffect(() => {
    onToolResultRef.current = onToolResult
  }, [onToolResult])

  // Push a freshly-detected tool batch, tagged with the prose offset where it
  // fired, and surface image-generation status.
  const trackToolsDetected = useCallback((frame: ToolsDetectedFrame, offset: number) => {
    const toolNames = frame.names
    const toolArgs = frame.arguments
    const seq = toolBatchSeqRef.current++
    const calls: PendingToolCall[] = toolNames.map((name, idx) => ({
      id: `tool-${seq}-${idx}`,
      name,
      status: 'pending' as const,
      arguments: toolArgs[idx],
    }))
    setStreamingToolBatches(prev => [...prev, { offset, calls }])
    if (toolNames.includes('generate_image')) {
      publishToolExecutionStatus({
        tool: 'generate_image',
        status: 'pending',
        message: `Generating image...`,
      })
    }
  }, [publishToolExecutionStatus])

  // Mark a tool result on the most recent batch (results stream immediately
  // after their detection) and run per-tool side effects (navigation, image
  // toasts, page callback).
  const trackToolResult = useCallback((frame: ToolResultFrame) => {
    const { index, name, success, error } = frame
    // Tool results are free-form; the per-tool reads below know their shapes.
    const result = frame.result as any

    setStreamingToolBatches(prev => {
      if (prev.length === 0) return prev
      const lastIdx = prev.length - 1
      const last = prev[lastIdx]
      const calls = last.calls.map((tc, idx) =>
        (index !== undefined && idx === index) || (index === undefined && tc.name === name)
          ? { ...tc, status: success ? ('success' as const) : ('error' as const), result }
          : tc
      )
      const next = prev.slice()
      next[lastIdx] = { ...last, calls }
      return next
    })

    // Handle help_navigate: navigate the current window to the target URL
    if (name === 'help_navigate' && success && result?.navigationUrl) {
      window.location.href = result.navigationUrl
    }

    if (name === 'generate_image') {
      if (success) {
        const imageCount = result?.images?.length || 1
        publishToolExecutionStatus({
          tool: name,
          status: 'success',
          message: `Successfully generated ${imageCount} image${imageCount > 1 ? 's' : ''}!`,
        })
        showSuccessToast(`Image generation complete! ${imageCount} image${imageCount > 1 ? 's' : ''} generated.`)
      } else {
        const detail = resolveToolResultErrorText({ result, error })
        publishToolExecutionStatus({
          tool: name,
          status: 'error',
          message: detail || 'Failed to generate image',
        })
        showErrorToast(`Image generation failed: ${detail || 'Unknown error'}`)
      }
    }

    // Notify the page about tool results (for Document Mode, etc.)
    onToolResultRef.current?.(name, success, result)
  }, [publishToolExecutionStatus])

  /** Live batches are spent at a turn boundary. */
  const clearStreamingToolBatches = useCallback(() => setStreamingToolBatches([]), [])

  return { streamingToolBatches, trackToolsDetected, trackToolResult, clearStreamingToolBatches }
}
