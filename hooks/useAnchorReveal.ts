'use client'

/**
 * Reveal a collapsed card when something navigates to it.
 *
 * A stat link on the character page scrolls to a card by its anchor id; a card
 * that starts collapsed (the photo album, Conversations, Memories) would then
 * scroll into view still shut. `revealAnchor(id)` announces the navigation and
 * `useAnchorReveal(id, onReveal)` lets the card open itself first. A window
 * event keeps the two decoupled: the navigator need not know which cards
 * collapse, and a card in a shared component need not know the page.
 *
 * @module hooks/useAnchorReveal
 */

import { useEffect, useRef } from 'react'

const REVEAL_EVENT = 'qt:reveal-anchor'

/** Announce that `anchor` is about to be scrolled to. */
export function revealAnchor(anchor: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<string>(REVEAL_EVENT, { detail: anchor }))
}

/** Run `onReveal` whenever `revealAnchor(anchor)` is called. No-op without an anchor. */
export function useAnchorReveal(anchor: string | undefined, onReveal: () => void): void {
  const handlerRef = useRef(onReveal)
  useEffect(() => {
    handlerRef.current = onReveal
  }, [onReveal])

  useEffect(() => {
    if (!anchor) return
    const listener = (event: Event) => {
      if ((event as CustomEvent<string>).detail === anchor) handlerRef.current()
    }
    window.addEventListener(REVEAL_EVENT, listener)
    return () => window.removeEventListener(REVEAL_EVENT, listener)
  }, [anchor])
}
