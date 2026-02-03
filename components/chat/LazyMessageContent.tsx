'use client'

import { useState, useRef, useEffect, memo } from 'react'
import MessageContent from './MessageContent'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

interface LazyMessageContentProps {
  content: string
  className?: string
  renderingPatterns?: RenderingPattern[]
  dialogueDetection?: DialogueDetection | null
  /** Force immediate rendering (skip lazy loading) - useful for streaming content */
  forceRender?: boolean
  /** Server-side pre-rendered HTML for simple messages */
  renderedHtml?: string | null
}

/** Delay before rendering full content - prevents rapid scroll from triggering all renders */
const VISIBILITY_DELAY_MS = 500

/**
 * Lazy-loading wrapper for MessageContent that defers expensive markdown
 * and roleplay pattern processing until the message scrolls into view.
 *
 * Uses IntersectionObserver to detect visibility. Messages must remain visible
 * for at least 500ms before full rendering triggers, preventing expensive
 * renders during rapid scrolling.
 */

function LazyMessageContentInner({
  content,
  className = '',
  renderingPatterns,
  dialogueDetection,
  forceRender = false,
  renderedHtml,
}: LazyMessageContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hasBeenVisible, setHasBeenVisible] = useState(forceRender)
  const visibilityTimerRef = useRef<NodeJS.Timeout | null>(null)

  // If we have pre-rendered HTML, we can skip lazy loading entirely
  const hasPreRenderedHtml = !!renderedHtml

  useEffect(() => {
    // Skip observer if already visible, force rendering, or we have pre-rendered HTML
    if (hasBeenVisible || forceRender || hasPreRenderedHtml) return

    const element = containerRef.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries[0].isIntersecting

        if (isIntersecting) {
          // Element entered viewport - start timer
          if (!visibilityTimerRef.current) {
            visibilityTimerRef.current = setTimeout(() => {
              setHasBeenVisible(true)
              observer.disconnect()
            }, VISIBILITY_DELAY_MS)
          }
        } else {
          // Element left viewport - cancel timer
          if (visibilityTimerRef.current) {
            clearTimeout(visibilityTimerRef.current)
            visibilityTimerRef.current = null
          }
        }
      },
      {
        rootMargin: '100px', // Start observing slightly before visible
        threshold: 0.01,     // Trigger when even 1% is visible
      }
    )

    observer.observe(element)
    return () => {
      observer.disconnect()
      if (visibilityTimerRef.current) {
        clearTimeout(visibilityTimerRef.current)
      }
    }
  }, [hasBeenVisible, forceRender, hasPreRenderedHtml])

  // If we have pre-rendered HTML, render it directly without lazy loading
  // This is the fast path for simple messages loaded from the server
  if (hasPreRenderedHtml) {
    return (
      <div
        ref={containerRef}
        className={`qt-chat-message-content qt-prose prose prose-sm dark:prose-invert ${className}`}
        style={{ overflow: 'hidden' }}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    )
  }

  // If forceRender becomes true, treat as visible immediately
  // We check this in render rather than an effect to avoid cascading renders
  const isVisible = hasBeenVisible || forceRender

  // Show placeholder with truncated plain text until visible
  if (!isVisible) {
    // Show first ~300 chars as plain text preview
    const preview = content.length > 300
      ? content.slice(0, 300) + '...'
      : content

    return (
      <div
        ref={containerRef}
        className={`qt-chat-message-content qt-prose prose prose-sm dark:prose-invert ${className}`}
        style={{ minHeight: '2em' }} // Ensure some height for intersection detection
      >
        <p className="whitespace-pre-wrap">{preview}</p>
      </div>
    )
  }

  // Full render with markdown and roleplay processing
  return (
    <div ref={containerRef}>
      <MessageContent
        content={content}
        className={className}
        renderingPatterns={renderingPatterns}
        dialogueDetection={dialogueDetection}
      />
    </div>
  )
}

/**
 * Memoized LazyMessageContent to prevent re-renders when parent changes.
 * Only re-renders when content or rendering configuration actually changes.
 */
const LazyMessageContent = memo(LazyMessageContentInner, (prev, next) => {
  // Return true if props are equal (skip re-render)
  return (
    prev.content === next.content &&
    prev.className === next.className &&
    prev.forceRender === next.forceRender &&
    prev.renderingPatterns === next.renderingPatterns &&
    prev.dialogueDetection === next.dialogueDetection &&
    prev.renderedHtml === next.renderedHtml
  )
})

export default LazyMessageContent
