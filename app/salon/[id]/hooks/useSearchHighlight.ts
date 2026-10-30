'use client'

import { useEffect, type RefObject } from 'react'
import { conversationQueryPattern } from '@/lib/chat/conversation-search'

/**
 * The CSS highlight name painted by in-conversation search. Styled in
 * `app/globals.css` with `::highlight(quilltap-conversation-search)`.
 */
export const CONVERSATION_SEARCH_HIGHLIGHT = 'quilltap-conversation-search'

/** Text that is not transcript: the composer, inline editors, and the like. */
const SKIP_SELECTOR = 'input, textarea, [contenteditable="true"], script, style'

/**
 * One shared `Highlight` per document. Each Salon instance adds and removes only
 * its own ranges, so kept-alive tabs never wipe each other's paint.
 */
function sharedHighlight(): Highlight | null {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return null
  let highlight = CSS.highlights.get(CONVERSATION_SEARCH_HIGHLIGHT)
  if (!highlight) {
    highlight = new Highlight()
    CSS.highlights.set(CONVERSATION_SEARCH_HIGHLIGHT, highlight)
  }
  return highlight
}

function collectRanges(container: HTMLElement, pattern: RegExp): Range[] {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: node =>
      node.parentElement?.closest(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? ''
    pattern.lastIndex = 0
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      const range = document.createRange()
      range.setStart(node, m.index)
      range.setEnd(node, m.index + m[0].length)
      ranges.push(range)
    }
  }
  return ranges
}

/**
 * Paint every occurrence of `query` inside the transcript container, without
 * touching the DOM React owns. The list is virtualized, so rows mount and
 * unmount as the reader scrolls (and stream in during a turn); a
 * MutationObserver re-paints, at most once a frame. A match split across
 * elements (half of it bold) is not painted — the in-chat result list still
 * finds it, because that matches on the markdown-stripped text.
 *
 * A browser without the Custom Highlight API simply gets no paint.
 */
export function useSearchHighlight(containerRef: RefObject<HTMLElement | null>, query: string | null): void {
  useEffect(() => {
    const container = containerRef.current
    const pattern = query ? conversationQueryPattern(query) : null
    const highlight = sharedHighlight()
    if (!container || !pattern || !highlight) return

    let owned: Range[] = []
    let frame = 0
    const paint = () => {
      frame = 0
      for (const range of owned) highlight.delete(range)
      owned = collectRanges(container, pattern)
      for (const range of owned) highlight.add(range)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint)
    }

    paint()
    const observer = new MutationObserver(schedule)
    observer.observe(container, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      for (const range of owned) highlight.delete(range)
    }
  }, [containerRef, query])
}
