'use client'

/**
 * Opens and closes the diagram lightbox.
 *
 * The lightbox gets a React root of its own on `<body>` rather than a portal
 * from the diagram's row. The Salon transcript is virtualized: a row may be
 * unmounted while its diagram is being examined (a reply streaming in below
 * scrolls it out of the overscan), and a portal would vanish with it. A root
 * of its own outlives the row, and needs nothing from the row's context — the
 * drawing arrives as finished markup and the theme is page-wide CSS. (The
 * toasts work the same way, in lib/toast.tsx.)
 *
 * One lightbox at a time: opening another closes the first.
 */

import { createRoot, type Root } from 'react-dom/client'
import { DiagramLightbox } from './DiagramLightbox'
import { captureScrollAnchor } from './scroll-anchor'

interface OpenLightbox {
  root: Root
  container: HTMLElement
  restore: () => void
}

let open: OpenLightbox | null = null

export interface OpenDiagramLightboxOptions {
  svg: string
  label: string
  /** The diagram on the page: where the reader's place is kept and focus returns. */
  trigger: HTMLElement
}

/** Close the lightbox, if one is open, and put the transcript back. */
export function closeDiagramLightbox(): void {
  const current = open
  if (!current) return
  open = null
  // Off the page at once; the root itself is unmounted after the event that
  // closed it (often one of its own buttons) has finished dispatching.
  current.container.remove()
  current.restore()
  queueMicrotask(() => current.root.unmount())
}

export function openDiagramLightbox({ svg, label, trigger }: OpenDiagramLightboxOptions): void {
  closeDiagramLightbox()

  const restore = captureScrollAnchor(trigger)
  const container = document.createElement('div')
  container.className = 'qt-diagram-lightbox-root'
  document.body.appendChild(container)
  const root = createRoot(container)
  open = { root, container, restore }

  root.render(<DiagramLightbox svg={svg} label={label} onClose={closeDiagramLightbox} />)
}
