'use client'

import { useCallback, useRef, useEffect, useState } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'

interface UseAutoScrollOptions {
  /** Reference to the scroll container element */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Reference to the element at the end of messages */
  endRef: React.RefObject<HTMLDivElement | null>
  /** TanStack virtualizer instance */
  virtualizer: Virtualizer<HTMLDivElement, Element>
  /** Current message count (flat renderMessages length) — drives new-message detection. */
  messageCount: number
  /**
   * Current render-item count (renderItems length). May differ from messageCount
   * because consecutive collapsed announcements coalesce into one render-item.
   * Used only as the valid upper bound for virtualizer.scrollToIndex, since the
   * virtualizer indexes over render-items, not raw messages.
   */
  itemCount: number
  /** Whether a message is currently streaming */
  isStreaming: boolean
  /** Whether we're waiting for the first response chunk */
  isWaitingForResponse: boolean
  /** Current streaming content (used to detect streaming updates) */
  streamingContent: string
  /** Whether messages are still loading from API */
  isLoading: boolean
  /**
   * Whether to auto-scroll to the newest message when a response finishes
   * streaming or a new (non-user) message arrives. When false, only the
   * user-send scroll and the initial-load scroll fire; the view otherwise
   * stays exactly where the reader left it. Backed by the
   * `autoScrollOnResponseComplete` chat setting (default false).
   */
  autoScrollOnComplete: boolean
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
  /** Whether the view is currently at (or near) the bottom — drives the jump-to-bottom button. */
  isAtBottom: boolean
  /** Imperatively scroll to the newest message (for the jump-to-bottom button). */
  scrollToBottom: () => void
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
  itemCount,
  isStreaming,
  isWaitingForResponse,
  streamingContent,
  isLoading,
  autoScrollOnComplete,
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
    // Note: Always use 'auto' for virtualizer because smooth scrolling is not fully
    // supported with dynamic-sized items (causes console warnings from tanstack-virtual)
    if (itemCount > 0) {
      virtualizer.scrollToIndex(itemCount - 1, { align: 'end', behavior: 'auto' })
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
  }, [itemCount, virtualizer, endRef, containerRef])

  /**
   * Handle scroll events to track user intent.
   *
   * `isLoading` is a dependency on purpose: the consuming page renders a
   * loading spinner (no message container) until the chat loads, so on the
   * first mount `containerRef.current` is null and we bail early. Without
   * re-running once loading flips false, the scroll listener would never
   * attach and `isAutoScrollEnabled` would stay stuck at its initial value —
   * which would both hide the jump-to-bottom button and break near-bottom
   * gating. Re-running here attaches the listener as soon as the list exists.
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
            // State changed
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
  }, [containerRef, isNearBottom, isLoading])

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
      settleTimerRef.current = setTimeout(() => {
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

    // Detect streaming completion. Only chase the bottom when the user has
    // opted in via the chat setting AND was already near the bottom.
    if (wasStreaming && !nowStreaming && autoScrollOnComplete && isAutoScrollEnabled && isSettled) {
      // Small delay to let the final message render
      setTimeout(() => {
        performScrollToBottom('smooth')
      }, 100)
    }

    wasStreamingRef.current = nowStreaming
  }, [isStreaming, isWaitingForResponse, autoScrollOnComplete, isAutoScrollEnabled, isSettled, performScrollToBottom])

  /**
   * Handle new messages being added (not from streaming)
   */
  useEffect(() => {
    const prevCount = prevMessageCountRef.current
    prevMessageCountRef.current = messageCount

    // Detect new message added (not during initial load). Gated on the opt-in
    // setting so finished replies / system announcements don't yank the reader.
    if (autoScrollOnComplete && isSettled && messageCount > prevCount && !isStreaming && !isWaitingForResponse) {
      // New message added (e.g., after streaming completes and message moves to array)
      if (isAutoScrollEnabled) {
        setTimeout(() => {
          performScrollToBottom('smooth')
        }, 50)
      }
    }
  }, [messageCount, isSettled, isStreaming, isWaitingForResponse, autoScrollOnComplete, isAutoScrollEnabled, performScrollToBottom])

  /**
   * Called when user sends a message - always scrolls to bottom
   */
  const scrollOnUserMessage = useCallback(() => {
    setIsAutoScrollEnabled(true)
    performScrollToBottom('smooth')
  }, [performScrollToBottom])

  /**
   * Called when streaming completes - scrolls only if the user opted in via
   * the chat setting and was already near the bottom.
   */
  const scrollOnStreamComplete = useCallback(() => {
    if (autoScrollOnComplete && isAutoScrollEnabled) {
      performScrollToBottom('smooth')
    }
  }, [autoScrollOnComplete, isAutoScrollEnabled, performScrollToBottom])

  /**
   * Imperative scroll to bottom for the jump-to-bottom button. Always scrolls
   * and re-enables auto-scroll regardless of the setting (the user explicitly
   * asked to go to the newest message).
   */
  const scrollToBottom = useCallback(() => {
    setIsAutoScrollEnabled(true)
    performScrollToBottom('smooth')
  }, [performScrollToBottom])

  return {
    scrollOnUserMessage,
    scrollOnStreamComplete,
    isAutoScrollEnabled,
    isSettled,
    isAtBottom: isAutoScrollEnabled,
    scrollToBottom,
  }
}
