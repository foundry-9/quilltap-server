'use client'

/**
 * DocumentFocusPlugin - Lexical plugin for doc_focus tool
 *
 * Resolves anchor/highlight/line targets against the live editor content,
 * scrolls the viewport, applies ephemeral highlight animation, and
 * reports the resolved pixel position for the gutter eye icon.
 *
 * Scriptorium Phase 3.6
 *
 * @module app/salon/[id]/components/DocumentFocusPlugin
 */

import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import { $isHeadingNode } from '@lexical/rich-text'
import type { FocusRequest } from '../hooks/useDocumentMode'

interface DocumentFocusPluginProps {
  focusRequest: FocusRequest | null
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  onFocusResolved: (pixelTop: number) => void
  onFocusCleared: () => void
  onFocusProcessed: () => void
}

/**
 * Walk a block element's text nodes to find the first occurrence of `text`,
 * then create a fixed-position overlay on document.body that highlights it.
 *
 * The overlay is placed outside Lexical's DOM tree entirely because Lexical
 * uses a MutationObserver on its root element — any child appended there
 * is detected as an unexpected mutation and removed immediately.
 *
 * Uses position: fixed with viewport coordinates from getBoundingClientRect.
 * Since the highlight is ephemeral (2.5s) and we just auto-scrolled to the
 * target, the text will stay under the overlay for the duration.
 *
 * Matching is case-insensitive to stay consistent with block resolution.
 * Returns a { top } content-relative measurement for eye positioning, or null.
 */
function applyHighlight(
  blockEl: HTMLElement,
  text: string,
  rootEl: HTMLElement,
): { top: number } | null {
  const lowerText = text.toLowerCase()
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT)
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const nodeContent = node.textContent ?? ''
    const idx = nodeContent.toLowerCase().indexOf(lowerText)
    if (idx >= 0) {
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + text.length)

      const rangeRect = range.getBoundingClientRect()
      const rootRect = rootEl.getBoundingClientRect()

      // Content-relative top for the gutter eye icon
      const contentTop = rangeRect.top - rootRect.top + rootEl.scrollTop

      console.debug('[DocumentFocusPlugin] Highlight overlay placement', {
        viewport: { top: rangeRect.top, left: rangeRect.left, width: rangeRect.width, height: rangeRect.height },
        contentTop,
      })

      // Skip if dimensions are invalid
      if (rangeRect.width <= 0 || rangeRect.height <= 0) {
        console.warn('[DocumentFocusPlugin] Range has zero dimensions — skipping overlay')
        return { top: contentTop }
      }

      // Read theme highlight color (or use warm yellow default)
      const highlightColor = getComputedStyle(rootEl).getPropertyValue('--qt-focus-highlight-color').trim()
        || 'rgba(250, 204, 21, 0.35)'

      // Create a fixed-position overlay on document.body — outside Lexical's
      // MutationObserver scope so it won't be removed.
      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position: fixed',
        'pointer-events: none',
        `left: ${rangeRect.left}px`,
        `top: ${rangeRect.top}px`,
        `width: ${rangeRect.width}px`,
        `height: ${rangeRect.height}px`,
        `background-color: ${highlightColor}`,
        'border-radius: 2px',
        'z-index: 9999',
        'transition: opacity 2.5s ease-out',
      ].join('; ')

      document.body.appendChild(overlay)

      // Trigger the fade on the next frame so the browser registers the initial state
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          overlay.style.opacity = '0'
        })
      })

      // Remove from DOM after animation completes
      setTimeout(() => {
        overlay.remove()
      }, 3000)

      return { top: contentTop }
    }
  }
  return null
}

/**
 * Measure a DOM element's vertical position relative to the editor root element,
 * accounting for scroll offset. Returns the top offset in content coordinates.
 */
function measureElementTop(el: HTMLElement, rootEl: HTMLElement): number {
  const rootRect = rootEl.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  return elRect.top - rootRect.top + rootEl.scrollTop
}

export default function DocumentFocusPlugin({
  focusRequest,
  scrollContainerRef,
  onFocusResolved,
  onFocusCleared,
  onFocusProcessed,
}: DocumentFocusPluginProps) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    console.debug('[DocumentFocusPlugin] useEffect fired', { focusRequest })
    if (!focusRequest) return

    // Handle clear_focus — reset attention line and clear the request
    if (focusRequest.clear_focus) {
      console.debug('[DocumentFocusPlugin] Clearing focus')
      onFocusCleared()
      onFocusProcessed()
      return
    }

    const { anchor, highlight, line } = focusRequest

    // Resolve target block index from editor state
    let resolvedBlockIndex: number | null = null
    let highlightScope: { start: number; end: number } | null = null

    editor.getEditorState().read(() => {
      const root = $getRoot()
      const children = root.getChildren()
      const blockCount = children.length

      if (blockCount === 0) return

      // --- Anchor resolution ---
      if (anchor) {
        const normalizedAnchor = anchor.toLowerCase()
        let foundAnchorIndex: number | null = null
        let foundAnchorLevel: number | null = null

        for (let i = 0; i < children.length; i++) {
          const child = children[i]
          if ($isHeadingNode(child)) {
            const text = child.getTextContent().toLowerCase()
            if (text === normalizedAnchor || text.includes(normalizedAnchor)) {
              foundAnchorIndex = i
              // HeadingNode tag is 'h1' | 'h2' | ... | 'h6'
              const tag = child.getTag()
              foundAnchorLevel = parseInt(tag.replace('h', ''), 10)
              break
            }
          }
        }

        if (foundAnchorIndex !== null && foundAnchorLevel !== null) {
          resolvedBlockIndex = foundAnchorIndex

          // Determine scope: from anchor to the next heading of same or higher level
          let scopeEnd = children.length
          for (let i = foundAnchorIndex + 1; i < children.length; i++) {
            const child = children[i]
            if ($isHeadingNode(child)) {
              const tag = child.getTag()
              const level = parseInt(tag.replace('h', ''), 10)
              if (level <= foundAnchorLevel) {
                scopeEnd = i
                break
              }
            }
          }
          highlightScope = { start: foundAnchorIndex, end: scopeEnd }
        } else {
          console.warn('[DocumentFocusPlugin] Anchor heading not found:', anchor)
        }
      }

      // --- Highlight resolution (refines block target) ---
      if (highlight) {
        const normalizedHighlight = highlight.toLowerCase()
        const searchStart = highlightScope?.start ?? 0
        const searchEnd = highlightScope?.end ?? children.length

        let found = false
        for (let i = searchStart; i < searchEnd; i++) {
          const text = children[i].getTextContent().toLowerCase()
          if (text.includes(normalizedHighlight)) {
            resolvedBlockIndex = i
            found = true
            break
          }
        }

        if (!found) {
          console.warn('[DocumentFocusPlugin] Highlight text not found within scope:', highlight)
          // Keep resolvedBlockIndex from anchor if available
        }
      }

      // --- Line number fallback ---
      if (resolvedBlockIndex === null) {
        if (typeof line === 'number') {
          resolvedBlockIndex = Math.max(0, Math.min(line, blockCount - 1))
        } else {
          // Nothing to resolve — use first block
          resolvedBlockIndex = 0
        }
      }
    })

    if (resolvedBlockIndex === null) {
      console.warn('[DocumentFocusPlugin] Could not resolve any target block — skipping')
      onFocusProcessed()
      return
    }

    const blockIndex = resolvedBlockIndex

    console.debug('[DocumentFocusPlugin] Resolved target block', {
      blockIndex,
      anchor,
      highlight,
      line,
    })

    // Scroll and highlight after a rAF so DOM is settled
    requestAnimationFrame(() => {
      const rootEl = editor.getRootElement()
      const targetEl = rootEl?.children[blockIndex] as HTMLElement | undefined

      // Scroll the container so target is ~1/3 from top
      const container = scrollContainerRef.current
      if (container && targetEl) {
        const targetTop = targetEl.offsetTop
        const containerHeight = container.clientHeight
        container.scrollTo({
          top: Math.max(0, targetTop - containerHeight / 3),
          behavior: 'smooth',
        })
        console.debug('[DocumentFocusPlugin] Scrolled to block', { targetTop, containerHeight })
      } else {
        console.warn('[DocumentFocusPlugin] Could not scroll — missing container or target element', {
          hasContainer: !!container,
          hasTarget: !!targetEl,
        })
      }

      // Apply highlight decoration and measure position for the gutter eye icon.
      // The highlight overlay gives sub-block accuracy (e.g., a specific list
      // item within a list block). Falls back to the block element position.
      let resolvedTop: number | null = null

      if (highlight && targetEl && rootEl) {
        const result = applyHighlight(targetEl, highlight, rootEl)
        if (result) {
          resolvedTop = result.top
        }
      }

      if (resolvedTop === null && rootEl && targetEl) {
        resolvedTop = measureElementTop(targetEl, rootEl)
      }

      if (resolvedTop !== null) {
        console.debug('[DocumentFocusPlugin] Eye position resolved', { pixelTop: resolvedTop })
        onFocusResolved(resolvedTop)
      }

      onFocusProcessed()
    })
  }, [focusRequest, editor, scrollContainerRef, onFocusResolved, onFocusCleared, onFocusProcessed])

  return null
}
