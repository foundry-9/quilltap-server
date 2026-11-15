'use client'

/**
 * Calliope's Atelier — a row that is mounted only near the viewport.
 *
 * Every section open is several hundred rows (Spec E, Stage 1: do not mount
 * rows that are off screen). A `LazyRow` is an empty list item of the row's
 * last measured height until it comes within a screen or so of the
 * viewport; then its child mounts, and it unmounts again once it is well
 * out of sight — unless focus is inside it, so a field being typed in is
 * never taken away. The margin is measured in the panel that scrolls (the
 * nearest `[data-editor-scroll]` ancestor), so rows below its fold mount
 * before they are reached; one `IntersectionObserver` per such panel serves
 * every row. Without one (an old browser, the test DOM) every row is mounted.
 *
 * @module components/theme-editor/LazyRow
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

const MARGIN = '800px 0px'

type Callback = (near: boolean) => void
const callbacks = new Map<Element, Callback>()
const observers = new WeakMap<Element, IntersectionObserver>()
let viewportObserver: IntersectionObserver | null = null

function observe(entries: IntersectionObserverEntry[]) {
  for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting)
}

/** The observer for rows inside `root` (the viewport when null), made once. */
function observerFor(root: Element | null): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  if (!root) {
    viewportObserver ??= new IntersectionObserver(observe, { rootMargin: MARGIN })
    return viewportObserver
  }
  let io = observers.get(root)
  if (!io) {
    io = new IntersectionObserver(observe, { root, rootMargin: MARGIN })
    observers.set(root, io)
  }
  return io
}

interface LazyRowProps {
  /** Height to hold before the row was ever measured. */
  estimate: number
  children: ReactNode
}

export function LazyRow({ estimate, children }: LazyRowProps) {
  const ref = useRef<HTMLLIElement>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  const [height, setHeight] = useState(estimate)

  useEffect(() => {
    const el = ref.current
    const io = el ? observerFor(el.closest('[data-editor-scroll]')) : null
    if (!el || !io) return
    callbacks.set(el, (isNear) => {
      if (isNear) {
        setNear(true)
        return
      }
      if (el.contains(document.activeElement)) return
      if (el.offsetHeight > 0) setHeight(el.offsetHeight)
      setNear(false)
    })
    io.observe(el)
    return () => {
      io.unobserve(el)
      callbacks.delete(el)
    }
  }, [])

  return (
    <li
      ref={ref}
      className="border-b qt-border-default last:border-b-0"
      style={near ? undefined : { height }}
      aria-hidden={near ? undefined : true}
    >
      {near ? children : null}
    </li>
  )
}
