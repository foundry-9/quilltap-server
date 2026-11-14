'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * The live prose and reasoning of the turn being streamed, rAF-buffered.
 *
 * SSE chunks can arrive faster than React can render them — in long
 * multi-character chains that burst of per-chunk state updates has tripped
 * React's update-depth limit. The latest accumulated text is buffered in a ref
 * and flushed at most once per animation frame, capping the render rate at the
 * display refresh rate regardless of chunk cadence. Reasoning ("thinking") is
 * DISPLAY ONLY and gets the same treatment.
 */
export function useStreamingBuffers() {
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingReasoning, setStreamingReasoning] = useState('')

  const streamingContentBufferRef = useRef<string>('')
  const streamingContentRafRef = useRef<number | null>(null)
  const streamingReasoningBufferRef = useRef<string>('')
  const streamingReasoningRafRef = useRef<number | null>(null)

  const flushStreamingContent = useCallback(() => {
    streamingContentRafRef.current = null
    setStreamingContent(streamingContentBufferRef.current)
  }, [])

  const scheduleStreamingContent = useCallback((content: string) => {
    streamingContentBufferRef.current = content
    if (streamingContentRafRef.current === null) {
      streamingContentRafRef.current = requestAnimationFrame(flushStreamingContent)
    }
  }, [flushStreamingContent])

  const flushStreamingReasoning = useCallback(() => {
    streamingReasoningRafRef.current = null
    setStreamingReasoning(streamingReasoningBufferRef.current)
  }, [])

  // Reasoning arrives cumulatively, so we replace (not append) the buffer.
  const scheduleStreamingReasoning = useCallback((reasoning: string) => {
    streamingReasoningBufferRef.current = reasoning
    if (streamingReasoningRafRef.current === null) {
      streamingReasoningRafRef.current = requestAnimationFrame(flushStreamingReasoning)
    }
  }, [flushStreamingReasoning])

  const resetStreamingContent = useCallback(() => {
    if (streamingContentRafRef.current !== null) {
      cancelAnimationFrame(streamingContentRafRef.current)
      streamingContentRafRef.current = null
    }
    streamingContentBufferRef.current = ''
    setStreamingContent('')
    // Reasoning resets in lockstep with content so every turn-boundary cleanup
    // (turnStart, done, errors, stop) clears the live thinking block too.
    if (streamingReasoningRafRef.current !== null) {
      cancelAnimationFrame(streamingReasoningRafRef.current)
      streamingReasoningRafRef.current = null
    }
    streamingReasoningBufferRef.current = ''
    setStreamingReasoning('')
  }, [])

  // Cancel any pending rAF on unmount to avoid setting state after teardown.
  useEffect(() => {
    return () => {
      if (streamingContentRafRef.current !== null) {
        cancelAnimationFrame(streamingContentRafRef.current)
      }
      if (streamingReasoningRafRef.current !== null) {
        cancelAnimationFrame(streamingReasoningRafRef.current)
      }
    }
  }, [])

  return {
    streamingContent,
    streamingReasoning,
    scheduleStreamingContent,
    scheduleStreamingReasoning,
    resetStreamingContent,
  }
}
