/**
 * Keep the reader's place while a diagram is looked at elsewhere.
 *
 * Opening the lightbox must cost nothing in the transcript behind it: Escape
 * should land the reader exactly where they were. Nothing here assumes how the
 * place could be lost — a virtualized row re-measuring, a reply streaming in
 * below, focus being handed back — it simply remembers where the diagram sat
 * in its scrolling container and puts it back there.
 *
 * The anchor is the diagram itself: its offset from the top of the container
 * is restored, so content that grew or shrank above it while the lightbox was
 * open does not move it. If its row has since been unmounted (a virtualized
 * list), the container's plain `scrollTop` is restored instead.
 */

function isScrollable(el: Element): boolean {
  const { overflowY } = getComputedStyle(el)
  return (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && el.scrollHeight > el.clientHeight
}

/** The nearest ancestor of `el` that scrolls vertically, or null for the page itself. */
export function findScrollContainer(el: Element): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    if (isScrollable(node)) return node
  }
  return null
}

/**
 * Remember where `anchor` is; the returned function puts it back, hands focus
 * back to it without scrolling, and checks once more on the next frame in case
 * layout settled late.
 */
export function captureScrollAnchor(anchor: HTMLElement): () => void {
  const container = findScrollContainer(anchor)
  const savedTop = container ? container.scrollTop : window.scrollY
  const savedLeft = container ? container.scrollLeft : window.scrollX
  const offsetOf = () => anchor.getBoundingClientRect().top - (container ? container.getBoundingClientRect().top : 0)
  const savedOffset = offsetOf()

  const apply = () => {
    if (anchor.isConnected) {
      const drift = offsetOf() - savedOffset
      if (Math.abs(drift) >= 1) {
        if (container) container.scrollTop += drift
        else window.scrollBy(0, drift)
      }
    } else if (container) {
      container.scrollTop = savedTop
    } else {
      window.scrollTo(savedLeft, savedTop)
    }
    if (container && container.scrollLeft !== savedLeft) container.scrollLeft = savedLeft
  }

  return () => {
    apply()
    if (anchor.isConnected) anchor.focus({ preventScroll: true })
    requestAnimationFrame(apply)
    console.debug('[diagrams] Restored transcript position after lightbox', {
      anchored: anchor.isConnected,
      savedTop,
    })
  }
}
