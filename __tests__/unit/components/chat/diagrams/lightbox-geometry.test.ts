/**
 * The lightbox's arithmetic: a drawing's natural size in each engine's
 * dialect, Fit, zooming about a point, and the wheel curve.
 */

import {
  MAX_ZOOM,
  MIN_ZOOM,
  centeredView,
  fitScale,
  fitView,
  naturalSvgSize,
  wheelZoomFactor,
  zoomTo,
} from '@/components/chat/diagrams/lightbox-geometry'

function svgWith(attrs: Record<string, string>): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v)
  return svg
}

describe('naturalSvgSize', () => {
  it('reads Graphviz points as CSS pixels', () => {
    expect(naturalSvgSize(svgWith({ width: '72pt', height: '36pt', viewBox: '0 0 72 36' }))).toEqual({
      width: 96,
      height: 48,
    })
  })

  it('falls back to the viewBox for Mermaid\'s width="100%"', () => {
    const size = naturalSvgSize(svgWith({ width: '100%', viewBox: '0 0 345 120', style: 'max-width: 345px;' }))
    expect(size).toEqual({ width: 345, height: 120 })
  })

  it('reads a raw drawing\'s width from its style and keeps the aspect ratio', () => {
    const size = naturalSvgSize(svgWith({ viewBox: '0 0 160 120', style: 'width:320px;max-width:100%;height:auto;' }))
    expect(size).toEqual({ width: 320, height: 240 })
  })

  it('gives a drawing that says nothing the web default', () => {
    expect(naturalSvgSize(svgWith({}))).toEqual({ width: 300, height: 150 })
  })
})

describe('fit and zoom', () => {
  const content = { width: 400, height: 200 }
  const viewport = { width: 1048, height: 648 }

  it('fits the limiting dimension inside the padding', () => {
    // (1048 - 48) / 400 = 2.5 ; (648 - 48) / 200 = 3 → 2.5
    expect(fitScale(content, viewport)).toBe(2.5)
  })

  it('centres the fitted drawing', () => {
    expect(fitView(content, viewport)).toEqual({ scale: 2.5, x: 24, y: 74 })
  })

  it('clamps every scale to the zoom range', () => {
    expect(centeredView(content, viewport, 100).scale).toBe(MAX_ZOOM)
    expect(fitScale({ width: 1e6, height: 1e6 }, viewport)).toBe(MIN_ZOOM)
  })

  it('keeps the point under the cursor fixed while zooming', () => {
    const view = { scale: 1, x: 10, y: 20 }
    const focus = { x: 210, y: 120 }
    // The drawing point under the cursor before…
    const before = { x: (focus.x - view.x) / view.scale, y: (focus.y - view.y) / view.scale }
    const next = zoomTo(view, 2, focus)
    // …is still under it after.
    expect((focus.x - next.x) / next.scale).toBeCloseTo(before.x)
    expect((focus.y - next.y) / next.scale).toBeCloseTo(before.y)
    expect(next.scale).toBe(2)
  })

  it('zooms in on wheel-up and out on wheel-down, pinch more steeply', () => {
    expect(wheelZoomFactor(-100, 0, false)).toBeGreaterThan(1)
    expect(wheelZoomFactor(100, 0, false)).toBeLessThan(1)
    expect(wheelZoomFactor(-10, 0, true)).toBeGreaterThan(wheelZoomFactor(-10, 0, false))
    // Line-mode deltas are brought to pixels.
    expect(wheelZoomFactor(-3, 1, false)).toBeCloseTo(wheelZoomFactor(-48, 0, false))
  })
})
