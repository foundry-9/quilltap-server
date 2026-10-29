'use client'

/**
 * DiagramLightbox — one diagram, full-window, to be examined and exported.
 *
 * Wheel, trackpad pinch (Chromium's ctrl-wheel and Safari's gesture events)
 * and two-finger touch pinch zoom about the point under the pointer; a drag
 * pans. **Fit** shows the whole drawing as large as the window allows and is
 * where the lightbox opens; **100%** shows it at its natural size. While Fit
 * is in force a window resize re-fits.
 *
 * **Copy PNG** puts a twice-natural-size picture on the clipboard (see
 * export-png.ts for why that is harder than it sounds), on the diagram's own
 * background or — with **Transparent** ticked — on nothing at all.
 *
 * The drawing is scaled by sizing it, not by a CSS transform, so the browser
 * re-draws the vector at every zoom and it stays sharp. Escape, the close
 * button or a click on the empty backdrop closes it; the caller (the lightbox
 * host) puts the transcript back where it was.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { showErrorToast, showInfoToast } from '@/lib/toast'
import { copyPngBlobToClipboard } from '@/lib/clipboard-utils'
import { PNG_EXPORT_SCALE, diagramToPngBlob, safeExportScale, DiagramExportError } from './export-png'
import {
  ZOOM_STEP,
  centeredView,
  fitView,
  naturalSvgSize,
  wheelZoomFactor,
  zoomTo,
  type Size,
  type View,
} from './lightbox-geometry'

export interface DiagramLightboxProps {
  /** The drawn diagram's markup, exactly as shown in the message. */
  svg: string
  /** What the dialog announces itself as. */
  label: string
  onClose: () => void
}

/** Pixels a press may wander and still count as a click on the backdrop. */
const CLICK_SLOP = 4

// The Transparent choice lasts for the page's life, so a run of copies keeps it.
let rememberedTransparent = false

type CopyState = 'idle' | 'working' | 'copied'

interface GestureLikeEvent extends Event {
  scale: number
  clientX: number
  clientY: number
}

function failureMessage(err: unknown): string {
  if (err instanceof DiagramExportError) {
    if (err.reason === 'tainted') return 'The browser would not let this drawing be copied as a picture.'
    if (err.reason === 'too-large') return 'This drawing is too large to copy as a picture.'
    return 'The drawing could not be turned into a picture.'
  }
  return 'The picture could not be put on the clipboard.'
}

export function DiagramLightbox({ svg, label, onClose }: DiagramLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  const [natural, setNatural] = useState<Size | null>(null)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [fitted, setFitted] = useState(true)
  const [transparent, setTransparent] = useState(rememberedTransparent)
  const [copyState, setCopyState] = useState<CopyState>('idle')

  // Gesture handlers read the latest view without re-binding, and without
  // waiting for a render: a burst of pointer moves must compound.
  const viewRef = useRef(view)
  const naturalRef = useRef(natural)

  const viewportSize = (): Size => {
    const el = viewportRef.current
    return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 }
  }

  const applyView = useCallback((next: View, stillFitted = false) => {
    viewRef.current = next
    setView(next)
    setFitted(stillFitted)
  }, [])

  const fit = useCallback(() => {
    const size = naturalRef.current
    if (size) applyView(fitView(size, viewportSize()), true)
  }, [applyView])

  const actualSize = useCallback(() => {
    const size = naturalRef.current
    if (size) applyView(centeredView(size, viewportSize(), 1))
  }, [applyView])

  /** Zoom by `factor` about a viewport point (default: the middle). */
  const zoomBy = useCallback(
    (factor: number, focus?: { x: number; y: number }) => {
      const vp = viewportSize()
      const current = viewRef.current
      applyView(zoomTo(current, current.scale * factor, focus ?? { x: vp.width / 2, y: vp.height / 2 }))
    },
    [applyView],
  )

  // Measure the drawing once it is in the sheet, then open at Fit.
  useLayoutEffect(() => {
    const el = sheetRef.current?.querySelector('svg')
    if (!el) return
    const size = naturalSvgSize(el)
    // Without a viewBox, resizing an SVG grows its canvas, not its drawing
    // (svg2roughjs's sketches carry only width and height).
    if (!el.getAttribute('viewBox')) el.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`)
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.maxWidth = 'none'
    el.style.maxHeight = 'none'
    el.style.display = 'block'
    naturalRef.current = size
    setNatural(size)
    applyView(fitView(size, viewportSize()), true)
  }, [svg, applyView])

  // Fit follows the window while it is in force.
  useEffect(() => {
    if (!fitted) return
    const onResize = () => fit()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fitted, fit])

  // Escape closes, before anything in the Salon behind can act on it
  // (Document and Terminal Mode both leave focus mode on Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select')) return
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        zoomBy(ZOOM_STEP)
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        zoomBy(1 / ZOOM_STEP)
      } else if (e.key === '0') {
        e.preventDefault()
        actualSize()
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])') ?? [],
        ).filter((el) => !el.hasAttribute('disabled'))
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, zoomBy, actualSize])

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true })
  }, [])

  // Wheel and Safari's trackpad gestures. Bound by hand: React's wheel
  // listener is passive and could not keep the page from scrolling.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const local = (clientX: number, clientY: number) => {
      const rect = viewport.getBoundingClientRect()
      return { x: clientX - rect.left, y: clientY - rect.top }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey), local(e.clientX, e.clientY))
    }

    let gestureStartScale = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureStartScale = viewRef.current.scale
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as GestureLikeEvent
      applyView(zoomTo(viewRef.current, gestureStartScale * g.scale, local(g.clientX, g.clientY)))
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('gesturestart', onGestureStart)
    viewport.addEventListener('gesturechange', onGestureChange)
    viewport.addEventListener('gestureend', onGestureStart)
    return () => {
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('gesturestart', onGestureStart)
      viewport.removeEventListener('gesturechange', onGestureChange)
      viewport.removeEventListener('gestureend', onGestureStart)
    }
  }, [zoomBy, applyView])

  // Drag to pan; two fingers to pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const press = useRef<{ x: number; y: number; moved: boolean; onBackdrop: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      press.current = { x: e.clientX, y: e.clientY, moved: false, onBackdrop: e.target === e.currentTarget }
    } else if (press.current) {
      press.current.moved = true
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(e.pointerId)
    if (!previous) return
    const rect = e.currentTarget.getBoundingClientRect()
    const others = Array.from(pointers.current.entries()).filter(([id]) => id !== e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > CLICK_SLOP) {
      press.current.moved = true
    }

    const current = viewRef.current
    if (others.length === 0) {
      applyView({ ...current, x: current.x + e.clientX - previous.x, y: current.y + e.clientY - previous.y })
      return
    }
    // Pinch: scale by the change in finger spread, about their midpoint, and
    // follow the midpoint as it travels.
    const [, other] = others[0]
    const before = Math.hypot(previous.x - other.x, previous.y - other.y)
    const after = Math.hypot(e.clientX - other.x, e.clientY - other.y)
    if (before < 1) return
    const midBefore = { x: (previous.x + other.x) / 2 - rect.left, y: (previous.y + other.y) / 2 - rect.top }
    const midAfter = { x: (e.clientX + other.x) / 2 - rect.left, y: (e.clientY + other.y) / 2 - rect.top }
    const zoomed = zoomTo(current, current.scale * (after / before), midBefore)
    applyView({ ...zoomed, x: zoomed.x + midAfter.x - midBefore.x, y: zoomed.y + midAfter.y - midBefore.y })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size > 0) return
    const wasClick = press.current && !press.current.moved && press.current.onBackdrop
    press.current = null
    if (wasClick && e.type === 'pointerup') onClose()
  }

  const handleTransparent = (checked: boolean) => {
    rememberedTransparent = checked
    setTransparent(checked)
  }

  const handleCopyPng = () => {
    const live = sheetRef.current?.querySelector('svg')
    if (!live || copyState === 'working') return
    setCopyState('working')
    const background = getComputedStyle(sheetRef.current!).getPropertyValue('--qt-diagram-bg').trim()
      || getComputedStyle(dialogRef.current!).getPropertyValue('--color-card').trim()
      || '#ffffff'
    const size = naturalRef.current ?? naturalSvgSize(live)
    const scale = safeExportScale(size, PNG_EXPORT_SCALE)

    // Started now, inside the click: the clipboard is claimed before the
    // drawing is painted (see copyPngBlobToClipboard).
    const png = diagramToPngBlob(live, { transparent, background, scale })
    copyPngBlobToClipboard(png)
      .then(() => {
        setCopyState('copied')
        if (scale < PNG_EXPORT_SCALE) {
          showInfoToast(`A large drawing — copied at ${scale.toFixed(1)}× rather than ${PNG_EXPORT_SCALE}×.`)
        }
        setTimeout(() => setCopyState((s) => (s === 'copied' ? 'idle' : s)), 2000)
      })
      .catch((err: unknown) => {
        console.error('Failed to copy diagram as PNG', { error: err instanceof Error ? err.message : String(err) })
        showErrorToast(failureMessage(err))
        setCopyState('idle')
      })
  }

  const percent = Math.round(view.scale * 100)
  const sheetStyle = natural
    ? {
        left: `${view.x}px`,
        top: `${view.y}px`,
        width: `${natural.width * view.scale}px`,
        height: `${natural.height * view.scale}px`,
      }
    : { visibility: 'hidden' as const }

  return (
    <div
      ref={dialogRef}
      className="qt-diagram-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
    >
      <div className="qt-diagram-lightbox-bar" role="toolbar" aria-label="Diagram view">
        <div className="qt-diagram-lightbox-group">
          <button
            type="button"
            className="qt-diagram-lightbox-button"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            title="Zoom out (−)"
            aria-label="Zoom out"
          >
            <Icon name="zoom-out" className="w-4 h-4" />
          </button>
          <span className="qt-diagram-lightbox-zoom" aria-live="polite" aria-label={`Zoom ${percent}%`}>
            {percent}%
          </span>
          <button
            type="button"
            className="qt-diagram-lightbox-button"
            onClick={() => zoomBy(ZOOM_STEP)}
            title="Zoom in (+)"
            aria-label="Zoom in"
          >
            <Icon name="zoom-in" className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="qt-diagram-lightbox-button"
            onClick={fit}
            aria-pressed={fitted}
            title="Fit the whole drawing to the window"
          >
            <Icon name="compress" className="w-4 h-4" />
            <span>Fit</span>
          </button>
          <button
            type="button"
            className="qt-diagram-lightbox-button"
            onClick={actualSize}
            aria-pressed={!fitted && Math.abs(view.scale - 1) < 0.005}
            title="Natural size (0)"
          >
            <span>100%</span>
          </button>
        </div>
        <div className="qt-diagram-lightbox-group">
          <label className="qt-diagram-lightbox-check" title="Copy without a background">
            <input
              type="checkbox"
              checked={transparent}
              onChange={(e) => handleTransparent(e.target.checked)}
            />
            <span>Transparent</span>
          </label>
          <button
            type="button"
            className="qt-diagram-lightbox-button"
            onClick={handleCopyPng}
            disabled={copyState === 'working'}
            title={`Copy as a PNG at ${PNG_EXPORT_SCALE}× resolution`}
          >
            <Icon name={copyState === 'copied' ? 'check' : 'image'} className="w-4 h-4" />
            <span>{copyState === 'copied' ? 'Copied' : copyState === 'working' ? 'Copying…' : 'Copy PNG'}</span>
          </button>
          <button
            type="button"
            className="qt-diagram-lightbox-button"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="qt-diagram-lightbox-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) return
          if (fitted) actualSize()
          else fit()
        }}
      >
        <div
          ref={sheetRef}
          className="qt-diagram-lightbox-sheet"
          data-transparent={transparent ? 'true' : undefined}
          style={sheetStyle}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <p className="qt-diagram-lightbox-hint">Wheel or pinch to zoom · drag to pan · Esc to return</p>
    </div>
  )
}
