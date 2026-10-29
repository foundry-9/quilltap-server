/**
 * Raw SVG renderer: a model-written ```svg block, sanitized and sized to fit.
 * No engine and no style — a freeform drawing is already in whatever hand the
 * model drew it.
 */

import { looksLikeSvgRoot, sanitizeSvgElement } from './sanitize-svg'
import type { RenderedDiagram } from './types'

function numericLength(value: string | null): number | null {
  if (!value) return null
  const match = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value)
  return match ? parseFloat(match[1]) : null
}

/**
 * Make the drawing scale down to its container: guarantee a `viewBox`, then
 * trade the fixed `width`/`height` for a natural width capped at 100%.
 */
function fitToContainer(svg: SVGSVGElement): void {
  const width = numericLength(svg.getAttribute('width'))
  const height = numericLength(svg.getAttribute('height'))
  if (!svg.getAttribute('viewBox') && width && height) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  }
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  const existing = svg.getAttribute('style')
  const sizing = `${width ? `width:${width}px;` : 'width:100%;'}max-width:100%;height:auto;`
  svg.setAttribute('style', existing ? `${existing.replace(/;?\s*$/, ';')}${sizing}` : sizing)
}

export async function renderSvg(source: string): Promise<RenderedDiagram> {
  if (!looksLikeSvgRoot(source)) {
    throw new Error('An svg block must start with an <svg> element')
  }
  const svg = sanitizeSvgElement(source)
  if (!svg) throw new Error('Nothing drawable survived sanitizing this SVG')
  fitToContainer(svg)
  return { svg: new XMLSerializer().serializeToString(svg) }
}
