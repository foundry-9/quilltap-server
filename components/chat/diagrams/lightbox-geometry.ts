/**
 * The arithmetic behind the diagram lightbox: a drawing's natural size, and
 * the pan-and-zoom view onto it. Pure functions, so the gestures in
 * DiagramLightbox stay thin and the maths can be tested without a layout.
 *
 * A view is `{ scale, x, y }`: the drawing is shown at `scale` × its natural
 * size, with its top-left corner `(x, y)` pixels from the viewport's.
 */

export interface Size {
  width: number
  height: number
}

export interface View {
  scale: number
  x: number
  y: number
}

/** Furthest out and furthest in, as multiples of the drawing's natural size. */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

/** One press of a zoom button (or the `+` / `-` keys). */
export const ZOOM_STEP = 1.25

/** Breathing room Fit leaves around the drawing, in CSS pixels per side. */
export const FIT_PADDING = 24

// CSS pixels per unit for the absolute lengths an SVG's width/height may use.
const UNIT_PX: Record<string, number> = { '': 1, px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 }

/** An absolute SVG length in CSS pixels, or null for `100%`, `auto` and the like. */
function absoluteLength(value: string | null): number | null {
  if (!value) return null
  const match = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*(px|pt|pc|in|cm|mm)?\s*$/i.exec(value)
  if (!match) return null
  const n = parseFloat(match[1]) * UNIT_PX[(match[2] ?? '').toLowerCase()]
  return Number.isFinite(n) && n > 0 ? n : null
}

function viewBoxSize(svg: Element): Size | null {
  const parts = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [, , width, height] = parts
  return width > 0 && height > 0 ? { width, height } : null
}

/**
 * The size a drawing is at 100%: its own absolute `width` / `height` where it
 * states them (Graphviz writes points), otherwise its `viewBox` (Mermaid writes
 * `width="100%"` and caps it with `max-width`), each filling in for the other's
 * missing half by aspect ratio. Raw SVG keeps its width in `style`. Last
 * resort, 300 × 150 — the size the web gives an SVG that says nothing.
 */
export function naturalSvgSize(svg: Element): Size {
  const box = viewBoxSize(svg)
  const styleWidth = /(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(svg.getAttribute('style') ?? '')
  const width = absoluteLength(svg.getAttribute('width')) ?? absoluteLength(styleWidth?.[1]?.trim() ?? null)
  const height = absoluteLength(svg.getAttribute('height'))

  if (width && height) return { width, height }
  if (box) {
    if (width) return { width, height: (width * box.height) / box.width }
    if (height) return { width: (height * box.width) / box.height, height }
    return box
  }
  return { width: width ?? 300, height: height ?? 150 }
}

export function clampScale(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

/** The scale at which the whole drawing fits the viewport, padding included. */
export function fitScale(content: Size, viewport: Size, padding = FIT_PADDING): number {
  const w = Math.max(1, viewport.width - padding * 2)
  const h = Math.max(1, viewport.height - padding * 2)
  return clampScale(Math.min(w / content.width, h / content.height))
}

/** The drawing at `scale`, centred in the viewport. */
export function centeredView(content: Size, viewport: Size, scale: number): View {
  const s = clampScale(scale)
  return {
    scale: s,
    x: (viewport.width - content.width * s) / 2,
    y: (viewport.height - content.height * s) / 2,
  }
}

/** Fit: the whole drawing, as large as the viewport allows, centred. */
export function fitView(content: Size, viewport: Size): View {
  return centeredView(content, viewport, fitScale(content, viewport))
}

/**
 * Zoom to `scale`, keeping the drawing's point under `focus` (viewport
 * coordinates — the cursor, or the middle of a pinch) exactly where it is.
 */
export function zoomTo(view: View, scale: number, focus: { x: number; y: number }): View {
  const s = clampScale(scale)
  const ratio = s / view.scale
  return {
    scale: s,
    x: focus.x - (focus.x - view.x) * ratio,
    y: focus.y - (focus.y - view.y) * ratio,
  }
}

/**
 * How much one wheel event zooms. A trackpad pinch arrives in Chromium as a
 * wheel event with `ctrlKey` set and small deltas, so it is given a steeper
 * curve than a mouse wheel's notches; line- and page-mode deltas are brought
 * to pixels first.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  // One mouse notch (~100px) is about ×1.16; a pinch tracks the fingers closely.
  const k = ctrlKey ? 0.01 : 0.0015
  return Math.exp(-px * k)
}
