'use client'

import { useCallback, useRef, useEffect, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import type { Virtualizer } from '@tanstack/react-virtual'

interface UseAutoScrollOptions {
  /** Reference to the scroll container element */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Reference to the element at the end of messages */
  endRef: React.RefObject<HTMLDivElement | null>
  /** TanStack virtualizer instance */
  virtualizer: Virtualizer<HTMLDivElement, Element>
  /** Current message count */
  messageCount: number
  /** Whether a message is currently streaming */
  isStreaming: boolean
  /** Whether we're waiting for the first response chunk */
  isWaitingForResponse: boolean
  /** Current streaming content (used to detect streaming updates) */
  streamingContent: string
  /** Whether messages are still loading from API */
  isLoading: boolean
}

interface UseAutoScrollReturn {
  /** Call this when user sends a message - forces scroll to bottom */
  scrollOnUserMessage: () => void
  /** Call this when streaming completes - scrolls to final position */
  scrollOnStreamComplete: () => void
  /** Whether auto-scroll is currently enabled (user hasn't scrolled up) */
  isAutoScrollEnabled: boolean
  /** Whether the page has settled after initial load */
  isSettled: boolean
}

/** Threshold in pixels from bottom to consider "at bottom" */
const SCROLL_THRESHOLD = 100

/** Time to wait after messages load before considering page settled */
const SETTLE_DELAY_MS = 400

/** Debounce time for scroll position checks */
const SCROLL_CHECK_DEBOUNCE_MS = 100

/**
 * Intelligent auto-scroll hook that handles:
 * 1. Initial page load - waits for content to settle before scrolling
 * 2. Streaming - only scrolls on completion, not every chunk
 * 3. User intent - respects when user scrolls up to read history
 */
export function useAutoScroll({
  containerRef,
  endRef,
  virtualizer,
  messageCount,
  isStreaming,
  isWaitingForResponse,
  streamingContent,
  isLoading,
}: UseAutoScrollOptions): UseAutoScrollReturn {
  // Track whether auto-scroll is enabled (user hasn't scrolled away)
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true)

  // Track whether page has settled after initial load
  const [isSettled, setIsSettled] = useState(false)

  // Track previous message count to detect new messages
  const prevMessageCountRef = useRef(messageCount)

  // Track whether we've done the initial scroll
  const hasInitialScrolledRef = useRef(false)

  // Track streaming state to detect completion
  const wasStreamingRef = useRef(false)

  // Track loading state to detect when loading starts (for resetting settled state)
  const wasLoadingRef = useRef(isLoading)

  // Debounce timer for scroll position checking
  const scrollCheckTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Settle timer
  const settleTimerRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * Check if scroll position is near the bottom
   */
  const isNearBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return true

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    return distanceFromBottom <= SCROLL_THRESHOLD
  }, [containerRef])

  /**
   * Perform the actual scroll to bottom
   * Uses multiple strategies to ensure we reach the true bottom:
   * 1. Scroll virtualizer to last message
   * 2. Scroll container to max scrollTop
   * 3. Scroll endRef into view
   */
  const performScrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    const container = containerRef.current

    // Strategy 1: Tell virtualizer to scroll to last message
    if (messageCount > 0) {
      virtualizer.scrollToIndex(messageCount - 1, { align: 'end', behavior })
    }

    // Strategy 2: Direct container scroll to max position (after brief delay for virtualizer)
    setTimeout(() => {
      if (container) {
        const maxScrollTop = container.scrollHeight - container.clientHeight
        container.scrollTo({
          top: maxScrollTop,
          behavior,
        })
      }
    }, 50)

    // Strategy 3: Scroll endRef into view (after content has rendered)
    setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior })
    }, 150)

    // Strategy 4: Final safety scroll after content likely rendered
    setTimeout(() => {
      if (container) {
        const maxScrollTop = container.scrollHeight - container.clientHeight
        if (container.scrollTop < maxScrollTop - 10) {
          container.scrollTo({
            top: maxScrollTop,
            behavior: 'auto', // Use instant for final adjustment
          })
        }
      }
    }, 300)
  }, [messageCount, virtualizer, endRef, containerRef])

  /**
   * Handle scroll events to track user intent
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      // Debounce the scroll check
      if (scrollCheckTimerRef.current) {
        clearTimeout(scrollCheckTimerRef.current)
      }

      scrollCheckTimerRef.current = setTimeout(() => {
        const nearBottom = isNearBottom()

        // Only update if state actually changed
        setIsAutoScrollEnabled(prev => {
          if (prev !== nearBottom) {
            clientLogger.debug('[useAutoScroll] Auto-scroll state changed', {
              enabled: nearBottom,
              reason: nearBottom ? 'user scrolled to bottom' : 'user scrolled up'
            })
          }
          return nearBottom
        })
      }, SCROLL_CHECK_DEBOUNCE_MS)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollCheckTimerRef.current) {
        clearTimeout(scrollCheckTimerRef.current)
      }
    }
  }, [containerRef, isNearBottom])

  /**
   * Handle initial load settling
   * Wait for loading to complete, then wait a bit more for renders to settle
   */
  useEffect(() => {
    // Detect loading state transitions
    const wasLoading = wasLoadingRef.current
    wasLoadingRef.current = isLoading

    // Clear any existing settle timer
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }

    // If loading just started, reset settled state via functional update
    if (isLoading && !wasLoading) {
      setIsSettled(() => {
        hasInitialScrolledRef.current = false
        return false
      })
      return
    }

    // If still loading, wait
    if (isLoading) {
      return
    }

    // Loading complete - start settle timer
    if (!isSettled && messageCount > 0) {
      clientLogger.debug('[useAutoScroll] Messages loaded, starting settle timer', { messageCount })

      settleTimerRef.current = setTimeout(() => {
        clientLogger.debug('[useAutoScroll] Page settled, performing initial scroll')
        setIsSettled(true)

        // Perform initial scroll after settling
        if (!hasInitialScrolledRef.current) {
          hasInitialScrolledRef.current = true
          // Use 'auto' (instant) scroll on initial load to avoid visual jank
          performScrollToBottom('auto')
        }
      }, SETTLE_DELAY_MS)
    } else if (messageCount === 0) {
      // No messages - immediately settled
      setIsSettled(true)
    }

    return () => {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current)
      }
    }
  }, [isLoading, messageCount, isSettled, performScrollToBottom])

  /**
   * Handle streaming completion
   * Only scroll when streaming finishes, not on every chunk
   */
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current
    const nowStreaming = isStreaming || isWaitingForResponse

    // Detect streaming completion
    if (wasStreaming && !nowStreaming && isAutoScrollEnabled && isSettled) {
      clientLogger.debug('[useAutoScroll] Streaming complete, scrolling to bottom')
      // Small delay to let the final message render
      setTimeout(() => {
        performScrollToBottom('smooth')
      }, 100)
    }

    wasStreamingRef.current = nowStreaming
  }, [isStreaming, isWaitingForResponse, isAutoScrollEnabled, isSettled, performScrollToBottom])

  /**
   * Handle new messages being added (not from streaming)
   */
  useEffect(() => {
    const prevCount = prevMessageCountRef.current
    prevMessageCountRef.current = messageCount

    // Detect new message added (not during initial load)
    if (isSettled && messageCount > prevCount && !isStreaming && !isWaitingForResponse) {
      // New message added (e.g., after streaming completes and message moves to array)
      if (isAutoScrollEnabled) {
        clientLogger.debug('[useAutoScroll] New message added, scrolling to bottom')
        setTimeout(() => {
          performScrollToBottom('smooth')
        }, 50)
      }
    }
  }, [messageCount, isSettled, isStreaming, isWaitingForResponse, isAutoScrollEnabled, performScrollToBottom])

  /**
   * Called when user sends a message - always scrolls to bottom
   */
  const scrollOnUserMessage = useCallback(() => {
    clientLogger.debug('[useAutoScroll] User sent message, forcing scroll to bottom')
    setIsAutoScrollEnabled(true)
    performScrollToBottom('smooth')
  }, [performScrollToBottom])

  /**
   * Called when streaming completes - scrolls if auto-scroll enabled
   */
  const scrollOnStreamComplete = useCallback(() => {
    if (isAutoScrollEnabled) {
      clientLogger.debug('[useAutoScroll] Stream complete, scrolling to bottom')
      performScrollToBottom('smooth')
    }
  }, [isAutoScrollEnabled, performScrollToBottom])

  return {
    scrollOnUserMessage,
    scrollOnStreamComplete,
    isAutoScrollEnabled,
    isSettled,
  }
}
