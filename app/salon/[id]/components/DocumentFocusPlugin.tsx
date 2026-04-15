'use client'

/**
 * DocumentFocusPlugin - Lexical plugin for doc_focus tool
 *
 * Resolves anchor/highlight/line targets against the live editor content,
 * scrolls the viewport, applies ephemeral highlight animation, and
 * reports the resolved line index for the gutter eye icon.
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
  onFocusResolved: (lineIndex: number) => void
  onFocusCleared: () => void
  onFocusProcessed: () => void
}

/**
 * Walk a block element's text nodes to find and wrap the first occurrence of
 * `text` in a <mark> element with class `qt-doc-focus-highlight`.
 * The mark is automatically removed after 3 seconds to restore the DOM.
 */
function applyHighlight(blockEl: HTMLElement, text: string): void {
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT)
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const idx = node.textContent?.indexOf(text) ?? -1
    if (idx >= 0) {
      try {
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + text.length)
        const mark = document.createElement('mark')
        mark.className = 'qt-doc-focus-highlight'
        range.surroundContents(mark)
        // Remove after animation completes
        setTimeout(() => {
          const parent = mark.parentNode
          if (parent) {
            while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
            parent.removeChild(mark)
          }
        }, 3000)
      } catch (err) {
        // surroundContents can fail if the range crosses element boundaries —
        // log a debug warning but don't break the focus flow
        console.debug('[DocumentFocusPlugin] Could not apply highlight (range crosses element boundary)', err)
      }
      break
    }
  }
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

      // Apply highlight decoration to matched text
      if (highlight && targetEl) {
        applyHighlight(targetEl, highlight)
      }

      // Report resolved line to gutter eye icon
      onFocusResolved(blockIndex)
      onFocusProcessed()
    })
  }, [focusRequest, editor, scrollContainerRef, onFocusResolved, onFocusCleared, onFocusProcessed])

  return null
}
